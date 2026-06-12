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

pub struct AppState {
    pub entries: Mutex<Vec<LogEntry>>,
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
            entries: Mutex::new(Vec::new()),
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::parse_log_file,
            commands::filter_entries,
            commands::export_filtered,
            commands::get_field_facets,
        ])
        .run(tauri::generate_context!())
        .expect("error while running logdrop");
}
