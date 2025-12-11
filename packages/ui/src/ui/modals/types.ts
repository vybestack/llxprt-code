export interface SearchItem {
  readonly id: string;
  readonly label: string;
}

export function filterItems(
  items: SearchItem[],
  query: string,
  alphabetical?: boolean,
): SearchItem[] {
  const normalized = query.trim().toLowerCase();
  const filtered = items.filter((item) =>
    item.label.toLowerCase().includes(normalized),
  );
  if (alphabetical === true) {
    return [...filtered].sort((a, b) => a.label.localeCompare(b.label));
  }
  return filtered;
}
