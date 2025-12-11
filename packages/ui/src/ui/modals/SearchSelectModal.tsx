import type { TextareaRenderable } from '@vybestack/opentui-core';
import { useKeyboard } from '@vybestack/opentui-react';
import { useCallback, useMemo, useRef, useState, type JSX } from 'react';
import { useFilteredList } from '../../hooks/useListNavigation';
import { type SearchItem } from './types';
import { ModalShell } from './ModalShell';
import type { ThemeDefinition } from '../../features/theme';
import { FilterInput } from '../components/FilterInput';
import { SelectableListItem } from '../components/SelectableList';

const GRID_COLUMNS = 3;
const SEARCH_PAGE_SIZE = GRID_COLUMNS * 6;

export interface SearchSelectProps {
  readonly title: string;
  readonly noun: string;
  readonly items: SearchItem[];
  readonly alphabetical?: boolean;
  readonly footerHint?: string;
  readonly onClose: () => void;
  readonly onSelect: (item: SearchItem) => void;
  readonly theme?: ThemeDefinition;
}

export function SearchSelectModal(props: SearchSelectProps): JSX.Element {
  const searchRef = useRef<TextareaRenderable | null>(null);
  const [query, setQuery] = useState('');

  const filterFn = useCallback(
    (item: SearchItem, searchQuery: string): boolean => {
      const normalized = searchQuery.trim().toLowerCase();
      return item.label.toLowerCase().includes(normalized);
    },
    [],
  );

  const { filteredItems, selectedIndex, moveSelection } = useFilteredList(
    props.items,
    query,
    filterFn,
  );

  const sortedFiltered = useMemo(() => {
    if (props.alphabetical === true) {
      return [...filteredItems].sort((a, b) => a.label.localeCompare(b.label));
    }
    return filteredItems;
  }, [filteredItems, props.alphabetical]);

  const { pageStart, visible, startDisplay, endDisplay } = getPagination(
    sortedFiltered,
    selectedIndex,
  );
  const current = sortedFiltered[selectedIndex];

  const handleQueryChange = useCallback((newQuery: string) => {
    setQuery(newQuery);
  }, []);

  useSearchSelectKeys(
    sortedFiltered,
    selectedIndex,
    moveSelection,
    current,
    props.onSelect,
    props.onClose,
  );

  return (
    <ModalShell
      title={props.title}
      onClose={props.onClose}
      theme={props.theme}
      footer={
        props.footerHint ? (
          <text fg={props.theme?.colors.text.muted}>{props.footerHint}</text>
        ) : undefined
      }
    >
      <text
        fg={props.theme?.colors.text.primary}
      >{`Found ${sortedFiltered.length} of ${props.items.length} ${props.noun}`}</text>
      <box flexDirection="row" style={{ gap: 1, alignItems: 'center' }}>
        <text
          fg={props.theme?.colors.text.primary}
        >{`${props.alphabetical === true ? 'Search' : 'Filter'}:`}</text>
        <FilterInput
          textareaRef={searchRef}
          placeholder="type to filter"
          theme={props.theme}
          onQueryChange={handleQueryChange}
        />
      </box>
      <text
        fg={props.theme?.colors.text.primary}
      >{`Showing ${startDisplay}-${endDisplay} of ${sortedFiltered.length} rows`}</text>
      <SearchGrid
        items={visible}
        pageStart={pageStart}
        selectedIndex={selectedIndex}
        theme={props.theme}
      />
    </ModalShell>
  );
}

function useSearchSelectKeys(
  filtered: SearchItem[],
  selectedIndex: number,
  moveSelection: (delta: number) => void,
  current: SearchItem | undefined,
  onSelect: (item: SearchItem) => void,
  onClose: () => void,
): void {
  useKeyboard((key) => {
    if (key.eventType !== 'press') {
      return;
    }
    if (key.name === 'escape') {
      onClose();
      return;
    }
    if (filtered.length === 0) {
      return;
    }
    const handlers: Record<string, () => void> = {
      tab: () => moveSelection(key.shift ? -1 : 1),
      return: () => {
        if (current != null) {
          onSelect(current);
        }
      },
      enter: () => {
        if (current != null) {
          onSelect(current);
        }
      },
      up: () => moveSelection(-GRID_COLUMNS),
      down: () => moveSelection(GRID_COLUMNS),
      left: () => moveSelection(-1),
      right: () => moveSelection(1),
    };
    if (key.name in handlers) {
      key.preventDefault();
      handlers[key.name]();
    }
  });
}

function SearchGrid(props: {
  readonly items: SearchItem[];
  readonly pageStart: number;
  readonly selectedIndex: number;
  readonly theme?: ThemeDefinition;
}): JSX.Element {
  return (
    <box flexDirection="column" style={{ gap: 0 }}>
      {renderSearchGrid(
        props.items,
        props.pageStart,
        props.selectedIndex,
        props.theme,
      )}
    </box>
  );
}

function renderSearchGrid(
  items: SearchItem[],
  pageStart: number,
  selectedIndex: number,
  theme?: ThemeDefinition,
): JSX.Element[] {
  const rows = chunkItems(items, GRID_COLUMNS);
  const columnWidths = Array.from({ length: GRID_COLUMNS }, (_, col) =>
    Math.max(0, ...rows.map((row) => (row.at(col)?.label.length ?? 0) + 2)),
  );

  return rows.map((row, rowIndex) => (
    <box key={`row-${rowIndex}`} flexDirection="row" style={{ gap: 2 }}>
      {row.map((item, index) =>
        renderSearchItem(
          item,
          pageStart + rowIndex * GRID_COLUMNS + index,
          selectedIndex,
          columnWidths[index] ?? item.label.length + 2,
          theme,
        ),
      )}
    </box>
  ));
}

function renderSearchItem(
  item: SearchItem,
  absoluteIndex: number,
  selectedIndex: number,
  width: number,
  theme?: ThemeDefinition,
): JSX.Element {
  const isSelected = absoluteIndex === selectedIndex;
  return (
    <SelectableListItem
      key={item.id}
      label={item.label}
      isSelected={isSelected}
      width={width + 2}
      theme={theme}
    />
  );
}

function getPagination(
  filtered: SearchItem[],
  selectedIndex: number,
): {
  pageStart: number;
  visible: SearchItem[];
  startDisplay: number;
  endDisplay: number;
} {
  const pageStart =
    Math.floor(selectedIndex / SEARCH_PAGE_SIZE) * SEARCH_PAGE_SIZE;
  const visible = filtered.slice(pageStart, pageStart + SEARCH_PAGE_SIZE);
  const startDisplay = filtered.length === 0 ? 0 : pageStart + 1;
  const endDisplay = Math.min(pageStart + visible.length, filtered.length);
  return { pageStart, visible, startDisplay, endDisplay };
}

function chunkItems(list: SearchItem[], columns: number): SearchItem[][] {
  const rows: SearchItem[][] = [];
  for (let index = 0; index < list.length; index += columns) {
    rows.push(list.slice(index, index + columns));
  }
  return rows;
}
