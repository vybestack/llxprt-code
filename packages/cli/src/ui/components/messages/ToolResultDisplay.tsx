/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Box, Text } from 'ink';
import { DiffRenderer } from './DiffRenderer.js';
import { Colors } from '../../colors.js';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { AnsiOutputText } from '../AnsiOutput.js';
import { MaxSizedBox } from '../shared/MaxSizedBox.js';
import { type AnsiOutput } from '@vybestack/llxprt-code-core';
import { useUIState } from '../../contexts/UIStateContext.js';
import { STATUS_INDICATOR_WIDTH } from './ToolShared.js';

const STATIC_HEIGHT = 1;
const RESERVED_LINE_COUNT = 5; // for tool name, status, padding etc.
const MIN_LINES_SHOWN = 2; // show at least this many lines

// Large threshold to ensure we don't cause performance issues for very large
// outputs that will get truncated further MaxSizedBox anyway.
const MAXIMUM_RESULT_DISPLAY_CHARACTERS = 1000000;

function isAnsiToken(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { text?: unknown }).text === 'string'
  );
}

function isAnsiOutput(value: unknown): value is AnsiOutput {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (line) =>
        Array.isArray(line) && line.every((token) => isAnsiToken(token)),
    )
  );
}
/**
 * Render AST validation status.
 */
function renderAstValidation(
  metadata: Record<string, unknown> | undefined,
): React.ReactNode {
  const astValidation = metadata?.astValidation as
    | { valid: boolean; errors: string[] }
    | undefined;
  if (!astValidation) return null;

  return (
    <Box marginBottom={1}>
      {astValidation.valid ? (
        <Text color={Colors.AccentGreen}>AST Validation Passed</Text>
      ) : (
        <Box flexDirection="column">
          <Text color={Colors.AccentRed} bold>
            AST Validation Failed
          </Text>
          {astValidation.errors.map((err: string, i: number) => (
            <Text key={i} color={Colors.AccentRed}>
              - {err}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}

/**
 * Render file diff display content.
 */
function renderFileDiffContent(
  displayContent: {
    fileDiff: string;
    fileName?: string;
    metadata?: Record<string, unknown>;
  },
  availableHeight: number | undefined,
  childWidth: number,
): React.ReactNode {
  return (
    <>
      {renderAstValidation(displayContent.metadata)}
      <DiffRenderer
        diffContent={displayContent.fileDiff}
        filename={displayContent.fileName}
        availableTerminalHeight={availableHeight}
        terminalWidth={childWidth}
      />
    </>
  );
}

/**
 * Render content display with metadata.
 */
function renderContentWithMetadata(
  displayContent: { content: string; metadata?: Record<string, unknown> },
  availableHeight: number | undefined,
  childWidth: number,
  renderMarkdown: boolean,
): React.ReactNode {
  const metadata = displayContent.metadata;
  const language = metadata?.language;
  const declarationsCount = metadata?.declarationsCount;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1} flexDirection="column">
        {typeof language === 'string' && (
          <Text color={Colors.AccentGreen}>Language: {language}</Text>
        )}
        {typeof declarationsCount === 'number' && (
          <Text color={Colors.AccentGreen}>
            Declarations Found: {declarationsCount}
          </Text>
        )}
      </Box>
      <MarkdownDisplay
        text={displayContent.content}
        isPending={false}
        availableTerminalHeight={availableHeight}
        terminalWidth={childWidth}
        renderMarkdown={renderMarkdown}
      />
    </Box>
  );
}

/**
 * Render object content (fileDiff or content).
 */
function renderObjectContent(
  displayContent: object,
  availableHeight: number | undefined,
  childWidth: number,
  renderMarkdown: boolean,
): React.ReactNode {
  return (
    <Box flexDirection="column">
      {'fileDiff' in displayContent &&
        renderFileDiffContent(
          displayContent as {
            fileDiff: string;
            fileName?: string;
            metadata?: Record<string, unknown>;
          },
          availableHeight,
          childWidth,
        )}
      {'content' in displayContent &&
        renderContentWithMetadata(
          displayContent as {
            content: string;
            metadata?: Record<string, unknown>;
          },
          availableHeight,
          childWidth,
          renderMarkdown,
        )}
    </Box>
  );
}

/**
 * Drops source lines that cannot reach the visible window.
 *
 * `MaxSizedBox` shows the tail of its content and lays out every line it is
 * given before clipping. A source line always occupies at least one display
 * line, so keeping the last `maxDisplayLines` source lines is enough to fill
 * the window, and everything earlier can be dropped before layout rather than
 * wrapped and discarded afterwards.
 *
 * The returned count is the estimated number of display lines removed, so the
 * caller can report them through `additionalHiddenLinesCount`. It is an
 * estimate because exact wrapping depends on word boundaries.
 */
export function trimToVisibleTail(
  text: string,
  maxDisplayLines: number,
  width: number,
): { text: string; hiddenDisplayLines: number } {
  const lines = text.split('\n');
  if (lines.length <= maxDisplayLines) {
    return { text, hiddenDisplayLines: 0 };
  }

  const usableWidth = Math.max(1, width);
  const removed = lines.slice(0, lines.length - maxDisplayLines);
  let hiddenDisplayLines = 0;
  for (const line of removed) {
    hiddenDisplayLines += Math.max(1, Math.ceil(line.length / usableWidth));
  }

  return {
    text: lines.slice(lines.length - maxDisplayLines).join('\n'),
    hiddenDisplayLines,
  };
}

/**
 * Render string content.
 */
function renderStringContent(
  displayContent: string,
  shouldRenderMarkdown: boolean,
  availableHeight: number | undefined,
  childWidth: number,
  renderMarkdown: boolean,
): React.ReactNode {
  if (shouldRenderMarkdown) {
    return (
      <Box flexDirection="column">
        <MarkdownDisplay
          text={displayContent}
          isPending={false}
          terminalWidth={childWidth}
          renderMarkdown={renderMarkdown}
        />
      </Box>
    );
  }

  const { text, hiddenDisplayLines } =
    availableHeight === undefined
      ? { text: displayContent, hiddenDisplayLines: 0 }
      : trimToVisibleTail(displayContent, availableHeight, childWidth);

  return (
    <MaxSizedBox
      maxHeight={availableHeight}
      maxWidth={childWidth}
      additionalHiddenLinesCount={hiddenDisplayLines}
    >
      <Box>
        <Text color={Colors.Foreground} wrap="wrap">
          {text}
        </Text>
      </Box>
    </MaxSizedBox>
  );
}

export interface ToolResultDisplayProps {
  resultDisplay: string | object | undefined;
  availableTerminalHeight?: number;
  terminalWidth: number;
  renderOutputAsMarkdown?: boolean;
}

export const ToolResultDisplay: React.FC<ToolResultDisplayProps> = ({
  resultDisplay,
  availableTerminalHeight,
  terminalWidth,
  renderOutputAsMarkdown = true,
}) => {
  const { renderMarkdown } = useUIState();

  const availableHeight =
    availableTerminalHeight !== undefined
      ? Math.max(
          availableTerminalHeight - STATIC_HEIGHT - RESERVED_LINE_COUNT,
          MIN_LINES_SHOWN + 1,
        )
      : undefined;

  const shouldRenderMarkdown =
    availableHeight !== undefined ? false : renderOutputAsMarkdown;

  const childWidth = terminalWidth;

  let displayContent = resultDisplay;
  if (
    typeof displayContent === 'string' &&
    displayContent.length > MAXIMUM_RESULT_DISPLAY_CHARACTERS
  ) {
    displayContent =
      '...' + displayContent.slice(-MAXIMUM_RESULT_DISPLAY_CHARACTERS);
  }

  if (displayContent === undefined) {
    return null;
  }

  const ansiOutput = isAnsiOutput(displayContent) ? displayContent : undefined;

  return (
    <Box
      paddingLeft={STATUS_INDICATOR_WIDTH}
      width="100%"
      marginTop={1}
      flexDirection="column"
    >
      {ansiOutput !== undefined && (
        <AnsiOutputText
          data={ansiOutput}
          availableTerminalHeight={availableHeight}
          width={childWidth}
        />
      )}
      {typeof displayContent === 'string' &&
        renderStringContent(
          displayContent,
          shouldRenderMarkdown,
          availableHeight,
          childWidth,
          renderMarkdown,
        )}
      {ansiOutput === undefined &&
        typeof displayContent !== 'string' &&
        renderObjectContent(
          displayContent,
          availableHeight,
          childWidth,
          renderMarkdown,
        )}
    </Box>
  );
};
