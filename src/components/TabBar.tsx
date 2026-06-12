import { X, Plus } from "lucide-react";
import { useLogStore } from "../lib/store";
import clsx from "clsx";

interface TabBarProps {
  onBrowse: () => void;
}

export function TabBar({ onBrowse }: TabBarProps) {
  const { tabs, activeTabId, setActiveTab, closeTab } = useLogStore();

  return (
    <div className="flex items-center h-9 border-b border-slate-800 bg-slate-950 shrink-0 overflow-x-auto">
      {/* Tab list */}
      <div className="flex items-stretch h-full">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={tab.filePath}
              className={clsx(
                "group relative flex items-center gap-2 px-3 h-full text-xs font-mono border-r border-slate-800 shrink-0 max-w-[200px] transition-colors",
                isActive
                  ? "bg-[#0a0f1a] text-slate-200 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-sky-500"
                  : "bg-slate-950 text-slate-500 hover:bg-slate-900 hover:text-slate-300",
              )}
            >
              <span className="truncate">{tab.fileName}</span>
              {/* Close button */}
              <span
                role="button"
                aria-label={`Close ${tab.fileName}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className={clsx(
                  "flex items-center justify-center w-4 h-4 rounded shrink-0 transition-colors",
                  isActive
                    ? "text-slate-400 hover:text-slate-200 hover:bg-slate-700"
                    : "opacity-0 group-hover:opacity-100 text-slate-600 hover:text-slate-300 hover:bg-slate-700",
                )}
              >
                <X size={10} />
              </span>
            </button>
          );
        })}
      </div>

      {/* New tab button */}
      <button
        onClick={onBrowse}
        title="Open another file (⌘O)"
        className="flex items-center justify-center w-9 h-full text-slate-600 hover:text-slate-300 hover:bg-slate-900 shrink-0 transition-colors"
        aria-label="Open another file"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
