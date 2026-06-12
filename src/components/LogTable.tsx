import { useRef, useMemo, useCallback, useEffect } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useLogStore } from "../lib/store";
import { LogEntry, detectLevel, LEVEL_BADGE, LEVEL_COLORS } from "../lib/types";
import clsx from "clsx";

const ROW_HEIGHT = 32;

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

interface LogTableProps {
  /** The final set of entry ids to display (after text/regex + time + facet filters). */
  effectiveFilteredIds: Set<number>;
}

export function LogTable({ effectiveFilteredIds }: LogTableProps) {
  const activeTab = useLogStore((s) => s.activeTab());
  const { setSelectedEntry, saveScrollTop } = useLogStore();

  const parentRef = useRef<HTMLDivElement>(null);

  const entries = activeTab?.entries ?? [];
  const visibleFields = activeTab?.visibleFields ?? [];
  const selectedEntry = activeTab?.selectedEntry ?? null;
  const savedScrollTop = activeTab?.scrollTop ?? 0;
  const tabId = activeTab?.id ?? "";

  // Filtered + ordered entries
  const rows = useMemo(
    () => entries.filter((e) => effectiveFilteredIds.has(e.id)),
    [entries, effectiveFilteredIds],
  );

  // Restore scroll position when the active tab changes (tab switch).
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    el.scrollTop = savedScrollTop;
    // We intentionally only restore on tab identity change (not every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // Build columns dynamically from visibleFields
  const columns = useMemo<ColumnDef<LogEntry>[]>(() => {
    const cols: ColumnDef<LogEntry>[] = [
      {
        id: "#",
        size: 64,
        header: "#",
        cell: ({ row }) => (
          <span className="text-slate-600 font-mono text-xs select-none">
            {row.index + 1}
          </span>
        ),
      },
    ];

    for (const field of visibleFields) {
      cols.push({
        id: field,
        header: field,
        size:
          field === "message" || field === "msg" || field === "_raw" ? 380 : 160,
        cell: ({ row }) => {
          const val = row.original.fields[field];
          const str = formatValue(val);

          if (
            field === "level" ||
            field === "severity" ||
            field === "lvl"
          ) {
            const level = detectLevel(row.original);
            return (
              <span
                className={clsx(
                  "text-xs px-1.5 py-0.5 rounded font-mono font-medium",
                  LEVEL_BADGE[level],
                )}
              >
                {str || "—"}
              </span>
            );
          }

          return (
            <span
              className={clsx(
                "cell-value",
                field === "timestamp" ||
                  field === "time" ||
                  field === "ts" ||
                  field === "@timestamp"
                  ? "text-slate-400"
                  : "text-slate-200",
              )}
              title={str}
            >
              {str || <span className="text-slate-700">—</span>}
            </span>
          );
        },
      });
    }

    return cols;
  }, [visibleFields]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows: tableRows } = table.getRowModel();

  const virtualizer = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalHeight = virtualizer.getTotalSize();

  const handleRowClick = useCallback(
    (entry: LogEntry) => {
      setSelectedEntry(selectedEntry?.id === entry.id ? null : entry);
    },
    [selectedEntry, setSelectedEntry],
  );

  // Save scroll position when switching away from this tab.
  const handleScroll = useCallback(() => {
    if (tabId && parentRef.current) {
      saveScrollTop(tabId, parentRef.current.scrollTop);
    }
  }, [tabId, saveScrollTop]);

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">
        No matching entries
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex border-b border-slate-800 bg-slate-900 shrink-0">
        {table.getHeaderGroups().map((hg) =>
          hg.headers.map((header) => (
            <div
              key={header.id}
              style={{ width: header.getSize(), minWidth: header.getSize() }}
              className="px-3 py-2 text-xs font-medium text-slate-500 uppercase tracking-wider truncate shrink-0"
            >
              {flexRender(header.column.columnDef.header, header.getContext())}
            </div>
          )),
        )}
      </div>

      {/* Virtual body */}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto relative"
      >
        <div style={{ height: totalHeight, position: "relative" }}>
          {virtualItems.map((vi) => {
            const row = tableRows[vi.index];
            const entry = row.original;
            const level = detectLevel(entry);
            const isSelected = selectedEntry?.id === entry.id;

            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                onClick={() => handleRowClick(entry)}
                style={{
                  position: "absolute",
                  top: vi.start,
                  left: 0,
                  right: 0,
                  height: ROW_HEIGHT,
                }}
                className={clsx(
                  "log-row flex items-center",
                  isSelected && "selected",
                  !isSelected && level === "error" && "error-row",
                  !isSelected && level === "warn" && "warn-row",
                  !isSelected && LEVEL_COLORS[level],
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <div
                    key={cell.id}
                    style={{
                      width: cell.column.getSize(),
                      minWidth: cell.column.getSize(),
                    }}
                    className="px-3 flex items-center shrink-0 overflow-hidden h-full"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
