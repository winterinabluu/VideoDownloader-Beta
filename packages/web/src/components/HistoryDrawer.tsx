import { useEffect } from "react";
import { useHistory } from "../hooks/useHistory";
import { HistoryItem } from "./HistoryItem";

interface HistoryDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (url: string) => void;
}

export function HistoryDrawer({ open, onClose, onSelect }: HistoryDrawerProps) {
  const { entries, removeEntry, clearAll } = useHistory();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleClear = () => {
    if (entries.length === 0) return;
    if (window.confirm(`确定清空全部 ${entries.length} 条历史？`)) {
      clearAll();
    }
  };

  const handleSelect = (url: string) => {
    onSelect(url);
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity
                    ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />

      {/* Panel */}
      <aside
        className={`fixed right-0 top-0 z-50 flex h-full w-full max-w-sm
                    flex-col bg-white shadow-xl transition-transform
                    ${open ? "translate-x-0" : "translate-x-full"}`}
        aria-hidden={!open}
      >
        <header className="flex items-center justify-between border-b
                           border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">
            History <span className="text-gray-400">({entries.length})</span>
          </h2>
          <button
            onClick={onClose}
            aria-label="Close history"
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          >
            ×
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="flex h-full items-center justify-center p-8
                            text-center text-sm text-gray-400">
              还没有历史记录
            </div>
          ) : (
            <ul>
              {entries.map((e) => (
                <HistoryItem
                  key={e.id}
                  entry={e}
                  onClick={handleSelect}
                  onDelete={removeEntry}
                />
              ))}
            </ul>
          )}
        </div>

        {entries.length > 0 && (
          <footer className="border-t border-gray-200 p-3">
            <button
              onClick={handleClear}
              className="w-full rounded-md border border-gray-200 px-3 py-2
                         text-sm text-gray-600 hover:bg-gray-50"
            >
              清空全部
            </button>
          </footer>
        )}
      </aside>
    </>
  );
}
