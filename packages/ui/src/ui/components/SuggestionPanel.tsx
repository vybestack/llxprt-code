import type { JSX } from 'react';
import { MAX_SUGGESTION_COUNT } from '../../features/completion';
import type { CompletionSuggestion } from '../../features/completion';
import type { ThemeDefinition } from '../../features/theme';

export interface SuggestionPanelProps {
  readonly suggestions: CompletionSuggestion[];
  readonly selectedIndex: number;
  readonly theme: ThemeDefinition;
}

function renderSuggestionRow(
  item: CompletionSuggestion,
  globalIndex: number,
  selectedIndex: number,
  maxLabel: number,
  theme: ThemeDefinition,
): JSX.Element {
  const isSelected = globalIndex === selectedIndex;
  const prefix =
    item.mode === 'slash' && item.displayPrefix !== false ? '/' : '';
  const label = `${prefix}${item.value}`.padEnd(maxLabel + 1, ' ');
  const description = item.description ? ` ${item.description}` : '';
  const rowText = `${label}${description}`;

  // Use explicit colors to avoid rendering issues with selection
  const bgColor = isSelected
    ? theme.colors.selection.bg
    : theme.colors.panel.bg;
  const fgColor = isSelected
    ? theme.colors.selection.fg
    : theme.colors.text.primary;

  return (
    <text
      key={`suggestion-${globalIndex}`}
      bg={bgColor}
      fg={fgColor}
      style={{ paddingLeft: 1, paddingRight: 1 }}
    >
      {rowText}
    </text>
  );
}

export function SuggestionPanel(
  props: SuggestionPanelProps,
): JSX.Element | null {
  if (props.suggestions.length === 0) {
    return null;
  }

  const pageSize = MAX_SUGGESTION_COUNT;
  const totalPages = Math.max(
    1,
    Math.ceil(props.suggestions.length / pageSize),
  );
  const pageIndex = Math.floor(props.selectedIndex / pageSize);
  const pageStart = pageIndex * pageSize;
  const pageItems = props.suggestions.slice(pageStart, pageStart + pageSize);
  const maxLabel = pageItems.reduce(
    (max, item) =>
      Math.max(max, item.value.length + (item.mode === 'slash' ? 1 : 0)),
    0,
  );
  const indicatorNeeded = props.suggestions.length > pageSize;
  const height = pageItems.length + (indicatorNeeded ? 1 : 0);

  return (
    <box
      style={{
        height,
        minHeight: height,
        maxHeight: height,
        paddingLeft: 0,
        paddingRight: 0,
        paddingTop: 0,
        paddingBottom: 0,
        flexDirection: 'column',
        backgroundColor: props.theme.colors.panel.bg,
        marginTop: 0,
        marginBottom: 1,
      }}
    >
      {pageItems.map((item, index) =>
        renderSuggestionRow(
          item,
          pageStart + index,
          props.selectedIndex,
          maxLabel,
          props.theme,
        ),
      )}
      {indicatorNeeded ? (
        <text
          fg={props.theme.colors.text.muted}
          style={{ paddingLeft: 1 }}
        >{`▼ page ${pageIndex + 1}/${totalPages} ▲`}</text>
      ) : null}
    </box>
  );
}
