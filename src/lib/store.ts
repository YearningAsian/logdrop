import { create } from "zustand";
import {
  LogEntry,
  TabState,
  FieldFacets,
  FilterMode,
  TimeRange,
  emptyTab,
  defaultVisibleFields,
} from "./types";

// Re-export FilterMode so existing imports from store.ts still work
export type { FilterMode };

// ── Helpers ──────────────────────────────────────────────────────────────────

function newTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Mutate `tabs` array in place, updating the tab identified by `id`. */
function patchTab(
  tabs: TabState[],
  id: string,
  patch: Partial<TabState>,
): TabState[] {
  return tabs.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

// ── Store interface ───────────────────────────────────────────────────────────

interface LogStore {
  // Multi-tab state
  tabs: TabState[];
  activeTabId: string | null;

  // Global UI
  isLoading: boolean;
  loadError: string | null;

  // Derived accessor: returns the active tab or null
  activeTab: () => TabState | null;

  // Tab management
  openTab: (filePath: string, fileName: string) => string; // returns new tab id
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;

  // Per-tab setters (operate on activeTabId unless overridden)
  setParseResult: (
    tabId: string,
    entries: LogEntry[],
    fields: string[],
    totalLines: number,
    parseErrors: number,
  ) => void;
  setFilter: (filter: string) => void;
  setFilterMode: (mode: FilterMode) => void;
  setFilterError: (err: string | null) => void;
  setFilteredIds: (ids: number[]) => void;
  setTimeRange: (range: Partial<TimeRange>) => void;
  setFacets: (facets: FieldFacets) => void;
  toggleFacetValue: (field: string, value: string) => void;
  clearFacetField: (field: string) => void;
  setSelectedEntry: (entry: LogEntry | null) => void;
  toggleField: (field: string) => void;
  setVisibleFields: (fields: string[]) => void;
  setDetailOpen: (v: boolean) => void;
  saveScrollTop: (tabId: string, scrollTop: number) => void;

  // Global setters
  setLoading: (v: boolean) => void;
  setLoadError: (err: string | null) => void;

  reset: () => void;
}

// ── Store implementation ──────────────────────────────────────────────────────

export const useLogStore = create<LogStore>((set, get) => ({
  tabs: [],
  activeTabId: null,
  isLoading: false,
  loadError: null,

  activeTab: () => {
    const { tabs, activeTabId } = get();
    return tabs.find((t) => t.id === activeTabId) ?? null;
  },

  openTab: (filePath, fileName) => {
    const id = newTabId();
    set((s) => ({
      tabs: [...s.tabs, emptyTab(id, filePath, fileName)],
      activeTabId: id,
    }));
    return id;
  },

  closeTab: (id) => {
    set((s) => {
      const remaining = s.tabs.filter((t) => t.id !== id);
      let nextActive = s.activeTabId;
      if (s.activeTabId === id) {
        // Activate the nearest surviving tab
        const idx = s.tabs.findIndex((t) => t.id === id);
        const next = remaining[idx] ?? remaining[idx - 1] ?? remaining[0];
        nextActive = next?.id ?? null;
      }
      return { tabs: remaining, activeTabId: nextActive };
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  setParseResult: (tabId, entries, fields, totalLines, parseErrors) => {
    set((s) => ({
      tabs: patchTab(s.tabs, tabId, {
        entries,
        fields,
        visibleFields: defaultVisibleFields(fields),
        filteredIds: new Set(entries.map((e) => e.id)),
        totalLines,
        parseErrors,
        filter: "",
        filterMode: "text",
        filterError: null,
        timeRange: { from: null, to: null },
        facetFilters: {},
        facets: {},
        selectedEntry: null,
        detailOpen: false,
        scrollTop: 0,
      }),
    }));
  },

  setFilter: (filter) => {
    const { activeTabId, tabs } = get();
    if (!activeTabId) return;
    set({ tabs: patchTab(tabs, activeTabId, { filter }) });
  },

  setFilterMode: (filterMode) => {
    const { activeTabId, tabs } = get();
    if (!activeTabId) return;
    set({ tabs: patchTab(tabs, activeTabId, { filterMode }) });
  },

  setFilterError: (filterError) => {
    const { activeTabId, tabs } = get();
    if (!activeTabId) return;
    set({ tabs: patchTab(tabs, activeTabId, { filterError }) });
  },

  setFilteredIds: (ids) => {
    const { activeTabId, tabs } = get();
    if (!activeTabId) return;
    set({ tabs: patchTab(tabs, activeTabId, { filteredIds: new Set(ids) }) });
  },

  setTimeRange: (range) => {
    const { activeTabId, tabs } = get();
    if (!activeTabId) return;
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    set({
      tabs: patchTab(tabs, activeTabId, {
        timeRange: { ...tab.timeRange, ...range },
      }),
    });
  },

  setFacets: (facets) => {
    const { activeTabId, tabs } = get();
    if (!activeTabId) return;
    set({ tabs: patchTab(tabs, activeTabId, { facets }) });
  },

  toggleFacetValue: (field, value) => {
    const { activeTabId, tabs } = get();
    if (!activeTabId) return;
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    const current = new Set(tab.facetFilters[field] ?? []);
    if (current.has(value)) {
      current.delete(value);
    } else {
      current.add(value);
    }
    const facetFilters = { ...tab.facetFilters };
    if (current.size === 0) {
      delete facetFilters[field];
    } else {
      facetFilters[field] = current;
    }
    set({ tabs: patchTab(tabs, activeTabId, { facetFilters }) });
  },

  clearFacetField: (field) => {
    const { activeTabId, tabs } = get();
    if (!activeTabId) return;
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    const facetFilters = { ...tab.facetFilters };
    delete facetFilters[field];
    set({ tabs: patchTab(tabs, activeTabId, { facetFilters }) });
  },

  setSelectedEntry: (entry) => {
    const { activeTabId, tabs } = get();
    if (!activeTabId) return;
    set({
      tabs: patchTab(tabs, activeTabId, {
        selectedEntry: entry,
        detailOpen: entry !== null,
      }),
    });
  },

  toggleField: (field) => {
    const { activeTabId, tabs } = get();
    if (!activeTabId) return;
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    set({
      tabs: patchTab(tabs, activeTabId, {
        visibleFields: tab.visibleFields.includes(field)
          ? tab.visibleFields.filter((f) => f !== field)
          : [...tab.visibleFields, field],
      }),
    });
  },

  setVisibleFields: (fields) => {
    const { activeTabId, tabs } = get();
    if (!activeTabId) return;
    set({ tabs: patchTab(tabs, activeTabId, { visibleFields: fields }) });
  },

  setDetailOpen: (v) => {
    const { activeTabId, tabs } = get();
    if (!activeTabId) return;
    set({ tabs: patchTab(tabs, activeTabId, { detailOpen: v }) });
  },

  saveScrollTop: (tabId, scrollTop) => {
    set((s) => ({ tabs: patchTab(s.tabs, tabId, { scrollTop }) }));
  },

  setLoading: (v) => set({ isLoading: v }),

  setLoadError: (loadError) => set({ loadError }),

  reset: () =>
    set({
      tabs: [],
      activeTabId: null,
      isLoading: false,
      loadError: null,
    }),
}));
