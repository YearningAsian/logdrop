export interface LogEntry {
  id: number;
  raw: string;
  fields: Record<string, unknown>;
}

export interface ParseResult {
  entries: LogEntry[];
  fields: string[];
  total_lines: number;
  parse_errors: number;
}

export interface TimeRange {
  from: string | null;
  to: string | null;
}

/** field → [[value, count], ...] sorted by frequency desc */
export type FieldFacets = Record<string, Array<[string, number]>>;

/** A single open-file tab */
export interface TabState {
  id: string;
  filePath: string;
  fileName: string;
  entries: LogEntry[];
  fields: string[];
  visibleFields: string[];
  totalLines: number;
  parseErrors: number;
  filter: string;
  filterMode: FilterMode;
  filterError: string | null;
  filteredIds: Set<number>;
  timeRange: TimeRange;
  facetFilters: Record<string, Set<string>>;
  facets: FieldFacets;
  selectedEntry: LogEntry | null;
  detailOpen: boolean;
  /** Scroll offset in the virtual list, preserved on tab switch */
  scrollTop: number;
}

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "unknown";

// pino-style numeric levels
const NUMERIC_LEVELS: Record<number, LogLevel> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

export function detectLevel(entry: LogEntry): LogLevel {
  const value =
    entry.fields["level"] ?? entry.fields["severity"] ?? entry.fields["lvl"];

  // Log content is untrusted — level can be a number (pino), object, anything.
  if (typeof value === "number") return NUMERIC_LEVELS[value] ?? "unknown";
  if (typeof value !== "string") return "unknown";

  const raw = value.toLowerCase();

  if (raw.includes("trace")) return "trace";
  if (raw.includes("debug")) return "debug";
  if (raw.includes("info")) return "info";
  if (raw.includes("warn")) return "warn";
  if (raw.includes("error") || raw.includes("err")) return "error";
  if (raw.includes("fatal") || raw.includes("crit")) return "fatal";
  return "unknown";
}

export const LEVEL_COLORS: Record<LogLevel, string> = {
  trace:   "text-slate-400",
  debug:   "text-sky-400",
  info:    "text-emerald-400",
  warn:    "text-amber-400",
  error:   "text-red-400",
  fatal:   "text-red-300 bg-red-950",
  unknown: "text-slate-500",
};

export const LEVEL_BADGE: Record<LogLevel, string> = {
  trace:   "bg-slate-800 text-slate-300",
  debug:   "bg-sky-950 text-sky-300",
  info:    "bg-emerald-950 text-emerald-300",
  warn:    "bg-amber-950 text-amber-300",
  error:   "bg-red-950 text-red-300",
  fatal:   "bg-red-900 text-red-200 font-bold",
  unknown: "bg-slate-800 text-slate-400",
};

/** Build an empty tab state for a newly opened file */
export function emptyTab(
  id: string,
  filePath: string,
  fileName: string,
): TabState {
  return {
    id,
    filePath,
    fileName,
    entries: [],
    fields: [],
    visibleFields: [],
    totalLines: 0,
    parseErrors: 0,
    filter: "",
    filterMode: "text",
    filterError: null,
    filteredIds: new Set(),
    timeRange: { from: null, to: null },
    facetFilters: {},
    facets: {},
    selectedEntry: null,
    detailOpen: false,
    scrollTop: 0,
  };
}

export type FilterMode = "text" | "regex";

const DEFAULT_FIELD_LIMIT = 6;

/** Derive visibleFields from the full fields list */
export function defaultVisibleFields(fields: string[]): string[] {
  return fields.slice(0, DEFAULT_FIELD_LIMIT);
}
