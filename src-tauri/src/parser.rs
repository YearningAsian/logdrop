use std::collections::{HashMap, HashSet};
use std::io::BufRead;

use crate::LogEntry;

pub const PRIORITY_FIELDS: &[&str] = &[
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
            // Move the parsed map instead of cloning it — the clone doubled
            // allocation work for every line of large files.
            Ok(serde_json::Value::Object(obj)) => {
                let fields: HashMap<_, _> = obj.into_iter().collect();
                for k in fields.keys() {
                    all_fields.insert(k.clone());
                }
                entries.push(LogEntry {
                    id,
                    raw: trimmed,
                    fields,
                });
            }
            Ok(value) => {
                let mut fields = HashMap::new();
                fields.insert("_value".to_string(), value);
                all_fields.insert("_value".to_string());
                entries.push(LogEntry {
                    id,
                    raw: trimmed,
                    fields,
                });
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn parse_valid_ndjson() {
        let input = r#"{"level":"info","msg":"started"}
{"level":"error","msg":"boom"}"#;
        let (entries, fields, total, errors) = parse_ndjson(Cursor::new(input));
        assert_eq!(entries.len(), 2);
        assert_eq!(total, 2);
        assert_eq!(errors, 0);
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
}
