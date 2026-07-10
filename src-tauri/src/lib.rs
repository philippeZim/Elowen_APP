use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager, State};

struct AppState {
    db_path: PathBuf,
}

#[derive(Serialize)]
struct User {
    id: i64,
    name: String,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db_path = init_database(app.handle()).expect("failed to initialize database");
            app.manage(AppState { db_path });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_current_user,
            register_user,
            logout_user
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
