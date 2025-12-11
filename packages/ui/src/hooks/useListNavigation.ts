import { useEffect, useMemo, useState } from 'react';

export interface ListNavigationResult {
  readonly selectedIndex: number;
  readonly setSelectedIndex: (value: number) => void;
  readonly moveSelection: (delta: number) => void;
}

export function useListNavigation(length: number): ListNavigationResult {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const moveSelection = (delta: number): void => {
    setSelectedIndex((current) => {
      if (length === 0) {
        return 0;
      }
      const next = current + delta;
      return Math.max(0, Math.min(next, length - 1));
    });
  };

  return {
    selectedIndex,
    setSelectedIndex,
    moveSelection,
  };
}

export interface FilteredListResult<T> {
  readonly filteredItems: T[];
  readonly selectedIndex: number;
  readonly setSelectedIndex: (value: number) => void;
  readonly moveSelection: (delta: number) => void;
}

export function useFilteredList<T>(
  items: T[],
  query: string,
  filterFn: (item: T, query: string) => boolean,
): FilteredListResult<T> {
  const filteredItems = useMemo(() => {
    if (!query.trim()) {
      return items;
    }
    return items.filter((item) => filterFn(item, query));
  }, [items, query, filterFn]);

  const { selectedIndex, setSelectedIndex, moveSelection } = useListNavigation(
    filteredItems.length,
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, setSelectedIndex]);

  return {
    filteredItems,
    selectedIndex,
    setSelectedIndex,
    moveSelection,
  };
}
