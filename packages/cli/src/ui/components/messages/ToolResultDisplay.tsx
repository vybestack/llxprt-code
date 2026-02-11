/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { DiffRenderer } from './DiffRenderer.js';
import { Colors } from '../../colors.js';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { AnsiOutputText } from '../AnsiOutput.js';
import { MaxSizedBox } from '../shared/MaxSizedBox.js';
import {
  stripShellMarkers,
  type AnsiOutput,
} from '@vybestack/llxprt-code-core';
import { useUIState } from '../../contexts/UIStateContext.js';
import { STATUS_INDICATOR_WIDTH } from './ToolShared.js';

const STATIC_HEIGHT = 1;
const RESERVED_LINE_COUNT = 5; // for tool name, status, padding etc.
const MIN_LINES_SHOWN = 2; // show at least this many lines

// Large threshold to ensure we don't cause performance issues for very large
// outputs that will get truncated further MaxSizedBox anyway.
const MAXIMUM_RESULT_DISPLAY_CHARACTERS = 1000000;

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

  const availableHeight = availableTerminalHeight
    ? Math.max(
        availableTerminalHeight - STATIC_HEIGHT - RESERVED_LINE_COUNT,
        MIN_LINES_SHOWN + 1,
      )
    : undefined;

  // Long tool call response in MarkdownDisplay doesn't respect availableTerminalHeight properly,
  // we're forcing it to not render as markdown when the response is too long, it will fallback
  // to render as plain text, which is contained within the terminal using MaxSizedBox
  if (availableHeight) {
    renderOutputAsMarkdown = false;
  }

  const childWidth = terminalWidth;

  if (typeof resultDisplay === 'string') {
    if (resultDisplay.length > MAXIMUM_RESULT_DISPLAY_CHARACTERS) {
      resultDisplay =
        '...' + resultDisplay.slice(-MAXIMUM_RESULT_DISPLAY_CHARACTERS);
    }
  }

  // Build a filtered version for visual rendering (hide runtime markers).
  const visualResultDisplay =
    typeof resultDisplay === 'string'
      ? stripShellMarkers(resultDisplay)
      : resultDisplay;

  if (!resultDisplay) return null;

  // Check if resultDisplay is AnsiOutput (array of arrays)
  const isAnsiOutput =
    Array.isArray(resultDisplay) &&
    resultDisplay.length > 0 &&
    Array.isArray(resultDisplay[0]);

  return (
    <Box
      paddingLeft={STATUS_INDICATOR_WIDTH}
      width="100%"
      marginTop={1}
      flexDirection="column"
    >
      {isAnsiOutput && (
        <AnsiOutputText
          data={resultDisplay as unknown as AnsiOutput}
          availableTerminalHeight={availableHeight}
          width={childWidth}
        />
      )}
      {typeof resultDisplay === 'string' && renderOutputAsMarkdown && (
        <Box flexDirection="column">
          <MarkdownDisplay
            text={visualResultDisplay as string}
            isPending={false}
            terminalWidth={childWidth}
            renderMarkdown={renderMarkdown}
          />
        </Box>
      )}
      {typeof resultDisplay === 'string' && !renderOutputAsMarkdown && (
        <MaxSizedBox maxHeight={availableHeight} maxWidth={childWidth}>
          <Box>
            <Text color={Colors.Foreground} wrap="wrap">
              {visualResultDisplay as string}
            </Text>
          </Box>
        </MaxSizedBox>
      )}
      {!isAnsiOutput && typeof resultDisplay !== 'string' && (
        <Box flexDirection="column">
          {'fileDiff' in resultDisplay && (
            <>
              {(() => {
                const astValidation = (
                  resultDisplay as { metadata?: Record<string, unknown> }
                ).metadata?.astValidation as
                  | { valid: boolean; errors: string[] }
                  | undefined;
                if (!astValidation) return null;

                return (
                  <Box marginBottom={1}>
                    {astValidation.valid ? (
                      <Text color={Colors.AccentGreen}>
                        AST Validation Passed
                      </Text>
                    ) : (
                      <Box flexDirection="column">
                        <Text color={Colors.AccentRed} bold>
                          AST Validation Failed
                        </Text>
                        {astValidation.errors.map(
                          (err: string, i: number) => (
                            <Text key={i} color={Colors.AccentRed}>
                              - {err}
                            </Text>
                          ),
                        )}
                      </Box>
                    )}
                  </Box>
                );
              })()}
              <DiffRenderer
                diffContent={
                  (resultDisplay as unknown as { fileDiff: string }).fileDiff
                }
                filename={
                  (resultDisplay as unknown as { fileName: string }).fileName
                }
                availableTerminalHeight={availableHeight}
                terminalWidth={childWidth}
              />
            </>
          )}
          {'content' in resultDisplay && (
            <Box flexDirection="column">
              <Box marginBottom={1} flexDirection="column">
                {(() => {
                  const metadata = (
                    resultDisplay as { metadata?: Record<string, unknown> }
                  ).metadata;
                  const language = metadata?.language;
                  const declarationsCount = metadata?.declarationsCount;
                  return (
                    <>
                      {typeof language === 'string' && (
                        <Text color={Colors.AccentGreen}>
                          Language: {language}
                        </Text>
                      )}
                      {typeof declarationsCount === 'number' && (
                        <Text color={Colors.AccentGreen}>
                          Declarations Found: {declarationsCount}
                        </Text>
                      )}
                    </>
                  );
                })()}
              </Box>
              <MarkdownDisplay
                text={(resultDisplay as { content: string }).content}
                isPending={false}
                availableTerminalHeight={availableHeight}
                terminalWidth={childWidth}
                renderMarkdown={renderMarkdown}
              />
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};
