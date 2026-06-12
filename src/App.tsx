import { useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useLogStore } from "./lib/store";
import { useFilterPipeline } from "./lib/useFilterPipeline";
import { ParseResult, FieldFacets } from "./lib/types";
import { DropZone } from "./components/DropZone";
import { FilterBar } from "./components/FilterBar";
import { LogTable } from "./components/LogTable";
import { DetailPanel } from "./components/DetailPanel";
import { TabBar } from "./components/TabBar";
import { FacetPanel } from "./components/FacetPanel";
import { Loader2 } from "lucide-react";

export default function App() {
  const {
    tabs,
    activeTabId,
    isLoading,
    loadError,
    openTab,
    setParseResult,
    setFilter,
    setFacets,
    setLoading,
    setLoadError,
    activeTab,
  } = useLogStore();

  // activeTab() is a store selector — call it as a function to get the live tab
  const tab = activeTab();

  // ── File loading ─────────────────────────────────────────────────────────────

  const loadFile = useCallback(
    async (path: string) => {
      setLoading(true);
      // Extract filename
      const parts = path.replace(/\\/g, "/").split("/");
      const fileName = parts[parts.length - 1] ?? path;
      const tabId = openTab(path, fileName);
      try {
        const result = await invoke<ParseResult>("parse_log_file", {
          tabId,
          path,
        });
        setParseResult(
          tabId,
          result.entries,
          result.fields,
          result.total_lines,
          result.parse_errors,
        );
        // Fire-and-forget facet computation — doesn't block the table from rendering.
        invoke<FieldFacets>("get_field_facets", { tabId })
          .then((facets) => {
            // Store wants the active tab, but by the time we get here the user
            // may have switched tabs; we target tabId explicitly via setFacets.
            // setFacets always operates on the active tab, but since loadFile
            // sets that tab active (openTab activates it), this is safe as long
            // as the user hasn't switched away before the await resolves.
            setFacets(facets);
          })
          .catch((e: unknown) => console.warn("Facet computation failed:", e));
      } catch (err) {
        console.error("Failed to parse log file:", err);
        // Remove the tab we just opened (it has no data). Parsing may have
        // partially stored entries before failing, so free any Rust-side state.
        invoke("release_entries", { tabId }).catch(() => {});
        useLogStore.getState().closeTab(tabId);
        setLoadError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [openTab, setParseResult, setFacets, setLoading, setLoadError],
  );

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

  // ── Filter pipeline ─────────────────────────────────────────────────────────
  // Entries live in Rust state keyed by tab id; only the query travels IPC. The
  // hook owns the debounced IPC filter + stale-response guard + facet
  // intersection, and returns the final id set to display. The same facet logic
  // is reused for export so the two never diverge.

  const effectiveFilteredIds = useFilterPipeline(tab);
  const filter = tab?.filter ?? "";

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

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

  // ── Render ────────────────────────────────────────────────────────────────

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

  if (tabs.length === 0) {
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
          <div
            className="px-4 py-2 text-xs font-mono text-red-400 bg-red-950/40 border-b border-red-900/40"
            role="alert"
          >
            {loadError}
          </div>
        )}
        <DropZone onFileDrop={loadFile} onBrowse={browseFile} />
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-[#0a0f1a] flex flex-col overflow-hidden">
      <TabBar onBrowse={browseFile} />
      {activeTabId && <FilterBar onBrowse={browseFile} />}

      <div className="flex-1 flex overflow-hidden">
        {/* Facet sidebar — only shown when the active tab has facets */}
        {tab && Object.keys(tab.facets).length > 0 && <FacetPanel />}

        <LogTable effectiveFilteredIds={effectiveFilteredIds} />
        {tab?.detailOpen && <DetailPanel />}
      </div>
    </div>
  );
}
