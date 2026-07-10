use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::{blocking::Client, StatusCode};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{env, fmt, fs, path::PathBuf};
use tauri::{path::BaseDirectory, AppHandle, Manager, State};

include!(concat!(env!("OUT_DIR"), "/bundled_token.rs"));

struct AppState {
    db_path: PathBuf,
}

const GITHUB_OWNER: &str = "philippeZim";
const GITHUB_REPO: &str = "Elowen_DB";
const GITHUB_DB_PATH: &str = "reservations.yml";
const GITHUB_API_VERSION: &str = "2022-11-28";
const GITHUB_CONFLICT_RETRIES: usize = 2;

#[derive(Serialize)]
struct User {
    id: i64,
    name: String,
}

#[derive(Clone, Deserialize, Serialize)]
struct Reservation {
    reservation_date: String,
    start_time: String,
    end_time: String,
    user_name: String,
    created_at: String,
}

#[derive(Deserialize, Serialize)]
struct RemoteDatabase {
    version: u8,
    reservations: Vec<Reservation>,
}

#[derive(Deserialize)]
struct GithubContentResponse {
    content: String,
    sha: String,
}

#[derive(Serialize)]
struct GithubUpdateRequest {
    message: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    sha: Option<String>,
}

#[derive(Serialize)]
struct SyncStatus {
    reservation_count: usize,
}

#[derive(Serialize)]
struct BookSlotResponse {
    reservations: Vec<Reservation>,
}

#[derive(Serialize)]
struct SlotActionResponse {
    reservations: Vec<Reservation>,
}

#[derive(Serialize)]
struct TokenStatus {
    configured: bool,
}

enum GithubWriteError {
    Conflict,
    Other(String),
}

impl fmt::Display for GithubWriteError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Conflict => write!(formatter, "GitHub write failed: {}", StatusCode::CONFLICT),
            Self::Other(message) => formatter.write_str(message),
        }
    }
}

fn connect(db_path: &PathBuf) -> Result<Connection, String> {
    Connection::open(db_path).map_err(|error| error.to_string())
}

fn migrate(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS reservations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                reservation_date TEXT NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                user_name TEXT NOT NULL,
                github_sha TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (reservation_date, start_time, end_time)
            );
            ",
        )
        .map_err(|error| error.to_string())
}

fn init_database(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;

    let db_path = app_data_dir.join("elowen.sqlite");
    let connection = connect(&db_path)?;
    migrate(&connection)?;

    Ok(db_path)
}

fn github_token_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&app_data_dir).map_err(|error| error.to_string())?;

    Ok(app_data_dir.join("github_token.txt"))
}

fn github_url() -> String {
    format!(
        "https://api.github.com/repos/{}/{}/contents/{}",
        GITHUB_OWNER, GITHUB_REPO, GITHUB_DB_PATH
    )
}

fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("Elowen Tauri App")
        .build()
        .map_err(|error| error.to_string())
}

fn read_token(app: &AppHandle) -> Result<String, String> {
    if let Ok(token) = env::var("ELOWEN_GITHUB_TOKEN") {
        let trimmed = token.trim();

        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    if let Ok(token_path) = github_token_path(app) {
        if let Ok(token) = fs::read_to_string(token_path) {
            let trimmed = token.trim();

            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }
    }

    if let Some(token) = BUNDLED_GITHUB_TOKEN {
        let trimmed = token.trim();

        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut token_paths = vec![
        PathBuf::from("token.txt"),
        PathBuf::from("../token.txt"),
        manifest_dir.join("token.txt"),
    ];

    if let Some(project_root) = manifest_dir.parent() {
        token_paths.push(project_root.join("token.txt"));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        token_paths.push(resource_dir.join("token.txt"));
    }

    if let Ok(resource_token_path) = app.path().resolve("../token.txt", BaseDirectory::Resource) {
        token_paths.push(resource_token_path);
    }

    for token_path in token_paths {
        if let Ok(token) = fs::read_to_string(token_path) {
            let trimmed = token.trim();

            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }
    }

    Err("GitHub token fehlt. Speichere ihn in den Einstellungen.".into())
}

fn write_app_token(app: &AppHandle, token: &str) -> Result<(), String> {
    let trimmed = token.trim();

    if trimmed.is_empty() {
        return Err("Token darf nicht leer sein.".into());
    }

    let token_path = github_token_path(app)?;
    fs::write(&token_path, trimmed).map_err(|error| error.to_string())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        let permissions = fs::Permissions::from_mode(0o600);
        fs::set_permissions(&token_path, permissions).map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn migrate_legacy_token(app: &AppHandle) -> Result<(), String> {
    if let Ok(token_path) = github_token_path(app) {
        if let Ok(token) = fs::read_to_string(token_path) {
            if !token.trim().is_empty() {
                return Ok(());
            }
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let mut token_paths = vec![
        PathBuf::from("token.txt"),
        PathBuf::from("../token.txt"),
        manifest_dir.join("token.txt"),
    ];

    if let Some(project_root) = manifest_dir.parent() {
        token_paths.push(project_root.join("token.txt"));
    }

    for token_path in token_paths {
        if let Ok(token) = fs::read_to_string(token_path) {
            let trimmed = token.trim();

            if !trimmed.is_empty() {
                return write_app_token(app, trimmed);
            }
        }
    }

    Ok(())
}

fn fetch_remote_database(token: &str) -> Result<(RemoteDatabase, Option<String>), String> {
    let response = client()?
        .get(github_url())
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
        .send()
        .map_err(|error| error.to_string())?;

    if response.status() == StatusCode::NOT_FOUND {
        return Ok((
            RemoteDatabase {
                version: 1,
                reservations: Vec::new(),
            },
            None,
        ));
    }

    if !response.status().is_success() {
        return Err(format!("GitHub read failed: {}", response.status()));
    }

    let content_response = response
        .json::<GithubContentResponse>()
        .map_err(|error| error.to_string())?;
    let encoded_content = content_response
        .content
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>();
    let decoded_content = STANDARD
        .decode(encoded_content)
        .map_err(|error| error.to_string())?;
    let yaml = String::from_utf8(decoded_content).map_err(|error| error.to_string())?;
    let database = if yaml.trim().is_empty() {
        RemoteDatabase {
            version: 1,
            reservations: Vec::new(),
        }
    } else {
        serde_yaml::from_str::<RemoteDatabase>(&yaml).map_err(|error| error.to_string())?
    };

    Ok((database, Some(content_response.sha)))
}

fn push_remote_database(
    token: &str,
    database: &RemoteDatabase,
    sha: Option<String>,
    message: String,
) -> Result<(), GithubWriteError> {
    let yaml = serde_yaml::to_string(database)
        .map_err(|error| GithubWriteError::Other(error.to_string()))?;
    let request = GithubUpdateRequest {
        message,
        content: STANDARD.encode(yaml),
        sha,
    };
    let response = client()
        .map_err(GithubWriteError::Other)?
        .put(github_url())
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
        .json(&request)
        .send()
        .map_err(|error| GithubWriteError::Other(error.to_string()))?;

    if response.status().is_success() {
        Ok(())
    } else if response.status() == StatusCode::CONFLICT {
        Err(GithubWriteError::Conflict)
    } else {
        Err(GithubWriteError::Other(format!(
            "GitHub write failed: {}",
            response.status()
        )))
    }
}

fn current_timestamp(connection: &Connection) -> Result<String, String> {
    connection
        .query_row("SELECT CURRENT_TIMESTAMP", [], |row| row.get(0))
        .map_err(|error| error.to_string())
}

fn slot_matches(
    reservation: &Reservation,
    reservation_date: &str,
    start_time: &str,
    end_time: &str,
) -> bool {
    reservation.reservation_date == reservation_date
        && reservation.start_time == start_time
        && reservation.end_time == end_time
}

fn replace_local_reservations(
    connection: &mut Connection,
    reservations: &[Reservation],
) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM reservations", [])
        .map_err(|error| error.to_string())?;

    for reservation in reservations {
        transaction
            .execute(
                "
                INSERT OR IGNORE INTO reservations (
                    reservation_date,
                    start_time,
                    end_time,
                    user_name,
                    created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5)
                ",
                params![
                    reservation.reservation_date.as_str(),
                    reservation.start_time.as_str(),
                    reservation.end_time.as_str(),
                    reservation.user_name.as_str(),
                    reservation.created_at.as_str()
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())
}

fn list_local_reservations(connection: &Connection) -> Result<Vec<Reservation>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT reservation_date, start_time, end_time, user_name, created_at
            FROM reservations
            ORDER BY reservation_date, start_time
            ",
        )
        .map_err(|error| error.to_string())?;
    let reservations = statement
        .query_map([], |row| {
            Ok(Reservation {
                reservation_date: row.get(0)?,
                start_time: row.get(1)?,
                end_time: row.get(2)?,
                user_name: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    Ok(reservations)
}

fn sync_remote_to_local(app: &AppHandle, db_path: &PathBuf) -> Result<Vec<Reservation>, String> {
    let token = read_token(app)?;
    let (remote_database, remote_sha) = fetch_remote_database(&token)?;
    let mut connection = connect(db_path)?;

    replace_local_reservations(&mut connection, &remote_database.reservations)?;

    if remote_sha.is_none() {
        push_remote_database(
            &token,
            &remote_database,
            None,
            "Create Elowen reservation database".into(),
        )
        .map_err(|error| error.to_string())?;
    }

    Ok(remote_database.reservations)
}

fn book_remote_slot(
    token: &str,
    reservation_date: &str,
    start_time: &str,
    end_time: &str,
    user_name: &str,
    created_at: &str,
) -> Result<Vec<Reservation>, String> {
    for attempt in 0..=GITHUB_CONFLICT_RETRIES {
        let (remote_database, remote_sha) = fetch_remote_database(token)?;
        let slot_is_taken = remote_database
            .reservations
            .iter()
            .any(|reservation| slot_matches(reservation, reservation_date, start_time, end_time));

        if slot_is_taken {
            return Err("Dieser Zeitslot ist bereits gebucht.".into());
        }

        let mut reservations = remote_database.reservations;
        reservations.push(Reservation {
            reservation_date: reservation_date.to_string(),
            start_time: start_time.to_string(),
            end_time: end_time.to_string(),
            user_name: user_name.to_string(),
            created_at: created_at.to_string(),
        });

        let updated_database = RemoteDatabase {
            version: 1,
            reservations: reservations.clone(),
        };
        let write_result = push_remote_database(
            token,
            &updated_database,
            remote_sha,
            format!(
                "Book Elowen slot {} {}-{}",
                reservation_date, start_time, end_time
            ),
        );

        match write_result {
            Ok(()) => return Ok(reservations),
            Err(GithubWriteError::Conflict) if attempt < GITHUB_CONFLICT_RETRIES => continue,
            Err(GithubWriteError::Conflict) => {
                return Err(
                    "Die Buchung wurde gleichzeitig geändert. Bitte versuche es erneut.".into(),
                )
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    Err("Die Buchung wurde gleichzeitig geändert. Bitte versuche es erneut.".into())
}

fn release_remote_slot(
    token: &str,
    reservation_date: &str,
    start_time: &str,
    end_time: &str,
    user_name: &str,
) -> Result<Vec<Reservation>, String> {
    for attempt in 0..=GITHUB_CONFLICT_RETRIES {
        let (remote_database, remote_sha) = fetch_remote_database(token)?;
        let reservation = remote_database
            .reservations
            .iter()
            .find(|reservation| slot_matches(reservation, reservation_date, start_time, end_time));

        match reservation {
            Some(reservation) if reservation.user_name == user_name => {}
            Some(_) => return Err("Du kannst nur deine eigenen Buchungen freigeben.".into()),
            None => return Err("Dieser Zeitslot ist nicht mehr gebucht.".into()),
        }

        let reservations = remote_database
            .reservations
            .into_iter()
            .filter(|reservation| {
                !slot_matches(reservation, reservation_date, start_time, end_time)
            })
            .collect::<Vec<_>>();
        let updated_database = RemoteDatabase {
            version: 1,
            reservations: reservations.clone(),
        };
        let write_result = push_remote_database(
            token,
            &updated_database,
            remote_sha,
            format!(
                "Release Elowen slot {} {}-{}",
                reservation_date, start_time, end_time
            ),
        );

        match write_result {
            Ok(()) => return Ok(reservations),
            Err(GithubWriteError::Conflict) if attempt < GITHUB_CONFLICT_RETRIES => continue,
            Err(GithubWriteError::Conflict) => {
                return Err(
                    "Die Buchung wurde gleichzeitig geändert. Bitte versuche es erneut.".into(),
                )
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    Err("Die Buchung wurde gleichzeitig geändert. Bitte versuche es erneut.".into())
}

#[tauri::command]
fn get_current_user(state: State<'_, AppState>) -> Result<Option<User>, String> {
    let connection = connect(&state.db_path)?;
    connection
        .query_row(
            "SELECT id, name FROM users ORDER BY id DESC LIMIT 1",
            [],
            |row| {
                Ok(User {
                    id: row.get(0)?,
                    name: row.get(1)?,
                })
            },
        )
        .optional()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn register_user(name: String, state: State<'_, AppState>) -> Result<User, String> {
    let trimmed_name = name.trim();

    if trimmed_name.is_empty() {
        return Err("Please enter your name.".into());
    }

    let connection = connect(&state.db_path)?;
    connection
        .execute("DELETE FROM users", [])
        .map_err(|error| error.to_string())?;
    connection
        .execute(
            "INSERT INTO users (name) VALUES (?1)",
            params![trimmed_name],
        )
        .map_err(|error| error.to_string())?;

    Ok(User {
        id: connection.last_insert_rowid(),
        name: trimmed_name.to_string(),
    })
}

#[tauri::command]
fn logout_user(state: State<'_, AppState>) -> Result<(), String> {
    let connection = connect(&state.db_path)?;
    connection
        .execute("DELETE FROM users", [])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_github_token_status(app: AppHandle) -> TokenStatus {
    TokenStatus {
        configured: read_token(&app).is_ok(),
    }
}

#[tauri::command]
fn save_github_token(token: String, app: AppHandle) -> Result<TokenStatus, String> {
    write_app_token(&app, &token)?;

    Ok(TokenStatus { configured: true })
}

#[tauri::command]
fn sync_reservations(app: AppHandle, state: State<'_, AppState>) -> Result<SyncStatus, String> {
    let reservations = sync_remote_to_local(&app, &state.db_path)?;

    Ok(SyncStatus {
        reservation_count: reservations.len(),
    })
}

#[tauri::command]
fn list_reservations(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<Reservation>, String> {
    match sync_remote_to_local(&app, &state.db_path) {
        Ok(reservations) => Ok(reservations),
        Err(error) => {
            eprintln!("reservation sync failed: {error}");
            let connection = connect(&state.db_path)?;
            list_local_reservations(&connection)
        }
    }
}

#[tauri::command]
fn book_time_slot(
    reservation_date: String,
    start_time: String,
    end_time: String,
    user_name: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BookSlotResponse, String> {
    let reservation_date = reservation_date.trim();
    let start_time = start_time.trim();
    let end_time = end_time.trim();
    let user_name = user_name.trim();

    if reservation_date.is_empty() || start_time.is_empty() || end_time.is_empty() {
        return Err("Ungültiger Zeitslot.".into());
    }

    if user_name.is_empty() {
        return Err("Bitte melde dich zuerst mit deinem Namen an.".into());
    }

    let token = read_token(&app)?;
    let mut connection = connect(&state.db_path)?;
    let created_at = current_timestamp(&connection)?;
    let reservations = book_remote_slot(
        &token,
        reservation_date,
        start_time,
        end_time,
        user_name,
        &created_at,
    )?;
    replace_local_reservations(&mut connection, &reservations)?;

    Ok(BookSlotResponse { reservations })
}

#[tauri::command]
fn release_time_slot(
    reservation_date: String,
    start_time: String,
    end_time: String,
    user_name: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<SlotActionResponse, String> {
    let reservation_date = reservation_date.trim();
    let start_time = start_time.trim();
    let end_time = end_time.trim();
    let user_name = user_name.trim();

    if reservation_date.is_empty() || start_time.is_empty() || end_time.is_empty() {
        return Err("Ungültiger Zeitslot.".into());
    }

    if user_name.is_empty() {
        return Err("Bitte melde dich zuerst mit deinem Namen an.".into());
    }

    let token = read_token(&app)?;
    let reservations =
        release_remote_slot(&token, reservation_date, start_time, end_time, user_name)?;

    let mut connection = connect(&state.db_path)?;
    replace_local_reservations(&mut connection, &reservations)?;

    Ok(SlotActionResponse { reservations })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db_path = init_database(app.handle()).expect("failed to initialize database");
            if let Err(error) = migrate_legacy_token(app.handle()) {
                eprintln!("failed to migrate GitHub token: {error}");
            }
            app.manage(AppState { db_path });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_current_user,
            register_user,
            logout_user,
            get_github_token_status,
            save_github_token,
            list_reservations,
            sync_reservations,
            book_time_slot,
            release_time_slot
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
