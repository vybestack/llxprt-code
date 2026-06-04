/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

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

  return (
    <MaxSizedBox maxHeight={availableHeight} maxWidth={childWidth}>
      <Box>
        <Text color={Colors.Foreground} wrap="wrap">
          {displayContent}
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

  const isAnsiOutput =
    Array.isArray(displayContent) &&
    displayContent.length > 0 &&
    Array.isArray(displayContent[0]);

  return (
    <Box
      paddingLeft={STATUS_INDICATOR_WIDTH}
      width="100%"
      marginTop={1}
      flexDirection="column"
    >
      {isAnsiOutput && (
        <AnsiOutputText
          data={displayContent as unknown as AnsiOutput}
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
      {!isAnsiOutput &&
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
