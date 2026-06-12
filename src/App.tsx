import { useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useLogStore } from "./lib/store";
import { ParseResult } from "./lib/types";
import { DropZone } from "./components/DropZone";
import { FilterBar } from "./components/FilterBar";
import { LogTable } from "./components/LogTable";
import { DetailPanel } from "./components/DetailPanel";
import { Loader2 } from "lucide-react";

export default function App() {
  const {
    filePath, entries, isLoading, loadError,
    filter, filterMode, setFile, setParseResult, setFilter, setFilteredIds, setFilterError, setLoading, setLoadError, reset,
  } = useLogStore();

  // ── File loading ────────────────────────────────────────────────────────────

  const loadFile = useCallback(async (path: string) => {
    setLoading(true);
    setFile(path);
    try {
      const result = await invoke<ParseResult>("parse_log_file", { path });
      setParseResult(result.entries, result.fields, result.total_lines, result.parse_errors);
    } catch (err) {
      console.error("Failed to parse log file:", err);
      reset(); // back to the drop screen instead of an empty table
      setLoadError(String(err));
    } finally {
      setLoading(false);
    }
  }, [setFile, setLoading, setParseResult, setLoadError, reset]);

  const browseFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [
        { name: "Log files", extensions: ["log", "json", "ndjson", "jsonl", "txt"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (typeof selected === "string") {
      await loadFile(selected);
    }
  }, [loadFile]);

  // ── Filter — entries are stored in Rust state, only the query travels IPC ──

  const filterSeq = useRef(0);

  useEffect(() => {
    if (entries.length === 0) return;
    const seq = ++filterSeq.current;

    // Empty query matches everything — resolve locally instead of paying an
    // IPC round-trip that serializes every entry id back to the webview.
    if (filter.trim() === "") {
      setFilterError(null);
      setFilteredIds(entries.map((e) => e.id));
      return;
    }

    const debounce = setTimeout(async () => {
      try {
        const ids = await invoke<number[]>("filter_entries", {
          query: filter,
          useRegex: filterMode === "regex",
        });
        if (seq !== filterSeq.current) return; // stale response — a newer query won
        setFilterError(null);
        setFilteredIds(ids);
      } catch (err) {
        if (seq !== filterSeq.current) return;
        const msg = String(err).replace(/^.*Invalid regex:\s*/, "");
        setFilterError(msg);
      }
    }, 150);

    return () => clearTimeout(debounce);
  }, [filter, filterMode, entries, setFilteredIds, setFilterError]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "o") {
        e.preventDefault();
        browseFile();
      }
      if (e.key === "Escape" && filter) {
        setFilter("");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [browseFile, filter, setFilter]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center w-screen h-screen bg-[#0a0f1a]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={32} className="text-sky-400 animate-spin" />
          <p className="text-slate-400 text-sm font-mono">Parsing log file…</p>
        </div>
      </div>
    );
  }

  if (!filePath) {
    return (
      <div className="w-screen h-screen bg-[#0a0f1a] flex flex-col">
        <div className="flex items-center justify-between px-4 h-11 border-b border-slate-800/60">
          <span className="text-slate-400 font-mono text-sm font-semibold tracking-tight">
            logdrop
          </span>
          <span className="text-xs text-slate-700 font-mono">
            ⌘O to open
          </span>
        </div>
        {loadError && (
          <div className="px-4 py-2 text-xs font-mono text-red-400 bg-red-950/40 border-b border-red-900/40" role="alert">
            {loadError}
          </div>
        )}
        <DropZone onFileDrop={loadFile} onBrowse={browseFile} />
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-[#0a0f1a] flex flex-col overflow-hidden">
      <FilterBar onBrowse={browseFile} />

      <div className="flex-1 flex overflow-hidden">
        <LogTable />
        <DetailPanel />
      </div>
    </div>
  );
}
