const activeWatchers = new Set<string>();

export function tryAddWatchLock(id: string): boolean {
  if (activeWatchers.has(id)) return false;
  activeWatchers.add(id);
  return true;
}

export function removeWatchLock(id: string) {
  activeWatchers.delete(id);
}
