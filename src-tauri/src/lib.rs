use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LogEntry {
    pub id: usize,
    pub raw: String,
    pub fields: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ParseResult {
    pub entries: Vec<LogEntry>,
    pub fields: Vec<String>,
    pub total_lines: usize,
    pub parse_errors: usize,
}

// ── App state ─────────────────────────────────────────────────────────────────

/// Parsed entries are kept in Rust state (keyed by the frontend's tab id) so
/// filter/facet/export calls never re-send entry data over IPC. Keying by tab
/// is essential for correctness: with multiple files open, a single shared
/// buffer would make `filter_entries`/`export_filtered` for one tab run against
/// whichever file was loaded last.
pub struct AppState {
    pub tabs: Mutex<HashMap<String, Vec<LogEntry>>>,
}

// ── Sub-modules ───────────────────────────────────────────────────────────────

mod commands;
pub mod facets;
pub mod filter;
pub mod parser;

// ── App bootstrap ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            tabs: Mutex::new(HashMap::new()),
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::parse_log_file,
            commands::filter_entries,
            commands::export_filtered,
            commands::get_field_facets,
            commands::release_entries,
        ])
        .run(tauri::generate_context!())
        .expect("error while running logdrop");
}
