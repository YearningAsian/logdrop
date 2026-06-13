import { useEffect, useMemo, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLogStore } from "./store";
import { TabState, applyFacetFilters } from "./types";

/**
 * Drives the filter pipeline for the active tab:
 *
 *  1. Debounced IPC text/regex/time filter against the tab's Rust-side entries
 *     (empty query + no time range resolves locally with no round-trip).
 *  2. Client-side facet intersection on top of the IPC result.
 *
 * Stale IPC responses are discarded via a sequence guard so a slow query can
 * never overwrite a newer one. Returns the final id set to display.
 */
export function useFilterPipeline(tab: TabState | null): Set<number> {
  const setFilteredIds = useLogStore((s) => s.setFilteredIds);
  const setFilterError = useLogStore((s) => s.setFilterError);

  const filterSeq = useRef(0);

  const tabId = tab?.id ?? "";
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
          tabId,
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
  }, [tabId, filter, filterMode, timeRange, entries, setFilteredIds, setFilterError]);

  // Client-side facet intersection on top of the IPC-filtered ids.
  const facetFilters = tab?.facetFilters ?? {};
  const filteredIds = tab?.filteredIds ?? new Set<number>();

  return useMemo(
    () => applyFacetFilters(entries, filteredIds, facetFilters),
    [entries, filteredIds, facetFilters],
  );
}
