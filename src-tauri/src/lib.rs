use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use std::sync::Mutex;
use tauri::command;

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

// ── App state (entries stored server-side so filtering never serializes them) ─

pub struct AppState {
    pub entries: Mutex<Vec<LogEntry>>,
}

// ── Commands ─────────────────────────────────────────────────────────────────

/// Load and parse a structured log file (NDJSON / JSON array).
/// Stores the parsed entries in app state and returns metadata + entries for
/// the initial render. Subsequent filter calls operate on the stored state.
#[command]
pub async fn parse_log_file(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<ParseResult, String> {
    let file = File::open(&path).map_err(|e| format!("Cannot open file: {e}"))?;
    let reader = BufReader::new(file);

    let mut entries: Vec<LogEntry> = Vec::new();
    let mut all_fields: HashSet<String> = HashSet::new();
    let mut parse_errors = 0usize;
    let mut total_lines = 0usize;

    for line in reader.lines() {
        let line = line.map_err(|e| e.to_string())?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        total_lines += 1;
        let id = entries.len();

        match serde_json::from_str::<serde_json::Value>(trimmed) {
            Ok(value) => {
                if let Some(obj) = value.as_object() {
                    let fields: HashMap<_, _> = obj.clone().into_iter().collect();
                    for k in fields.keys() {
                        all_fields.insert(k.clone());
                    }
                    entries.push(LogEntry { id, raw: trimmed.to_string(), fields });
                } else {
                    let mut fields = HashMap::new();
                    fields.insert("_value".to_string(), value);
                    all_fields.insert("_value".to_string());
                    entries.push(LogEntry { id, raw: trimmed.to_string(), fields });
                }
            }
            Err(_) => {
                parse_errors += 1;
                let mut fields = HashMap::new();
                fields.insert("_raw".to_string(), serde_json::Value::String(trimmed.to_string()));
                all_fields.insert("_raw".to_string());
                entries.push(LogEntry { id, raw: trimmed.to_string(), fields });
            }
        }
    }

    // Sort fields: well-known log fields first, then alphabetical
    let priority = [
        "timestamp", "time", "ts", "@timestamp",
        "level", "severity", "lvl",
        "message", "msg", "error", "err",
        "service", "host", "caller",
    ];

    let mut fields: Vec<String> = all_fields.into_iter().collect();
    fields.sort_by(|a, b| {
        let ai = priority.iter().position(|&p| p == a.as_str()).unwrap_or(usize::MAX);
        let bi = priority.iter().position(|&p| p == b.as_str()).unwrap_or(usize::MAX);
        ai.cmp(&bi).then(a.cmp(b))
    });

    let result = ParseResult {
        entries: entries.clone(),
        fields,
        total_lines,
        parse_errors,
    };

    *state.entries.lock().unwrap() = entries;

    Ok(result)
}

/// Fast full-text or regex filter across all fields. Returns matching entry IDs.
/// Text mode: space-separated terms = AND logic.
/// Regex mode: single pattern matched against the raw JSON string.
#[command]
pub async fn filter_entries(
    query: String,
    use_regex: bool,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<usize>, String> {
    let entries = state.entries.lock().unwrap();

    if query.trim().is_empty() {
        return Ok(entries.iter().map(|e| e.id).collect());
    }

    if use_regex {
        let re = Regex::new(&query).map_err(|e| format!("Invalid regex: {e}"))?;
        let ids = entries
            .iter()
            .filter(|entry| re.is_match(&entry.raw))
            .map(|e| e.id)
            .collect();
        return Ok(ids);
    }

    let terms: Vec<String> = query
        .split_whitespace()
        .map(|t| t.to_lowercase())
        .collect();

    let ids = entries
        .iter()
        .filter(|entry| {
            let raw_lower = entry.raw.to_lowercase();
            terms.iter().all(|term| raw_lower.contains(term.as_str()))
        })
        .map(|e| e.id)
        .collect();

    Ok(ids)
}

/// Write filtered entries to a file. `ids` is the set of matching entry IDs.
#[command]
pub async fn export_filtered(
    dest_path: String,
    ids: Vec<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<usize, String> {
    let entries = state.entries.lock().unwrap();
    let id_set: HashSet<usize> = ids.into_iter().collect();

    let mut file = File::create(&dest_path).map_err(|e| format!("Cannot create file: {e}"))?;
    let mut count = 0usize;

    for entry in entries.iter() {
        if id_set.contains(&entry.id) {
            writeln!(file, "{}", entry.raw).map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    Ok(count)
}

// ── App bootstrap ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState { entries: Mutex::new(Vec::new()) })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            parse_log_file,
            filter_entries,
            export_filtered,
        ])
        .run(tauri::generate_context!())
        .expect("error while running logdrop");
}
