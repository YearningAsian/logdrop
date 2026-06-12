use std::collections::HashSet;
use std::fs::File;
use std::io::{BufReader, Write};
use tauri_plugin_dialog::DialogExt;

use crate::facets::compute_facets;
use crate::filter::{filter_regex, filter_text, filter_time_range};
use crate::parser::parse_ndjson;
use crate::{AppState, ParseResult};

/// Entries are held in memory (once in Rust state, once in the webview), so cap
/// input size to avoid OOM on accidental drops of multi-GB binaries or huge logs.
const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024; // 1 GiB

/// Load and parse a structured log file (NDJSON / JSON array).
/// Stores entries in app state so subsequent filter calls never re-send them over IPC.
#[tauri::command]
pub async fn parse_log_file(
    path: String,
    state: tauri::State<'_, AppState>,
) -> Result<ParseResult, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("Cannot open file: {e}"))?;
    if !meta.is_file() {
        return Err("Not a regular file".to_string());
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(format!(
            "File is {:.1} GB — logdrop loads files into memory and currently caps input at 1 GB",
            meta.len() as f64 / (1024.0 * 1024.0 * 1024.0)
        ));
    }

    let file = File::open(&path).map_err(|e| format!("Cannot open file: {e}"))?;
    let (entries, fields, total_lines, parse_errors) = parse_ndjson(BufReader::new(file));

    let result = ParseResult {
        entries: entries.clone(),
        fields,
        total_lines,
        parse_errors,
    };

    *state.entries.lock().unwrap_or_else(|p| p.into_inner()) = entries;
    Ok(result)
}

/// Full-text (AND) or regex filter over stored entries, with optional time range.
/// Returns matching IDs. Only the query string and bounds travel over IPC — never
/// the entry data.
#[tauri::command]
pub async fn filter_entries(
    query: String,
    use_regex: bool,
    time_from: Option<String>,
    time_to: Option<String>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<usize>, String> {
    let entries = state.entries.lock().unwrap_or_else(|p| p.into_inner());

    let ids = if use_regex {
        filter_regex(&entries, &query)?
    } else {
        filter_text(&entries, &query)
    };

    Ok(filter_time_range(
        ids,
        &entries,
        time_from.as_deref(),
        time_to.as_deref(),
    ))
}

/// Compute field facets from the stored entries (values + frequencies for a
/// fixed set of common structured-log fields).
///
/// Returns `{ field: [[value, count], ...] }` — only fields with at least one
/// entry appear.  Sorted by frequency, capped at 20 values per field.
#[tauri::command]
pub async fn get_field_facets(
    state: tauri::State<'_, AppState>,
) -> Result<std::collections::HashMap<String, Vec<(String, usize)>>, String> {
    let entries = state.entries.lock().unwrap_or_else(|p| p.into_inner());
    Ok(compute_facets(&entries))
}

/// Write filtered entries to a user-chosen file as NDJSON.
///
/// The destination is picked via a native save dialog opened from Rust, so the
/// webview never supplies a write path over IPC (no path traversal surface).
/// Returns `None` when the user cancels the dialog.
#[tauri::command]
pub async fn export_filtered(
    app: tauri::AppHandle,
    ids: Vec<usize>,
    state: tauri::State<'_, AppState>,
) -> Result<Option<usize>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("NDJSON", &["ndjson", "jsonl"])
            .set_file_name("export.ndjson")
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(file_path) = picked else {
        return Ok(None);
    };
    let dest = file_path.into_path().map_err(|e| e.to_string())?;

    let entries = state.entries.lock().unwrap_or_else(|p| p.into_inner());
    let id_set: HashSet<usize> = ids.into_iter().collect();

    let mut file = File::create(&dest).map_err(|e| format!("Cannot create file: {e}"))?;
    let mut count = 0usize;

    for entry in entries.iter() {
        if id_set.contains(&entry.id) {
            writeln!(file, "{}", entry.raw).map_err(|e| e.to_string())?;
            count += 1;
        }
    }

    Ok(Some(count))
}
