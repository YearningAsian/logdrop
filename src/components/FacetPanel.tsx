import { useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { useLogStore } from "../lib/store";
import clsx from "clsx";

/** One collapsible section for a single facet field. */
function FacetField({
  field,
  values,
  selected,
  onToggle,
  onClear,
}: {
  field: string;
  values: Array<[string, number]>;
  selected: Set<string>;
  onToggle: (value: string) => void;
  onClear: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasSelection = selected.size > 0;

  return (
    <div className="border-b border-slate-800/60">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1.5 text-xs font-mono text-slate-400 hover:text-slate-200 transition-colors flex-1 text-left"
        >
          <ChevronDown
            size={11}
            className={clsx("transition-transform shrink-0", collapsed && "-rotate-90")}
          />
          {field}
          {hasSelection && (
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-sky-900 text-sky-300 font-sans">
              {selected.size}
            </span>
          )}
        </button>
        {hasSelection && (
          <button
            onClick={onClear}
            className="text-slate-600 hover:text-slate-300 ml-1 transition-colors shrink-0"
            title={`Clear ${field} filter`}
          >
            <X size={11} />
          </button>
        )}
      </div>

      {/* Values list */}
      {!collapsed && (
        <ul className="pb-2">
          {values.map(([val, count]) => {
            const isChecked = selected.has(val);
            return (
              <li key={val}>
                <button
                  onClick={() => onToggle(val)}
                  className={clsx(
                    "w-full flex items-center gap-2 px-3 py-1 text-xs font-mono transition-colors text-left",
                    isChecked
                      ? "text-sky-300 bg-sky-950/40"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40",
                  )}
                >
                  {/* Custom checkbox */}
                  <span
                    className={clsx(
                      "flex items-center justify-center w-3.5 h-3.5 rounded border shrink-0 transition-colors",
                      isChecked
                        ? "bg-sky-600 border-sky-500"
                        : "border-slate-600",
                    )}
                  >
                    {isChecked && (
                      <svg
                        width="8"
                        height="8"
                        viewBox="0 0 8 8"
                        fill="none"
                        className="text-white"
                      >
                        <path
                          d="M1.5 4L3 5.5L6.5 2"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <span className="truncate flex-1">{val}</span>
                  <span className="text-slate-600 shrink-0">{count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Sidebar showing discovered field facets for the active tab. */
export function FacetPanel() {
  const activeTab = useLogStore((s) => s.activeTab());
  const { toggleFacetValue, clearFacetField } = useLogStore();

  if (!activeTab) return null;

  const { facets, facetFilters } = activeTab;

  const fields = Object.keys(facets).sort();
  if (fields.length === 0) return null;

  return (
    <div className="w-[200px] shrink-0 border-r border-slate-800 bg-slate-900/50 flex flex-col overflow-y-auto">
      <div className="px-3 py-2 border-b border-slate-800">
        <span className="text-[11px] uppercase tracking-wider text-slate-600 font-semibold">
          Filters
        </span>
      </div>

      {fields.map((field) => (
        <FacetField
          key={field}
          field={field}
          values={facets[field] ?? []}
          selected={facetFilters[field] ?? new Set()}
          onToggle={(val) => toggleFacetValue(field, val)}
          onClear={() => clearFacetField(field)}
        />
      ))}
    </div>
  );
}
