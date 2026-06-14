# logdrop

Offline-first structured log explorer. Drop a log file, query it. No stack, no server, no setup.

**The gap it fills:** CLI tools like `hl`/`klp` are great for tailing, and web viewers like Logdy exist, but there's no polished desktop app that feels like Kibana without the overhead. logdrop is that app.

## Features

- **Drop any NDJSON / JSON log file** — auto-detects fields, no config
- **Virtualized table** — handles millions of entries without lag
- **Instant full-text filter** — space-separated terms = AND logic, 150ms debounce
- **Regex filter mode** — toggle the `/.*/` button or hit it to switch modes; invalid patterns show inline
- **Dynamic columns** — toggle visible fields with one click
- **Detail panel** — collapsible JSON tree, copy to clipboard
- **Level-aware styling** — trace/debug/info/warn/error/fatal color-coded
- **Export filtered results** — save matching entries as NDJSON
- **Fully offline** — Tauri desktop app, no network required

## Stack

- **Frontend:** React 19 + TypeScript 6 + Vite + Tailwind CSS 4
- **Table:** TanStack Table v8 + TanStack Virtual (row virtualization)
- **State:** Zustand
- **Backend:** Tauri 2 + Rust (file I/O, NDJSON parsing, filtering with the `regex` crate)

## Getting started

### Prerequisites

- [Node.js 20+](https://nodejs.org/)
- [Rust](https://rustup.rs/)
- Tauri prerequisites for your platform: https://v2.tauri.app/start/prerequisites/

### Dev

```bash
npm install
npm run tauri dev
```

### Build

```bash
npm run tauri build
```

Output installers are in `src-tauri/target/release/bundle/`.

## Log format

Any NDJSON file (one JSON object per line):

```json
{"timestamp":"2024-01-15T10:23:01Z","level":"info","service":"api","message":"request received","method":"GET","path":"/health","duration_ms":2}
{"timestamp":"2024-01-15T10:23:02Z","level":"error","service":"api","message":"database timeout","error":"context deadline exceeded","duration_ms":5002}
```

Mixed-format files work too — non-JSON lines are stored under `_raw`.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘O` / `Ctrl+O` | Open file |
| `Esc` | Clear filter |

## Roadmap

- [ ] Time range picker (detect timestamp fields automatically)
- [ ] Field value facets (sidebar with top values per field, click to filter)
- [ ] Multiple files / tabs
- [ ] Saved queries
- [ ] Streaming tail mode (watch file for new lines)
- [x] Regex filter mode
- [x] Export filtered results

## License

MIT
