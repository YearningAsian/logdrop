use chrono::{DateTime, FixedOffset};
use regex::Regex;

use crate::LogEntry;

/// Fields used to probe for a log line's timestamp.
pub const TIMESTAMP_FIELDS: &[&str] = &["timestamp", "time", "ts", "@timestamp"];

pub fn filter_text(entries: &[LogEntry], query: &str) -> Vec<usize> {
    if query.trim().is_empty() {
        return entries.iter().map(|e| e.id).collect();
    }
    // NOTE: benchmarked against case-insensitive regex literal matchers
    // (regex::escape + RegexBuilder::case_insensitive) — this lowercase +
    // contains approach was ~2x faster on typical short NDJSON lines.
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

/// Try to parse an ISO 8601 / RFC 3339 timestamp from an entry's known timestamp fields.
/// Returns `None` if none of the fields exist or can be parsed.
fn entry_timestamp(entry: &LogEntry) -> Option<DateTime<FixedOffset>> {
    for &field in TIMESTAMP_FIELDS {
        if let Some(serde_json::Value::String(s)) = entry.fields.get(field) {
            if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
                return Some(dt);
            }
        }
    }
    None
}

/// Filter entries by an optional time range.
///
/// `time_from` / `time_to` are ISO 8601 strings (e.g. `"2024-01-15T00:00:00Z"`).
/// Entries whose timestamp cannot be parsed are **included** (pass-through) to
/// avoid silently dropping unstructured lines.
pub fn filter_time_range(
    ids: Vec<usize>,
    entries: &[LogEntry],
    time_from: Option<&str>,
    time_to: Option<&str>,
) -> Vec<usize> {
    let from: Option<DateTime<FixedOffset>> =
        time_from.and_then(|s| DateTime::parse_from_rfc3339(s).ok());
    let to: Option<DateTime<FixedOffset>> =
        time_to.and_then(|s| DateTime::parse_from_rfc3339(s).ok());

    if from.is_none() && to.is_none() {
        return ids;
    }

    ids.into_iter()
        .filter(|&id| {
            let entry = match entries.get(id) {
                Some(e) => e,
                None => return true,
            };
            match entry_timestamp(entry) {
                None => true,
                Some(ts) => {
                    if let Some(f) = from {
                        if ts < f {
                            return false;
                        }
                    }
                    if let Some(t) = to {
                        if ts > t {
                            return false;
                        }
                    }
                    true
                }
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::parse_ndjson;
    use std::io::Cursor;

    fn make_entries(raws: &[&str]) -> Vec<LogEntry> {
        let (entries, _, _, _) = parse_ndjson(Cursor::new(raws.join("\n")));
        entries
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

    // ── filter_time_range ─────────────────────────────────────────────────────

    #[test]
    fn time_range_no_bounds_returns_all() {
        let entries = make_entries(&[
            r#"{"timestamp":"2024-01-15T10:00:00Z","msg":"a"}"#,
            r#"{"timestamp":"2024-01-15T12:00:00Z","msg":"b"}"#,
        ]);
        let ids: Vec<usize> = entries.iter().map(|e| e.id).collect();
        let result = filter_time_range(ids.clone(), &entries, None, None);
        assert_eq!(result, ids);
    }

    #[test]
    fn time_range_from_filters_earlier_entries() {
        let entries = make_entries(&[
            r#"{"timestamp":"2024-01-15T09:00:00Z","msg":"before"}"#,
            r#"{"timestamp":"2024-01-15T11:00:00Z","msg":"after"}"#,
        ]);
        let ids: Vec<usize> = entries.iter().map(|e| e.id).collect();
        let result = filter_time_range(ids, &entries, Some("2024-01-15T10:00:00Z"), None);
        assert_eq!(result, vec![1]);
    }

    #[test]
    fn time_range_to_filters_later_entries() {
        let entries = make_entries(&[
            r#"{"timestamp":"2024-01-15T09:00:00Z","msg":"before"}"#,
            r#"{"timestamp":"2024-01-15T11:00:00Z","msg":"after"}"#,
        ]);
        let ids: Vec<usize> = entries.iter().map(|e| e.id).collect();
        let result = filter_time_range(ids, &entries, None, Some("2024-01-15T10:00:00Z"));
        assert_eq!(result, vec![0]);
    }

    #[test]
    fn time_range_no_timestamp_field_included() {
        let entries = make_entries(&[r#"{"msg":"no timestamp here"}"#]);
        let ids: Vec<usize> = entries.iter().map(|e| e.id).collect();
        let result = filter_time_range(
            ids,
            &entries,
            Some("2024-01-01T00:00:00Z"),
            Some("2024-01-02T00:00:00Z"),
        );
        assert_eq!(result, vec![0]);
    }
}
