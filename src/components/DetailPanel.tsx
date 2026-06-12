import { useState } from "react";
import { X, Copy, Check, ChevronRight, ChevronDown } from "lucide-react";
import { useLogStore } from "../lib/store";
import { detectLevel, LEVEL_BADGE } from "../lib/types";
import clsx from "clsx";

// Recursive JSON tree renderer
function JsonTree({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const [collapsed, setCollapsed] = useState(depth > 2);

  if (value === null) return <span className="text-slate-500">null</span>;
  if (typeof value === "boolean") return <span className="text-sky-400">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-amber-300">{value}</span>;
  if (typeof value === "string") {
    return <span className="text-emerald-300">"{value}"</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-500">[]</span>;
    return (
      <span>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-slate-400 hover:text-slate-200 mr-1"
        >
          {collapsed ? <ChevronRight size={12} className="inline" /> : <ChevronDown size={12} className="inline" />}
        </button>
        <span className="text-slate-500">[{value.length}]</span>
        {!collapsed && (
          <div style={{ paddingLeft: 16 }}>
            {value.map((item, i) => (
              <div key={i} className="flex gap-1">
                <span className="text-slate-600 shrink-0">{i}:</span>
                <JsonTree value={item} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-slate-500">{"{}"}</span>;
    return (
      <span>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-slate-400 hover:text-slate-200 mr-1"
        >
          {collapsed ? <ChevronRight size={12} className="inline" /> : <ChevronDown size={12} className="inline" />}
        </button>
        {collapsed && <span className="text-slate-500">{"{ … }"}</span>}
        {!collapsed && (
          <div style={{ paddingLeft: 16 }}>
            {entries.map(([k, v]) => (
              <div key={k} className="flex gap-1 min-w-0">
                <span className="text-slate-400 shrink-0">{k}:</span>
                <JsonTree value={v} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    );
  }

  return <span className="text-slate-300">{String(value)}</span>;
}

export function DetailPanel() {
  const { selectedEntry, setDetailOpen, setSelectedEntry } = useLogStore();
  const [copied, setCopied] = useState(false);

  if (!selectedEntry) return null;

  const level = detectLevel(selectedEntry);
  // Untrusted content: only render the raw level field if it's a primitive.
  const levelValue =
    selectedEntry.fields["level"] ?? selectedEntry.fields["severity"];
  const levelLabel =
    typeof levelValue === "string" || typeof levelValue === "number"
      ? String(levelValue)
      : level;

  const close = () => {
    setSelectedEntry(null);
    setDetailOpen(false);
  };

  const copyRaw = async () => {
    await navigator.clipboard.writeText(
      JSON.stringify(selectedEntry.fields, null, 2)
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const fields = Object.entries(selectedEntry.fields);

  return (
    <div className="w-[380px] shrink-0 border-l border-slate-800 bg-slate-900/60 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-slate-500">
            #{selectedEntry.id + 1}
          </span>
          <span className={clsx("text-xs px-1.5 py-0.5 rounded font-mono font-medium", LEVEL_BADGE[level])}>
            {levelLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copyRaw}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded hover:bg-slate-800 transition-colors"
          >
            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={close}
            className="text-slate-500 hover:text-slate-300 p-1 rounded hover:bg-slate-800 transition-colors"
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto selectable">
        {fields.map(([key, value]) => (
          <div key={key} className="border-b border-slate-800/60 px-4 py-2.5">
            <div className="text-xs text-slate-500 mb-1 font-mono">{key}</div>
            <div className="text-xs font-mono text-slate-200 break-all leading-relaxed">
              <JsonTree value={value} depth={0} />
            </div>
          </div>
        ))}

        {/* Raw */}
        <div className="px-4 py-3">
          <div className="text-xs text-slate-600 mb-2 uppercase tracking-wider">Raw</div>
          <pre className="text-xs text-slate-400 font-mono whitespace-pre-wrap break-all leading-relaxed">
            {selectedEntry.raw}
          </pre>
        </div>
      </div>
    </div>
  );
}
