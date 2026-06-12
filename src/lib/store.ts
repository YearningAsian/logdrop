import { create } from "zustand";
import { LogEntry } from "./types";

export type FilterMode = "text" | "regex";

interface LogStore {
  // File state
  filePath: string | null;
  fileName: string | null;
  totalLines: number;
  parseErrors: number;

  // Data
  entries: LogEntry[];
  fields: string[];
  visibleFields: string[];

  // Filtering
  filter: string;
  filterMode: FilterMode;
  filterError: string | null;
  filteredIds: Set<number>;

  // Selection
  selectedEntry: LogEntry | null;

  // UI
  isLoading: boolean;
  detailOpen: boolean;

  // Actions
  setFile: (path: string) => void;
  setParseResult: (entries: LogEntry[], fields: string[], totalLines: number, parseErrors: number) => void;
  setFilter: (filter: string) => void;
  setFilterMode: (mode: FilterMode) => void;
  setFilterError: (err: string | null) => void;
  setFilteredIds: (ids: number[]) => void;
  setSelectedEntry: (entry: LogEntry | null) => void;
  toggleField: (field: string) => void;
  setVisibleFields: (fields: string[]) => void;
  setLoading: (v: boolean) => void;
  setDetailOpen: (v: boolean) => void;
  reset: () => void;
}

const DEFAULT_FIELD_LIMIT = 6;

export const useLogStore = create<LogStore>((set) => ({
  filePath: null,
  fileName: null,
  totalLines: 0,
  parseErrors: 0,
  entries: [],
  fields: [],
  visibleFields: [],
  filter: "",
  filterMode: "text",
  filterError: null,
  filteredIds: new Set(),
  selectedEntry: null,
  isLoading: false,
  detailOpen: false,

  setFile: (path) => {
    const parts = path.replace(/\\/g, "/").split("/");
    set({ filePath: path, fileName: parts[parts.length - 1] });
  },

  setParseResult: (entries, fields, totalLines, parseErrors) => {
    set({
      entries,
      fields,
      visibleFields: fields.slice(0, DEFAULT_FIELD_LIMIT),
      filteredIds: new Set(entries.map((e) => e.id)),
      totalLines,
      parseErrors,
      selectedEntry: null,
      filter: "",
    });
  },

  setFilter: (filter) => set({ filter }),

  setFilterMode: (filterMode) => set({ filterMode }),

  setFilterError: (filterError) => set({ filterError }),

  setFilteredIds: (ids) => set({ filteredIds: new Set(ids) }),

  setSelectedEntry: (entry) =>
    set({ selectedEntry: entry, detailOpen: entry !== null }),

  toggleField: (field) =>
    set((s) => ({
      visibleFields: s.visibleFields.includes(field)
        ? s.visibleFields.filter((f) => f !== field)
        : [...s.visibleFields, field],
    })),

  setVisibleFields: (fields) => set({ visibleFields: fields }),

  setLoading: (v) => set({ isLoading: v }),

  setDetailOpen: (v) => set({ detailOpen: v }),

  reset: () =>
    set({
      filePath: null,
      fileName: null,
      totalLines: 0,
      parseErrors: 0,
      entries: [],
      fields: [],
      visibleFields: [],
      filter: "",
      filterMode: "text",
      filterError: null,
      filteredIds: new Set(),
      selectedEntry: null,
      isLoading: false,
      detailOpen: false,
    }),
}));
