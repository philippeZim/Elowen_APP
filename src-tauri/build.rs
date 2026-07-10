fn main() {
    let out_dir = std::env::var("OUT_DIR").expect("OUT_DIR is not set");
    let token_file = std::path::Path::new(&out_dir).join("bundled_token.rs");

    println!("cargo:rerun-if-changed=../token.txt");

    let token = std::fs::read_to_string("../token.txt")
        .ok()
        .map(|token| token.trim().to_string())
        .filter(|token| !token.is_empty());
    let token_source = match token {
        Some(token) => format!(
            "const BUNDLED_GITHUB_TOKEN: Option<&str> = Some({});",
            format!("{token:?}")
        ),
        None => "const BUNDLED_GITHUB_TOKEN: Option<&str> = None;".to_string(),
    };

    std::fs::write(token_file, token_source).expect("failed to write bundled token source");

    tauri_build::build()
}
