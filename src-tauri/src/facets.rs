use std::collections::HashMap;

use crate::LogEntry;

/// Fields targeted by facet computation.
pub const FACET_FIELDS: &[&str] = &["level", "service", "status", "method", "path"];

/// Maximum distinct values returned per facet field.
pub const MAX_FACET_VALUES: usize = 20;

/// Compute facet values for a fixed set of well-known fields.
///
/// Returns `field → [(value, count)]` sorted by frequency descending, capped at
/// `MAX_FACET_VALUES` entries per field.  Only fields that have at least one
/// non-null value in `entries` appear in the output map.
pub fn compute_facets(entries: &[LogEntry]) -> HashMap<String, Vec<(String, usize)>> {
    let mut counts: HashMap<&str, HashMap<String, usize>> = HashMap::new();

    for entry in entries {
        for &field in FACET_FIELDS {
            if let Some(val) = entry.fields.get(field) {
                let s = match val {
                    serde_json::Value::String(s) => s.clone(),
                    serde_json::Value::Number(n) => n.to_string(),
                    serde_json::Value::Bool(b) => b.to_string(),
                    _ => continue,
                };
                *counts.entry(field).or_default().entry(s).or_insert(0) += 1;
            }
        }
    }

    counts
        .into_iter()
        .map(|(field, val_counts)| {
            let mut pairs: Vec<(String, usize)> = val_counts.into_iter().collect();
            pairs.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
            pairs.truncate(MAX_FACET_VALUES);
            (field.to_string(), pairs)
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

    #[test]
    fn facets_counts_levels() {
        let entries = make_entries(&[
            r#"{"level":"info"}"#,
            r#"{"level":"info"}"#,
            r#"{"level":"error"}"#,
        ]);
        let facets = compute_facets(&entries);
        let level_facet = facets.get("level").expect("level facet should exist");
        assert_eq!(level_facet[0], ("info".to_string(), 2));
        assert_eq!(level_facet[1], ("error".to_string(), 1));
    }

    #[test]
    fn facets_missing_field_not_in_output() {
        let entries = make_entries(&[r#"{"msg":"no level here"}"#]);
        let facets = compute_facets(&entries);
        assert!(!facets.contains_key("level"));
    }
}
