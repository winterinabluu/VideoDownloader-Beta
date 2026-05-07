import { useSyncExternalStore } from "react";
import {
  clearAll as clearAllImpl,
  listHistory,
  removeEntry as removeEntryImpl,
  subscribe,
  type HistoryEntry,
} from "../utils/history";

export interface UseHistoryReturn {
  entries: HistoryEntry[];
  removeEntry: (id: string) => void;
  clearAll: () => void;
}

function getSnapshot(): HistoryEntry[] {
  return listHistory();
}

export function useHistory(): UseHistoryReturn {
  const entries = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    entries,
    removeEntry: removeEntryImpl,
    clearAll: clearAllImpl,
  };
}
