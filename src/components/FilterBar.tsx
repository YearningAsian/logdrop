import { useCallback, useState } from "react";
import {
  Search,
  FolderOpen,
  X,
  AlertCircle,
  ChevronDown,
  Download,
  Regex,
  Clock,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useLogStore } from "../lib/store";
import { applyFacetFilters } from "../lib/types";
import clsx from "clsx";

interface FilterBarProps {
  onBrowse: () => void;
}

/**
 * Convert a `datetime-local` input value (e.g. "2024-01-15T10:30") to an ISO 8601
 * string with a UTC "Z" suffix that chrono can parse on the Rust side.
 * The browser's datetime-local gives local time without timezone — we treat it as
 * UTC for simplicity (logdrop is an offline tool; the user decides what to type).
 */
function localToIso(value: string): string | null {
  if (!value) return null;
  if (value.includes("Z")) return value;
  // datetime-local yields "YYYY-MM-DDTHH:mm" (16 chars); pad seconds before Z
  return value.length === 16 ? `${value}:00Z` : `${value}Z`;
}

export function FilterBar({ onBrowse }: FilterBarProps) {
  const activeTab = useLogStore((s) => s.activeTab());

  const {
    setFilter,
    setFilterMode,
    setTimeRange,
    toggleField,
  } = useLogStore();

  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [timeOpen, setTimeOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  if (!activeTab) return null;

  const {
    id: tabId,
    fileName,
    entries,
    filteredIds,
    facetFilters,
    parseErrors,
    filter,
    filterMode,
    filterError,
    fields,
    visibleFields,
    timeRange,
  } = activeTab;

  // Export must honour active facet filters, so export exactly what the table
  // shows. Mirrors useFilterPipeline's final id set via the shared helper.
  const exportIds = applyFacetFilters(entries, filteredIds, facetFilters);

  const handleFilterChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFilter(e.target.value);
    },
    [setFilter],
  );

  const clearFilter = () => setFilter("");

  const toggleRegex = () =>
    setFilterMode(filterMode === "text" ? "regex" : "text");

  const handleExport = async () => {
    setExporting(true);
    try {
      const count = await invoke<number | null>("export_filtered", {
        tabId,
        ids: [...exportIds],
      });
      if (count !== null) console.info(`Exported ${count} entries`);
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  };

  // Convert the stored ISO string back to a datetime-local value for the input
  const isoToLocal = (iso: string | null): string => {
    if (!iso) return "";
    // Strip trailing "Z" and seconds-portion added by localToIso if present
    return iso.replace(/Z$/, "").replace(/:00$/, "");
  };

  const handleFromChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTimeRange({ from: localToIso(e.target.value) });
  };

  const handleToChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTimeRange({ to: localToIso(e.target.value) });
  };

  const clearTimeRange = () => {
    setTimeRange({ from: null, to: null });
  };

  const hasTimeFilter = timeRange.from != null || timeRange.to != null;

  return (
    <div className="flex flex-col border-b border-slate-800 bg-slate-900/80 backdrop-blur shrink-0">
      {/* Top row */}
      <div className="flex items-center gap-3 px-4 h-12">
        {/* File name */}
        <button
          onClick={onBrowse}
          className="flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors shrink-0"
          title="Open another file"
        >
          <FolderOpen size={15} />
          <span className="font-mono max-w-[200px] truncate">
            {fileName ?? "Open file…"}
          </span>
        </button>

        <div className="w-px h-5 bg-slate-700" />

        {/* Regex toggle */}
        <button
          onClick={toggleRegex}
          title={
            filterMode === "regex"
              ? "Switch to text mode"
              : "Switch to regex mode"
          }
          className={clsx(
            "flex items-center justify-center w-7 h-7 rounded border transition-colors shrink-0",
            filterMode === "regex"
              ? "bg-sky-900/60 border-sky-600 text-sky-300"
              : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400",
          )}
        >
          <Regex size={13} />
        </button>

        {/* Search */}
        <div
          className={clsx(
            "flex-1 flex items-center gap-2 bg-slate-800/60 border rounded-lg px-3 h-8 transition-colors",
            filterError
              ? "border-red-700 focus-within:border-red-500"
              : "border-slate-700 focus-within:border-sky-600",
          )}
        >
          <Search size={13} className="text-slate-500 shrink-0" />
          <input
            type="text"
            value={filter}
            onChange={handleFilterChange}
            placeholder={
              filterMode === "regex"
                ? "Filter logs… (regex)"
                : "Filter logs… (space-separated terms = AND)"
            }
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 outline-none font-mono"
          />
          {filter && (
            <button
              onClick={clearFilter}
              className="text-slate-500 hover:text-slate-300"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Time range toggle */}
        <button
          onClick={() => setTimeOpen((o) => !o)}
          title="Toggle time range filter"
          className={clsx(
            "flex items-center gap-1.5 text-xs px-3 h-7 rounded-md border transition-colors shrink-0",
            hasTimeFilter
              ? "bg-sky-900/50 border-sky-700 text-sky-300"
              : timeOpen
                ? "bg-slate-700 border-slate-600 text-slate-200"
                : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300",
          )}
        >
          <Clock size={12} />
          Time
          {hasTimeFilter && (
            <span
              role="button"
              aria-label="Clear time range"
              onClick={(e) => {
                e.stopPropagation();
                clearTimeRange();
              }}
              className="ml-1 text-sky-400 hover:text-sky-200"
            >
              <X size={10} />
            </span>
          )}
        </button>

        {/* Counts */}
        <div className="flex items-center gap-3 text-xs text-slate-500 shrink-0">
          <span>
            <span className="text-slate-200 font-mono">
              {exportIds.size.toLocaleString()}
            </span>
            {" / "}
            <span className="font-mono">{entries.length.toLocaleString()}</span>
            {" entries"}
          </span>
          {parseErrors > 0 && (
            <span className="flex items-center gap-1 text-amber-500">
              <AlertCircle size={12} />
              {parseErrors} parse errors
            </span>
          )}
          {filterError && (
            <span
              className="flex items-center gap-1 text-red-400 max-w-[200px] truncate"
              title={filterError}
            >
              <AlertCircle size={12} />
              {filterError}
            </span>
          )}
        </div>

        {/* Export */}
        {exportIds.size > 0 && (
          <button
            onClick={handleExport}
            disabled={exporting}
            title="Export filtered results as NDJSON"
            className="flex items-center gap-1.5 text-xs px-3 h-7 rounded-md border border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300 transition-colors shrink-0 disabled:opacity-50"
          >
            <Download size={12} />
            {exporting ? "Saving…" : "Export"}
          </button>
        )}

        {/* Fields dropdown toggle */}
        <button
          onClick={() => setFieldsOpen((o) => !o)}
          className={clsx(
            "flex items-center gap-1.5 text-xs px-3 h-7 rounded-md border transition-colors shrink-0",
            fieldsOpen
              ? "bg-slate-700 border-slate-600 text-slate-200"
              : "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300",
          )}
        >
          Columns
          <ChevronDown
            size={12}
            className={clsx(
              "transition-transform",
              fieldsOpen && "rotate-180",
            )}
          />
        </button>
      </div>

      {/* Time range panel */}
      {timeOpen && (
        <div className="flex items-center gap-3 px-4 pb-3 pt-1">
          <span className="text-xs text-slate-500 shrink-0 w-8">From</span>
          <input
            type="datetime-local"
            value={isoToLocal(timeRange.from)}
            onChange={handleFromChange}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-600 [color-scheme:dark]"
          />
          <span className="text-xs text-slate-500 shrink-0 w-4">To</span>
          <input
            type="datetime-local"
            value={isoToLocal(timeRange.to)}
            onChange={handleToChange}
            className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-600 [color-scheme:dark]"
          />
          {hasTimeFilter && (
            <button
              onClick={clearTimeRange}
              className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
            >
              <X size={12} />
              Clear
            </button>
          )}
        </div>
      )}

      {/* Fields panel */}
      {fieldsOpen && (
        <div className="px-4 pb-3 flex flex-wrap gap-2">
          {fields.map((field) => {
            const active = visibleFields.includes(field);
            return (
              <button
                key={field}
                onClick={() => toggleField(field)}
                className={clsx(
                  "text-xs font-mono px-2.5 py-1 rounded-md border transition-colors",
                  active
                    ? "bg-sky-900/50 border-sky-700 text-sky-300"
                    : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400",
                )}
              >
                {field}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
