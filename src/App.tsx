import { useCallback, useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useLogStore } from "./lib/store";
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
    setFilteredIds,
    setFilterError,
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
        const result = await invoke<ParseResult>("parse_log_file", { path });
        setParseResult(
          tabId,
          result.entries,
          result.fields,
          result.total_lines,
          result.parse_errors,
        );
        // Fire-and-forget facet computation — doesn't block the table from rendering.
        invoke<FieldFacets>("get_field_facets")
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
        // Remove the tab we just opened (it has no data)
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

  // ── Filter — entries are stored in Rust state, only the query travels IPC ───
  // We maintain a single Rust state (last loaded file) — the IPC filter always
  // runs against whatever `parse_log_file` most recently stored.  Each tab's
  // filter runs independently via the `activeTabId` guard in the effect below.

  const filterSeq = useRef(0);

  // Re-run filtering whenever the active tab's query or time range changes.
  const filter = tab?.filter ?? "";
  const filterMode = tab?.filterMode ?? "text";
  const timeRange = tab?.timeRange;
  const entries = tab?.entries ?? [];

  useEffect(() => {
    if (entries.length === 0) return;
    const seq = ++filterSeq.current;

    const hasTimeFilter = timeRange?.from != null || timeRange?.to != null;

    // Empty text/regex AND no time filter → resolve locally (no IPC round-trip).
    if (filter.trim() === "" && !hasTimeFilter) {
      setFilterError(null);
      setFilteredIds(entries.map((e) => e.id));
      return;
    }

    const debounce = setTimeout(async () => {
      try {
        const ids = await invoke<number[]>("filter_entries", {
          query: filter,
          useRegex: filterMode === "regex",
          timeFrom: timeRange?.from ?? null,
          timeTo: timeRange?.to ?? null,
        });
        if (seq !== filterSeq.current) return; // stale — newer query won
        setFilterError(null);
        setFilteredIds(ids);
      } catch (err) {
        if (seq !== filterSeq.current) return;
        const msg = String(err).replace(/^.*Invalid regex:\s*/, "");
        setFilterError(msg);
      }
    }, 150);

    return () => clearTimeout(debounce);
  }, [filter, filterMode, timeRange, entries, setFilteredIds, setFilterError]);

  // Additional client-side facet filtering applied on top of the IPC results.
  // When facetFilters is non-empty we intersect the IPC-filtered ids with
  // entries matching all selected facet values (AND between fields, OR within).
  const facetFilters = tab?.facetFilters ?? {};
  const filteredIds = tab?.filteredIds ?? new Set<number>();

  const effectiveFilteredIds = useMemo<Set<number>>(() => {
    const activeFacets = Object.entries(facetFilters).filter(
      ([, values]) => values.size > 0,
    );
    if (activeFacets.length === 0) return filteredIds;

    const result = new Set<number>();
    for (const entry of entries) {
      if (!filteredIds.has(entry.id)) continue;
      const passes = activeFacets.every(([field, values]) => {
        const val = entry.fields[field];
        if (val == null) return false;
        const strVal =
          typeof val === "string" || typeof val === "number" || typeof val === "boolean"
            ? String(val)
            : null;
        return strVal != null && values.has(strVal);
      });
      if (passes) result.add(entry.id);
    }
    return result;
  }, [facetFilters, filteredIds, entries]);

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
