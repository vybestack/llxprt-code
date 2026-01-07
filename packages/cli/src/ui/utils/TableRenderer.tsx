/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text, Box } from 'ink';
import { theme } from '../colors.js';
import { RenderInline, getPlainTextLength } from './InlineMarkdownRenderer.js';

const TERMINAL_MARGIN = 2;
const MIN_COLUMN_WIDTH = 4;
const WRAP_CACHE_LIMIT = 200;

const wrapCache = new Map<string, string[]>();
const wrapCacheOrder: string[] = [];

interface MarkerDef {
  open: string;
  close: string;
  symmetric: boolean;
}

interface MarkerState {
  def: MarkerDef;
}

const MARKER_DEFS: MarkerDef[] = [
  { open: '**', close: '**', symmetric: true },
  { open: '__', close: '__', symmetric: true },
  { open: '~~', close: '~~', symmetric: true },
  { open: '*', close: '*', symmetric: true },
  { open: '_', close: '_', symmetric: true },
  { open: '<u>', close: '</u>', symmetric: false },
];

const SORTED_MARKERS = [...MARKER_DEFS].sort(
  (a, b) =>
    Math.max(b.open.length, b.close.length) -
    Math.max(a.open.length, a.close.length),
);

const MARKER_BOUNDARY_CHARS = new Set(['*', '_', '~', '<', '/', '`']);

const getOpeningSequence = (stack: MarkerState[]): string =>
  stack.map(({ def }) => def.open).join('');

const getClosingSequence = (stack: MarkerState[]): string => {
  let closing = '';
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    closing += stack[index]?.def.close ?? '';
  }
  return closing;
};

const updateMarkerStack = (
  segment: string,
  stack: MarkerState[],
): MarkerState[] => {
  if (!segment) return [...stack];

  const updated = [...stack];
  let pointer = 0;

  while (pointer < segment.length) {
    let matched = false;

    for (const marker of SORTED_MARKERS) {
      if (!marker.symmetric && segment.startsWith(marker.close, pointer)) {
        const matchIndex = [...updated]
          .reverse()
          .findIndex((entry) => entry.def === marker);
        if (matchIndex !== -1) {
          updated.splice(updated.length - matchIndex - 1);
        }
        pointer += marker.close.length;
        matched = true;
        break;
      }

      if (segment.startsWith(marker.open, pointer)) {
        if (marker.symmetric) {
          if (
            updated.length > 0 &&
            updated[updated.length - 1]?.def === marker
          ) {
            updated.pop();
          } else {
            updated.push({ def: marker });
          }
        } else {
          updated.push({ def: marker });
        }
        pointer += marker.open.length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      pointer += 1;
    }
  }

  return updated;
};

const findBreakIndex = (
  content: string,
  prefix: string,
  maxWidth: number,
): number => {
  let left = 0;
  let right = content.length;
  let best = 0;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const candidate = prefix + content.slice(0, mid);
    if (getPlainTextLength(candidate) <= maxWidth) {
      best = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return best;
};

const adjustBreakIndex = (content: string, index: number): number => {
  if (index <= 0 || index > content.length) {
    return index;
  }

  const slice = content.slice(0, index);
  let whitespaceIndex = -1;
  for (let pointer = slice.length - 1; pointer >= 0; pointer -= 1) {
    if (/\s/u.test(slice[pointer] ?? '')) {
      whitespaceIndex = pointer;
      break;
    }
  }

  let adjusted = index;
  if (whitespaceIndex !== -1) {
    adjusted = whitespaceIndex + 1;
  }

  if (adjusted === 0) {
    adjusted = index;
  }

  while (
    adjusted > 0 &&
    MARKER_BOUNDARY_CHARS.has(content[adjusted - 1] ?? '')
  ) {
    adjusted -= 1;
  }

  return adjusted > 0 ? adjusted : index;
};

const wrapCellContent = (content: string, maxWidth: number): string[] => {
  const cacheKey = `${maxWidth}::${content}`;
  const cached = wrapCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  if (maxWidth <= 0) {
    rememberWrapResult(cacheKey, ['']);
    return [''];
  }
  if (!content) {
    rememberWrapResult(cacheKey, ['']);
    return [''];
  }
  if (getPlainTextLength(content) <= maxWidth) {
    rememberWrapResult(cacheKey, [content]);
    return [content];
  }

  const lines: string[] = [];
  let remaining = content;
  let activeStack: MarkerState[] = [];
  let guard = 0;

  while (remaining.length > 0 && guard < 1000) {
    guard += 1;

    const prefix = getOpeningSequence(activeStack);
    let breakIndex = findBreakIndex(remaining, prefix, maxWidth);

    if (breakIndex <= 0) {
      const [firstChar] = [...remaining];
      const charLength = firstChar ? firstChar.length : 1;
      const segment = remaining.slice(0, charLength);
      lines.push(prefix + segment + getClosingSequence(activeStack));
      remaining = remaining.slice(charLength);
      continue;
    }

    if (breakIndex < remaining.length) {
      const adjusted = adjustBreakIndex(remaining, breakIndex);
      if (adjusted > 0) {
        breakIndex = adjusted;
      }
    }

    const segmentRaw = remaining.slice(0, breakIndex);
    remaining = remaining.slice(breakIndex).replace(/^\s+/u, '');

    const segment = segmentRaw.replace(/\s+$/u, '');
    const updatedStack = updateMarkerStack(segment, activeStack);
    const closingSequence = getClosingSequence(updatedStack);

    if (segment.length > 0 || closingSequence.length > 0) {
      lines.push(prefix + segment + closingSequence);
    }

    activeStack = updatedStack;
  }

  const result = lines.length > 0 ? lines : [''];
  rememberWrapResult(cacheKey, result);
  return result;
};

const rememberWrapResult = (key: string, lines: string[]): void => {
  if (wrapCache.has(key)) {
    const existingIndex = wrapCacheOrder.indexOf(key);
    if (existingIndex !== -1) {
      wrapCacheOrder.splice(existingIndex, 1);
    }
  }
  wrapCache.set(key, lines);
  wrapCacheOrder.push(key);

  while (wrapCacheOrder.length > WRAP_CACHE_LIMIT) {
    const oldestKey = wrapCacheOrder.shift();
    if (oldestKey) {
      wrapCache.delete(oldestKey);
    }
  }
};

interface TableRendererProps {
  headers: string[];
  rows: string[][];
  terminalWidth: number;
}

/**
 * Custom table renderer for markdown tables
 * We implement our own instead of using ink-table due to module compatibility issues
 */
export const TableRenderer: React.FC<TableRendererProps> = ({
  headers,
  rows,
  terminalWidth,
}) => {
  // Calculate column widths using actual display width after markdown processing
  const columnWidths = headers.map((header, index) => {
    const headerWidth = getPlainTextLength(header);
    const maxRowWidth = Math.max(
      ...rows.map((row) => getPlainTextLength(row[index] || '')),
    );
    return Math.max(headerWidth, maxRowWidth) + 2; // Add padding
  });

  // Ensure table fits within terminal width
  const totalWidth = columnWidths.reduce((sum, width) => sum + width + 1, 1);
  const minTotalWidth = headers.length * MIN_COLUMN_WIDTH + headers.length + 1;
  const availableWidth = Math.max(
    Math.min(totalWidth, Math.max(terminalWidth - TERMINAL_MARGIN, 0)),
    minTotalWidth,
  );
  const scaleFactor =
    totalWidth > availableWidth ? availableWidth / totalWidth : 1;
  const adjustedWidths = columnWidths.map((width) =>
    Math.max(MIN_COLUMN_WIDTH, Math.floor(width * scaleFactor)),
  );

  let adjustedTotal = adjustedWidths.reduce((sum, width) => sum + width + 1, 1);

  while (
    adjustedTotal > availableWidth &&
    adjustedWidths.some((width) => width > MIN_COLUMN_WIDTH)
  ) {
    let indexToTrim = -1;
    let largestWidth = MIN_COLUMN_WIDTH;
    adjustedWidths.forEach((width, index) => {
      if (width > largestWidth) {
        largestWidth = width;
        indexToTrim = index;
      }
    });

    if (indexToTrim === -1) {
      break;
    }

    adjustedWidths[indexToTrim] -= 1;
    adjustedTotal -= 1;
  }

  // Helper function to render border
  const renderBorder = (type: 'top' | 'middle' | 'bottom'): React.ReactNode => {
    const chars = {
      top: { left: '┌', middle: '┬', right: '┐', horizontal: '─' },
      middle: { left: '├', middle: '┼', right: '┤', horizontal: '─' },
      bottom: { left: '└', middle: '┴', right: '┘', horizontal: '─' },
    };

    const char = chars[type];
    const borderParts = adjustedWidths.map((w) => char.horizontal.repeat(w));
    const border = char.left + borderParts.join(char.middle) + char.right;

    return <Text color={theme.border.default}>{border}</Text>;
  };

  // Helper function to render a table row
  const renderRow = (cells: string[], isHeader = false): React.ReactNode => {
    const cellData = cells.map((cell, index) => {
      const width = adjustedWidths[index] || 0;
      const contentWidth = Math.max(0, width - 2);
      const cacheKey = `${contentWidth}::${cell || ''}`;
      const cachedLines = wrapCache.get(cacheKey);
      const lines = cachedLines ?? wrapCellContent(cell || '', contentWidth);
      return { lines, contentWidth };
    });

    const maxLines = Math.max(1, ...cellData.map((data) => data.lines.length));

    return (
      <Text color={theme.text.primary}>
        {Array.from({ length: maxLines }).map((_, lineIndex) => (
          <React.Fragment key={lineIndex}>
            {lineIndex > 0 ? '\n' : null}
            <Text color={theme.border.default}>│</Text>{' '}
            {cellData.map((data, index) => {
              const lineContent = data.lines[lineIndex] ?? '';
              const displayWidth = getPlainTextLength(lineContent);
              const padding = Math.max(0, data.contentWidth - displayWidth);
              const contentNode = isHeader ? (
                <Text bold color={theme.text.accent}>
                  <RenderInline text={lineContent} />
                </Text>
              ) : (
                <RenderInline text={lineContent} />
              );

              return (
                <React.Fragment key={index}>
                  {contentNode}
                  {padding > 0 ? ' '.repeat(padding) : ''}
                  {index < cellData.length - 1 ? (
                    <>
                      {' '}
                      <Text color={theme.border.default}>│</Text>{' '}
                    </>
                  ) : null}
                </React.Fragment>
              );
            })}{' '}
            <Text color={theme.border.default}>│</Text>
          </React.Fragment>
        ))}
      </Text>
    );
  };

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Top border */}
      {renderBorder('top')}

      {/* Header row */}
      {renderRow(headers, true)}

      {/* Middle border */}
      {renderBorder('middle')}

      {/* Data rows */}
      {rows.map((row, index) => (
        <React.Fragment key={index}>{renderRow(row)}</React.Fragment>
      ))}

      {/* Bottom border */}
      {renderBorder('bottom')}
    </Box>
  );
};
