/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Colors } from '../colors.js';
import type { UseCommandCompletionReturn } from '../hooks/useCommandCompletion.js';
import { theme } from '../semantic-colors.js';
import { SCREEN_READER_USER_PREFIX } from '../textConstants.js';
import {
  parseInputForHighlighting,
  parseSegmentsFromTokens,
} from '../utils/highlight.js';
import { cpLen, cpSlice, getCachedStringWidth } from '../utils/textUtils.js';
import type { Suggestion } from './SuggestionsDisplay.js';
import { SuggestionsDisplay } from './SuggestionsDisplay.js';
import { computeGhostText } from './inputPromptText.js';
import type { TextBuffer } from './shared/text-buffer.js';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import type React from 'react';

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

/** Build a highlighted cursor character if it falls within this segment. */
const applyCursorHighlight = (
  display: string,
  isOnCursorLine: boolean,
  segLen: number,
  charCount: number,
  cursorVisualColAbsolute: number,
): { display: string; newCharCount: number } => {
  if (!isOnCursorLine || segLen === 0) {
    return { display, newCharCount: charCount + segLen };
  }

  const segStart = charCount;
  const segEnd = segStart + segLen;

  if (cursorVisualColAbsolute >= segStart && cursorVisualColAbsolute < segEnd) {
    const charToHighlight = cpSlice(
      display,
      cursorVisualColAbsolute - segStart,
      cursorVisualColAbsolute - segStart + 1,
    );
    const highlighted = charToHighlight
      ? chalk.inverse(charToHighlight)
      : charToHighlight;
    const newDisplay =
      cpSlice(display, 0, cursorVisualColAbsolute - segStart) +
      highlighted +
      cpSlice(display, cursorVisualColAbsolute - segStart + 1);
    return { display: newDisplay, newCharCount: segEnd };
  }
  return { display, newCharCount: segEnd };
};

/** Render highlighted segments for a single visual line. */
const renderSegments = (
  segments: ReadonlyArray<{ text: string; type: string }>,
  isOnCursorLine: boolean,
  cursorVisualColAbsolute: number,
): React.ReactNode[] => {
  const renderedLine: React.ReactNode[] = [];
  let charCount = 0;

  segments.forEach((seg, segIdx) => {
    const segLen = cpLen(seg.text);
    let display = seg.text;

    const result = applyCursorHighlight(
      display,
      isOnCursorLine,
      segLen,
      charCount,
      cursorVisualColAbsolute,
    );
    display = result.display;
    charCount = result.newCharCount;

    const color =
      seg.type === 'command' || seg.type === 'file'
        ? theme.text.accent
        : undefined;

    if (segLen > 0) {
      renderedLine.push(
        <Text key={`token-${segIdx}`} color={color}>
          {display}
        </Text>,
      );
    }
  });

  return renderedLine;
};

/** Render a single visual line with syntax highlighting and cursor. */
const renderVisualLine = (
  lineText: string,
  visualIdxInRenderedSet: number,
  scrollVisualRow: number,
  cursorVisualRowAbsolute: number,
  cursorVisualColAbsolute: number,
  buffer: TextBuffer,
  focus: boolean,
  inlineGhost: string,
): React.ReactNode => {
  const absoluteVisualIdx = scrollVisualRow + visualIdxInRenderedSet;
  const mapEntry = buffer.visualToLogicalMap[absoluteVisualIdx];
  const cursorVisualRow = cursorVisualRowAbsolute - scrollVisualRow;
  const isOnCursorLine = focus && visualIdxInRenderedSet === cursorVisualRow;

  const [logicalLineIdx] = mapEntry;
  const logicalLine = buffer.lines[logicalLineIdx] ?? '';
  const transformations = buffer.transformationsByLine[logicalLineIdx] ?? [];
  const tokens = parseInputForHighlighting(
    logicalLine,
    logicalLineIdx,
    transformations,
    ...(focus && buffer.cursor[0] === logicalLineIdx ? [buffer.cursor[1]] : []),
  );
  const startColInTransformed =
    buffer.visualToTransformedMap[absoluteVisualIdx] ?? 0;
  const visualEndCol = startColInTransformed + cpLen(lineText);
  const segments = parseSegmentsFromTokens(
    tokens,
    startColInTransformed,
    visualEndCol,
  );

  const renderedLine = renderSegments(
    segments,
    isOnCursorLine,
    cursorVisualColAbsolute,
  );

  const currentLineGhost = isOnCursorLine ? inlineGhost : '';
  if (
    isOnCursorLine &&
    cursorVisualColAbsolute === cpLen(lineText) &&
    !currentLineGhost
  ) {
    renderedLine.push(
      <Text key="cursor-end" color={Colors.Foreground}>
        {chalk.inverse(' ')}
      </Text>,
    );
  }

  const showCursorBeforeGhost =
    focus === true &&
    isOnCursorLine === true &&
    cursorVisualColAbsolute === cpLen(lineText) &&
    currentLineGhost !== '';

  if (!currentLineGhost && renderedLine.length === 0) {
    renderedLine.push(
      <Text key="blank-placeholder" color={Colors.Foreground}>
        {' '}
      </Text>,
    );
  }

  return (
    <Text key={`line-${visualIdxInRenderedSet}`} color={theme.text.accent}>
      {renderedLine}
      {showCursorBeforeGhost === true && chalk.inverse(' ')}
      {currentLineGhost !== '' && (
        <Text color={theme.text.secondary}>{currentLineGhost}</Text>
      )}
    </Text>
  );
};

/** Suggestion nodes for completion, reverse search, and shell path. */
export const useSuggestionsNodes = (
  completion: UseCommandCompletionReturn,
  shellModeActive: boolean,
  reverseSearchActive: boolean,
  reverseSearchCompletion: {
    suggestions: Suggestion[];
    activeSuggestionIndex: number;
    isLoadingSuggestions: boolean;
    visibleStartIndex: number;
  },
  shellPathCompletion: {
    showSuggestions: boolean;
    suggestions: Suggestion[];
    activeSuggestionIndex: number;
    isLoadingSuggestions: boolean;
    visibleStartIndex: number;
  },
  suggestionsWidth: number,
  bufferText: string,
) => {
  const completionSuggestionsNode =
    completion.showSuggestions && !shellModeActive ? (
      <Box paddingRight={2}>
        <SuggestionsDisplay
          suggestions={completion.suggestions}
          activeIndex={completion.activeSuggestionIndex}
          isLoading={completion.isLoadingSuggestions}
          width={suggestionsWidth}
          scrollOffset={completion.visibleStartIndex}
          userInput={bufferText}
          activeHint={completion.activeHint}
        />
      </Box>
    ) : null;

  const reverseSearchSuggestionsNode = reverseSearchActive ? (
    <Box paddingRight={2}>
      <SuggestionsDisplay
        suggestions={reverseSearchCompletion.suggestions}
        activeIndex={reverseSearchCompletion.activeSuggestionIndex}
        isLoading={reverseSearchCompletion.isLoadingSuggestions}
        width={suggestionsWidth}
        scrollOffset={reverseSearchCompletion.visibleStartIndex}
        userInput={bufferText}
      />
    </Box>
  ) : null;

  const shellPathSuggestionsNode = shellPathCompletion.showSuggestions ? (
    <Box paddingRight={2}>
      <SuggestionsDisplay
        suggestions={shellPathCompletion.suggestions}
        activeIndex={shellPathCompletion.activeSuggestionIndex}
        isLoading={shellPathCompletion.isLoadingSuggestions}
        width={suggestionsWidth}
        scrollOffset={shellPathCompletion.visibleStartIndex}
        userInput={bufferText}
      />
    </Box>
  ) : null;

  const suggestionsNode =
    completionSuggestionsNode ??
    shellPathSuggestionsNode ??
    reverseSearchSuggestionsNode;

  return suggestionsNode;
};

/** Render ghost-line padding nodes for additional ghost text lines. */
const renderGhostLines = (
  additionalLines: string[],
  inputWidth: number,
): React.ReactNode[] =>
  additionalLines.map((ghostLine, index) => {
    const padding = Math.max(0, inputWidth - getCachedStringWidth(ghostLine));
    return (
      <Text key={`ghost-line-${index}`} color={theme.text.secondary}>
        {ghostLine}
        {' '.repeat(padding)}
      </Text>
    );
  });

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type PromptInputBoxProps = {
  buffer: TextBuffer;
  placeholder: string;
  focus: boolean;
  shellModeActive: boolean;
  reverseSearchActive: boolean;
  inputWidth: number;
  inlineGhost: string;
  additionalLines: string[];
};

export const useGhostTextLines = (
  completion: UseCommandCompletionReturn,
  buffer: TextBuffer,
  inputWidth: number,
): { inlineGhost: string; additionalLines: string[] } => {
  if (
    completion.promptCompletion.text === '' ||
    buffer.text === '' ||
    !completion.promptCompletion.text.startsWith(buffer.text)
  ) {
    return { inlineGhost: '', additionalLines: [] };
  }

  const ghostSuffix = completion.promptCompletion.text.slice(
    buffer.text.length,
  );
  if (ghostSuffix === '') {
    return { inlineGhost: '', additionalLines: [] };
  }

  return computeGhostText(
    ghostSuffix,
    buffer.cursor[1],
    buffer.lines[buffer.cursor[0]] ?? '',
    inputWidth,
  );
};

const renderPromptPrefixSymbol = (
  shellModeActive: boolean,
  reverseSearchActive: boolean,
): React.ReactNode => {
  if (!shellModeActive) {
    return '> ';
  }
  if (reverseSearchActive) {
    return (
      <Text color={theme.text.link} aria-label={SCREEN_READER_USER_PREFIX}>
        (r:){' '}
      </Text>
    );
  }
  return '! ';
};

const renderPromptPrefix = (
  shellModeActive: boolean,
  reverseSearchActive: boolean,
): React.ReactNode => (
  <Text color={shellModeActive ? theme.status.warning : theme.text.accent}>
    {renderPromptPrefixSymbol(shellModeActive, reverseSearchActive)}
  </Text>
);

const renderPlaceholder = (
  placeholder: string,
  focus: boolean,
): React.ReactNode =>
  focus ? (
    <Text color={Colors.Foreground}>
      {chalk.inverse(placeholder.slice(0, 1))}
      <Text color={Colors.DimComment}>{placeholder.slice(1)}</Text>
    </Text>
  ) : (
    <Text color={Colors.DimComment}>{placeholder}</Text>
  );

const renderInputLines = (
  buffer: TextBuffer,
  focus: boolean,
  inputWidth: number,
  inlineGhost: string,
  additionalLines: string[],
): React.ReactNode[] => {
  const [cursorVisualRowAbsolute, cursorVisualColAbsolute] =
    buffer.visualCursor;
  const scrollVisualRow = buffer.visualScrollRow;
  return buffer.viewportVisualLines
    .map((lineText, visualIdxInRenderedSet) =>
      renderVisualLine(
        lineText,
        visualIdxInRenderedSet,
        scrollVisualRow,
        cursorVisualRowAbsolute,
        cursorVisualColAbsolute,
        buffer,
        focus,
        inlineGhost,
      ),
    )
    .concat(renderGhostLines(additionalLines, inputWidth));
};

export const PromptInputBox: React.FC<PromptInputBoxProps> = ({
  buffer,
  placeholder,
  focus,
  shellModeActive,
  reverseSearchActive,
  inputWidth,
  inlineGhost,
  additionalLines,
}) => (
  <Box
    borderStyle="round"
    borderColor={shellModeActive ? theme.status.warning : theme.border.focused}
    paddingX={1}
  >
    {renderPromptPrefix(shellModeActive, reverseSearchActive)}
    <Box flexGrow={1} flexDirection="column">
      {buffer.text.length === 0 && placeholder
        ? renderPlaceholder(placeholder, focus)
        : renderInputLines(
            buffer,
            focus,
            inputWidth,
            inlineGhost,
            additionalLines,
          )}
    </Box>
  </Box>
);
