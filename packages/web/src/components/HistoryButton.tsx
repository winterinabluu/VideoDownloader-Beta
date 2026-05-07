import { useHistory } from "../hooks/useHistory";

interface HistoryButtonProps {
  onClick: () => void;
}

export function HistoryButton({ onClick }: HistoryButtonProps) {
  const { entries } = useHistory();
  const count = entries.length;

  return (
    <button
      onClick={onClick}
      aria-label="Show history"
      className="relative inline-flex items-center gap-1.5 rounded-md border
                 border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700
                 shadow-sm hover:bg-gray-50"
    >
      <svg
        className="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
      History
      {count > 0 && (
        <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px]
                         font-semibold text-blue-700">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
