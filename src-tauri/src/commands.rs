use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader, Write};
use tauri_plugin_dialog::DialogExt;

use crate::{AppState, LogEntry, ParseResult};

/// Entries are held in memory (once in Rust state, once in the webview), so cap
/// input size to avoid OOM on accidental drops of multi-GB binaries or huge logs.
const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024; // 1 GiB

// ── Pure helpers (unit-testable) ──────────────────────────────────────────────

const PRIORITY_FIELDS: &[&str] = &[
    "timestamp",
    "time",
    "ts",
    "@timestamp",
    "level",
    "severity",
    "lvl",
    "message",
    "msg",
    "error",
    "err",
    "service",
    "host",
    "caller",
];

pub fn parse_ndjson(reader: impl BufRead) -> (Vec<LogEntry>, Vec<String>, usize, usize) {
    let mut entries: Vec<LogEntry> = Vec::new();
    let mut all_fields: HashSet<String> = HashSet::new();
    let mut parse_errors = 0usize;
    let mut total_lines = 0usize;

    for line in reader.lines().map_while(Result::ok) {
        let trimmed = line.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }
        total_lines += 1;
        let id = entries.len();

        match serde_json::from_str::<serde_json::Value>(&trimmed) {
            Ok(value) => {
                if let Some(obj) = value.as_object() {
                    let fields: HashMap<_, _> = obj.clone().into_iter().collect();
                    for k in fields.keys() {
                        all_fields.insert(k.clone());
                    }
                    entries.push(LogEntry {
                        id,
                        raw: trimmed,
                        fields,
                    });
                } else {
                    let mut fields = HashMap::new();
                    fields.insert("_value".to_string(), value);
                    all_fields.insert("_value".to_string());
                    entries.push(LogEntry {
                        id,
                        raw: trimmed,
                        fields,
                    });
                }
            }
            Err(_) => {
                parse_errors += 1;
                let mut fields = HashMap::new();
                fields.insert(
                    "_raw".to_string(),
                    serde_json::Value::String(trimmed.clone()),
                );
                all_fields.insert("_raw".to_string());
                entries.push(LogEntry {
                    id,
                    raw: trimmed,
                    fields,
                });
            }
        }
    }

    let mut fields: Vec<String> = all_fields.into_iter().collect();
    fields.sort_by(|a, b| {
        let ai = PRIORITY_FIELDS
            .iter()
            .position(|&p| p == a.as_str())
            .unwrap_or(usize::MAX);
        let bi = PRIORITY_FIELDS
            .iter()
            .position(|&p| p == b.as_str())
            .unwrap_or(usize::MAX);
        ai.cmp(&bi).then(a.cmp(b))
    });

    (entries, fields, total_lines, parse_errors)
}

pub fn filter_text(entries: &[LogEntry], query: &str) -> Vec<usize> {
    if query.trim().is_empty() {
        return entries.iter().map(|e| e.id).collect();
    }
    let terms: Vec<String> = query.split_whitespace().map(|t| t.to_lowercase()).collect();
    entries
        .iter()
        .filter(|e| {
            let raw = e.raw.to_lowercase();
            terms.iter().all(|t| raw.contains(t.as_str()))
        })
        .map(|e| e.id)
        .collect()
}

pub fn filter_regex(entries: &[LogEntry], pattern: &str) -> Result<Vec<usize>, String> {
    let re = Regex::new(pattern).map_err(|e| format!("Invalid regex: {e}"))?;
    Ok(entries
        .iter()
        .filter(|e| re.is_match(&e.raw))
        .map(|e| e.id)
        .collect())
}

// ── Commands ──────────────────────────────────────────────────────────────────

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

    *state.entries.lock().unwrap() = entries;
    Ok(result)
}

/// Full-text (AND) or regex filter over stored entries. Returns matching IDs.
/// Only the query string travels over IPC — never the entry data.
#[tauri::command]
pub async fn filter_entries(
    query: String,
    use_regex: bool,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<usize>, String> {
    let entries = state.entries.lock().unwrap();
    if use_regex {
        filter_regex(&entries, &query)
    } else {
        Ok(filter_text(&entries, &query))
    }
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
        return Ok(None); // user cancelled
    };
    let dest = file_path.into_path().map_err(|e| e.to_string())?;

    let entries = state.entries.lock().unwrap();
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

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn make_entries(raws: &[&str]) -> Vec<LogEntry> {
        let (entries, _, _, _) = parse_ndjson(Cursor::new(raws.join("\n")));
        entries
    }

    // ── parse_ndjson ──────────────────────────────────────────────────────────

    #[test]
    fn parse_valid_ndjson() {
        let input = r#"{"level":"info","msg":"started"}
{"level":"error","msg":"boom"}"#;
        let (entries, fields, total, errors) = parse_ndjson(Cursor::new(input));
        assert_eq!(entries.len(), 2);
        assert_eq!(total, 2);
        assert_eq!(errors, 0);
        // level and msg should be near the front
        assert!(fields.contains(&"level".to_string()));
        assert!(fields.contains(&"msg".to_string()));
    }

    #[test]
    fn parse_non_json_lines_stored_as_raw() {
        let input = "not json at all\n{\"ok\":true}";
        let (entries, _, total, errors) = parse_ndjson(Cursor::new(input));
        assert_eq!(total, 2);
        assert_eq!(errors, 1);
        assert!(entries[0].fields.contains_key("_raw"));
        assert!(entries[1].fields.contains_key("ok"));
    }

    #[test]
    fn parse_skips_blank_lines() {
        let input = "\n{\"a\":1}\n\n{\"b\":2}\n";
        let (entries, _, total, _) = parse_ndjson(Cursor::new(input));
        assert_eq!(total, 2);
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn parse_scalar_json_stored_as_value() {
        let input = "42\ntrue";
        let (entries, _, _, errors) = parse_ndjson(Cursor::new(input));
        assert_eq!(errors, 0);
        assert!(entries[0].fields.contains_key("_value"));
    }

    #[test]
    fn field_sort_priority_order() {
        let input = r#"{"service":"svc","timestamp":"2024-01-01","level":"info","message":"hi","extra":"x"}"#;
        let (_, fields, _, _) = parse_ndjson(Cursor::new(input));
        let ts_idx = fields.iter().position(|f| f == "timestamp").unwrap();
        let lvl_idx = fields.iter().position(|f| f == "level").unwrap();
        let msg_idx = fields.iter().position(|f| f == "message").unwrap();
        let extra_idx = fields.iter().position(|f| f == "extra").unwrap();
        assert!(ts_idx < lvl_idx);
        assert!(lvl_idx < msg_idx);
        assert!(msg_idx < extra_idx);
    }

    // ── filter_text ───────────────────────────────────────────────────────────

    #[test]
    fn filter_text_empty_query_returns_all() {
        let entries = make_entries(&[r#"{"a":1}"#, r#"{"b":2}"#]);
        let ids = filter_text(&entries, "");
        assert_eq!(ids.len(), 2);
    }

    #[test]
    fn filter_text_single_term() {
        let entries = make_entries(&[r#"{"msg":"hello world"}"#, r#"{"msg":"goodbye"}"#]);
        let ids = filter_text(&entries, "hello");
        assert_eq!(ids, vec![0]);
    }

    #[test]
    fn filter_text_and_logic() {
        let entries = make_entries(&[r#"{"msg":"alpha beta gamma"}"#, r#"{"msg":"alpha only"}"#]);
        let ids = filter_text(&entries, "alpha beta");
        assert_eq!(ids, vec![0]);
    }

    #[test]
    fn filter_text_case_insensitive() {
        let entries = make_entries(&[r#"{"msg":"ERROR"}"#]);
        let ids = filter_text(&entries, "error");
        assert_eq!(ids, vec![0]);
    }

    #[test]
    fn filter_text_no_match_returns_empty() {
        let entries = make_entries(&[r#"{"msg":"hello"}"#]);
        let ids = filter_text(&entries, "xyz");
        assert!(ids.is_empty());
    }

    // ── filter_regex ──────────────────────────────────────────────────────────

    #[test]
    fn filter_regex_basic_pattern() {
        let entries = make_entries(&[
            r#"{"level":"error","msg":"timeout"}"#,
            r#"{"level":"info","msg":"ok"}"#,
        ]);
        let ids = filter_regex(&entries, "error").unwrap();
        assert_eq!(ids, vec![0]);
    }

    #[test]
    fn filter_regex_anchored() {
        let entries = make_entries(&[r#"{"code":404}"#, r#"{"code":200}"#]);
        let ids = filter_regex(&entries, r#""code":4\d\d"#).unwrap();
        assert_eq!(ids, vec![0]);
    }

    #[test]
    fn filter_regex_invalid_pattern_errors() {
        let entries = make_entries(&[r#"{"a":1}"#]);
        assert!(filter_regex(&entries, "[invalid").is_err());
    }

    #[test]
    fn filter_regex_empty_pattern_matches_all() {
        let entries = make_entries(&[r#"{"a":1}"#, r#"{"b":2}"#]);
        let ids = filter_regex(&entries, "").unwrap();
        assert_eq!(ids.len(), 2);
    }
}
