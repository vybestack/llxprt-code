import { useKeyboard } from '@vybestack/opentui-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
} from 'react';
import type { TextareaRenderable } from '@vybestack/opentui-core';
import { useListNavigation } from '../../hooks/useListNavigation';
import { ModalShell } from './ModalShell';
import type { ThemeDefinition } from '../../features/theme';
import { FilterInput } from '../components/FilterInput';
import { SelectableListItem } from '../components/SelectableList';

export interface ThemeModalProps {
  readonly themes: ThemeDefinition[];
  readonly current: ThemeDefinition;
  readonly onClose: () => void;
  readonly onSelect: (theme: ThemeDefinition) => void;
}

export function ThemeModal(props: ThemeModalProps): JSX.Element {
  const searchRef = useRef<TextareaRenderable | null>(null);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) {
      return props.themes;
    }
    const normalized = query.trim().toLowerCase();
    return props.themes.filter(
      (theme) =>
        theme.name.toLowerCase().includes(normalized) ||
        theme.slug.toLowerCase().includes(normalized) ||
        theme.kind.toLowerCase().includes(normalized),
    );
  }, [props.themes, query]);

  const { selectedIndex, setSelectedIndex, moveSelection } = useListNavigation(
    filtered.length,
  );
  const selected = filtered[selectedIndex] ?? filtered[0] ?? props.current;

  const handleQueryChange = useCallback((newQuery: string) => {
    setQuery(newQuery);
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, setSelectedIndex]);

  useKeyboard((key) => {
    if (key.eventType !== 'press') {
      return;
    }
    if (key.name === 'escape') {
      props.onClose();
      return;
    }
    if (filtered.length === 0) {
      return;
    }
    if (key.name === 'down') {
      key.preventDefault();
      moveSelection(1);
    } else if (key.name === 'up') {
      key.preventDefault();
      moveSelection(-1);
    } else if (key.name === 'return' || key.name === 'enter') {
      key.preventDefault();
      const currentSelection = filtered[selectedIndex] ?? filtered[0];
      if (currentSelection) {
        props.onSelect(currentSelection);
      }
      props.onClose();
    }
  });

  const countLabel = `Found ${filtered.length} of ${props.themes.length} themes`;

  return (
    <ModalShell
      title="Select Theme"
      onClose={props.onClose}
      theme={props.current}
    >
      <text fg={props.current.colors.text.primary}>{countLabel}</text>
      <box flexDirection="row" style={{ gap: 1, alignItems: 'center' }}>
        <text fg={props.current.colors.text.primary}>Filter:</text>
        <FilterInput
          textareaRef={searchRef}
          placeholder="type to filter"
          theme={props.current}
          onQueryChange={handleQueryChange}
        />
      </box>
      <box flexDirection="row" style={{ gap: 1, height: 14 }}>
        <ThemeList
          themes={filtered}
          selectedIndex={selectedIndex}
          activeSlug={props.current.slug}
          displayTheme={props.current}
        />
        <ThemePreview theme={selected} />
      </box>
    </ModalShell>
  );
}

function ThemeList(props: {
  readonly themes: ThemeDefinition[];
  readonly selectedIndex: number;
  readonly activeSlug: string;
  readonly displayTheme: ThemeDefinition;
}): JSX.Element {
  return (
    <scrollbox
      style={{
        width: '45%',
        border: true,
        borderColor: props.displayTheme.colors.panel.border,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      scrollY
    >
      <box flexDirection="column" style={{ gap: 0 }}>
        {props.themes.map((theme, index) =>
          renderThemeRow(
            theme,
            index,
            props.selectedIndex,
            props.activeSlug,
            props.displayTheme,
          ),
        )}
      </box>
    </scrollbox>
  );
}

function renderThemeRow(
  theme: ThemeDefinition,
  index: number,
  selectedIndex: number,
  activeSlug: string,
  displayTheme: ThemeDefinition,
): JSX.Element {
  const isSelected = index === selectedIndex;
  const isActive = theme.slug === activeSlug;
  return (
    <SelectableListItem
      key={theme.slug}
      label={theme.name}
      isSelected={isSelected}
      isActive={isActive}
      activeTag=" (active)"
      theme={displayTheme}
    />
  );
}

function ThemePreview({
  theme,
}: {
  readonly theme: ThemeDefinition;
}): JSX.Element {
  return (
    <box
      border
      style={{
        flexGrow: 1,
        padding: 1,
        borderColor: theme.colors.panel.border,
        backgroundColor: theme.colors.panel.bg,
        gap: 0,
        flexDirection: 'column',
      }}
    >
      <text
        fg={theme.colors.panel.headerFg ?? theme.colors.text.primary}
        bg={theme.colors.panel.headerBg ?? theme.colors.panel.bg}
      >
        {`${theme.name} (${theme.kind})`}
      </text>
      <text fg={theme.colors.text.user}>[user] Hello world</text>
      <text fg={theme.colors.text.responder}>
        [responder] A thoughtful reply
      </text>
      <text fg={theme.colors.text.thinking}>
        [thinking] Considering options...
      </text>
      <text fg={theme.colors.text.tool}>[tool] SearchInFile src/app.tsx</text>
      <text fg={theme.colors.diff.addedFg} bg={theme.colors.diff.addedBg}>
        + diff added line
      </text>
      <text fg={theme.colors.diff.removedFg} bg={theme.colors.diff.removedBg}>
        - diff removed line
      </text>
    </box>
  );
}
