import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FileText } from "lucide-react";

interface DropZoneProps {
  onFileDrop: (path: string) => void;
  onBrowse: () => void;
}

export function DropZone({ onFileDrop, onBrowse }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);

  // Tauri intercepts native drag-drop (HTML5 DataTransfer never exposes real
  // paths in a Tauri webview) — listen to the webview drag-drop event instead.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "enter" || event.payload.type === "over") {
          setDragging(true);
        } else if (event.payload.type === "drop") {
          setDragging(false);
          const path = event.payload.paths[0];
          if (path) onFileDrop(path);
        } else {
          setDragging(false);
        }
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [onFileDrop]);

  return (
    <div className="flex items-center justify-center w-full h-full">
      <div
        className={`
          flex flex-col items-center justify-center gap-6
          w-[480px] h-[320px] rounded-2xl border-2 border-dashed
          transition-all duration-200 cursor-pointer
          ${dragging
            ? "border-sky-400 bg-sky-950/30 scale-[1.02]"
            : "border-slate-700 bg-slate-900/40 hover:border-slate-500 hover:bg-slate-900/60"
          }
        `}
        onClick={onBrowse}
      >
        <div className={`
          p-5 rounded-xl transition-colors
          ${dragging ? "bg-sky-900/40 text-sky-300" : "bg-slate-800/60 text-slate-400"}
        `}>
          <FileText size={40} strokeWidth={1.5} />
        </div>

        <div className="text-center">
          <p className={`text-lg font-medium mb-1 transition-colors ${dragging ? "text-sky-300" : "text-slate-300"}`}>
            {dragging ? "Release to open" : "Drop a log file"}
          </p>
          <p className="text-sm text-slate-500">
            NDJSON · JSON · or click to browse
          </p>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-600 font-mono">
          <span className="px-2 py-1 bg-slate-800 rounded">{"{ }"}</span>
          <span>structured logs, any schema</span>
        </div>
      </div>
    </div>
  );
}
