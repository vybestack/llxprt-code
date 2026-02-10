/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { IndividualToolCallDisplay, ToolCallStatus } from '../../types.js';
import { DiffRenderer } from './DiffRenderer.js';
import { Colors } from '../../colors.js';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { GeminiRespondingSpinner } from '../GeminiRespondingSpinner.js';
import { MaxSizedBox } from '../shared/MaxSizedBox.js';
import {
  SHELL_COMMAND_NAME,
  SHELL_NAME,
  TOOL_STATUS,
} from '../../constants.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import {
  stripShellMarkers,
  ShellExecutionService,
  type Config,
  type AnsiOutput,
} from '@vybestack/llxprt-code-core';
import { useUIState } from '../../contexts/UIStateContext.js';
import { AnsiOutputText } from '../AnsiOutput.js';
import { ShellInputPrompt } from '../ShellInputPrompt.js';
import { StickyHeader } from '../StickyHeader.js';

const STATIC_HEIGHT = 1;
const RESERVED_LINE_COUNT = 5; // for tool name, status, padding etc.
const STATUS_INDICATOR_WIDTH = 3;
const MIN_LINES_SHOWN = 2; // show at least this many lines

// Large threshold to ensure we don't cause performance issues for very large
// outputs that will get truncated further MaxSizedBox anyway.
const MAXIMUM_RESULT_DISPLAY_CHARACTERS = 1000000;
export type TextEmphasis = 'high' | 'medium' | 'low';

export interface ToolMessageProps extends IndividualToolCallDisplay {
  availableTerminalHeight?: number;
  terminalWidth: number;
  emphasis?: TextEmphasis;
  renderOutputAsMarkdown?: boolean;
  activeShellPtyId?: number | null;
  embeddedShellFocused?: boolean;
  config?: Config;
  isFirst?: boolean;
  borderColor?: string;
  borderDimColor?: boolean;
}

export const ToolMessage: React.FC<ToolMessageProps> = ({
  name,
  description,
  resultDisplay,
  status,
  availableTerminalHeight,
  terminalWidth,
  emphasis = 'medium',
  renderOutputAsMarkdown = true,
  isFocused = true,
  activeShellPtyId,
  embeddedShellFocused,
  ptyId,
  config,
  isFirst = false,
  borderColor = Colors.Gray,
  borderDimColor = false,
}) => {
  const { renderMarkdown } = useUIState();

  // Check if this shell is focused
  const isShellTool = name === SHELL_COMMAND_NAME || name === SHELL_NAME;
  // For LLM-invoked shells, activeShellPtyId is null but we can use lastActivePtyId
  const lastActivePtyId = ShellExecutionService.getLastActivePtyId();
  const isThisShellTargeted =
    ptyId === activeShellPtyId ||
    (activeShellPtyId == null && ptyId === lastActivePtyId);
  const isThisShellFocused =
    isShellTool &&
    status === ToolCallStatus.Executing &&
    isThisShellTargeted &&
    embeddedShellFocused;

  const isThisShellFocusable =
    isShellTool &&
    status === ToolCallStatus.Executing &&
    config?.getEnableInteractiveShell() &&
    isThisShellTargeted;
  const availableHeight = availableTerminalHeight
    ? Math.max(
        availableTerminalHeight - STATIC_HEIGHT - RESERVED_LINE_COUNT,
        MIN_LINES_SHOWN + 1, // enforce minimum lines shown
      )
    : undefined;

  // Long tool call response in MarkdownDisplay doesn't respect availableTerminalHeight properly,
  // we're forcing it to not render as markdown when the response is too long, it will fallback
  // to render as plain text, which is contained within the terminal using MaxSizedBox
  if (availableHeight) {
    renderOutputAsMarkdown = false;
  }

  const [isDetailsVisible, setIsDetailsVisible] = useState(false);

  useKeypress(
    (key) => {
      // Handle 'ctrl' + 'r' key for full-command toggle while executing
      if (key.ctrl && key.name === 'r') {
        if (status === ToolCallStatus.Executing) {
          setIsDetailsVisible((prev) => !prev);
        }
      }
    },
    { isActive: isFocused },
  );

  const childWidth = terminalWidth;
  if (typeof resultDisplay === 'string') {
    if (resultDisplay.length > MAXIMUM_RESULT_DISPLAY_CHARACTERS) {
      // Truncate the result display to fit within the available width.
      resultDisplay =
        '...' + resultDisplay.slice(-MAXIMUM_RESULT_DISPLAY_CHARACTERS);
    }
  }
  // Build a filtered version for visual rendering (hide runtime markers).
  const visualResultDisplay =
    typeof resultDisplay === 'string'
      ? stripShellMarkers(resultDisplay)
      : resultDisplay;
  // Prefer explicit runtime markers, fallback to best-effort inference for shell chains.
  const deriveCurrentSubcommand = (): string | null => {
    if (status !== ToolCallStatus.Executing) return null;
    if (!description) return null;
    const outputString =
      typeof resultDisplay === 'string' ? resultDisplay : undefined;
    if (outputString) {
      const lines = outputString
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i];
        const marker = '__LLXPRT_CMD__:';
        const idx = line.indexOf(marker);
        if (idx !== -1) {
          const seg = line.slice(idx + marker.length).trim();
          if (seg) return seg;
        }
      }
    }
    // Fallback: parse description if no explicit markers found.
    // Limitations: This heuristic assumes:
    // - Simple && chains (does not handle quoted strings, escaped delimiters, or other operators)
    // - Optional echo commands for progress tracking
    // - Standard metadata format in description (' [in dir]' and ' (desc...)')
    // May produce incorrect results for:
    // - Commands with parentheses or brackets in unexpected positions
    // - Non-echo-based command chains
    // - Multiple echo statements with the same text
    // - Complex shell syntax (if/for/while loops, functions, etc.)
    // Strip optional metadata appended by getDescription: ' [in dir]' and ' (desc...)'
    let raw = description;
    const paren = raw.indexOf(' (');
    const bracket = raw.indexOf(' [in ');
    const cut =
      paren === -1
        ? bracket
        : bracket === -1
          ? paren
          : Math.min(paren, bracket);
    if (cut > 0) raw = raw.slice(0, cut);

    const segments = raw
      .split('&&')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (segments.length === 0) return null;

    const lastLine =
      outputString
        ?.split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .pop() ?? '';

    const extractEchoText = (cmd: string): string | null => {
      const m = cmd.match(/^\s*echo\s+(.*)$/i);
      if (!m) return null;
      let text = m[1].trim();
      if (
        (text.startsWith('"') && text.endsWith('"')) ||
        (text.startsWith("'") && text.endsWith("'"))
      ) {
        text = text.slice(1, -1);
      }
      return text;
    };

    let idx = 0;
    if (lastLine) {
      for (let i = 0; i < segments.length; i++) {
        const t = extractEchoText(segments[i]);
        if (t && t === lastLine) {
          idx = Math.min(i + 1, segments.length - 1);
        }
      }
    }
    return segments[idx] ?? null;
  };

  const currentSubcommand =
    isDetailsVisible && status === ToolCallStatus.Executing
      ? deriveCurrentSubcommand()
      : null;

  // Check if resultDisplay is AnsiOutput (array of arrays)
  const isAnsiOutput =
    Array.isArray(resultDisplay) &&
    resultDisplay.length > 0 &&
    Array.isArray(resultDisplay[0]);

  return (
    <>
      <StickyHeader
        width={terminalWidth}
        isFirst={isFirst}
        borderColor={borderColor}
        borderDimColor={borderDimColor}
      >
        <ToolStatusIndicator status={status} name={name} />
        <ToolInfo
          name={name}
          status={status}
          description={description}
          emphasis={emphasis}
        />
        {isThisShellFocusable && (
          <Box marginLeft={1} flexShrink={0}>
            <Text color={Colors.AccentCyan}>
              {isThisShellFocused
                ? '(Ctrl+F to return to prompt)'
                : '(Ctrl+F to send keys to shell)'}
            </Text>
          </Box>
        )}
        {emphasis === 'high' && <TrailingIndicator />}
      </StickyHeader>
      <Box
        width={terminalWidth}
        borderStyle="round"
        borderColor={borderColor}
        borderDimColor={borderDimColor}
        borderTop={false}
        borderBottom={false}
        borderLeft={true}
        borderRight={true}
        paddingX={1}
        flexDirection="column"
        overflowX="hidden"
      >
        {status === ToolCallStatus.Executing && !isDetailsVisible && (
          <Box paddingLeft={STATUS_INDICATOR_WIDTH} marginTop={1} width="100%">
            <Text color={Colors.DimComment}>
              Press &apos;ctrl+r&apos; to show running command
            </Text>
          </Box>
        )}
        {currentSubcommand && (
          <Box paddingLeft={STATUS_INDICATOR_WIDTH} marginTop={1} width="100%">
            <Text color={Colors.AccentCyan}>
              Running:{' '}
              <Text color={Colors.Foreground}>{currentSubcommand}</Text>
            </Text>
          </Box>
        )}
        {resultDisplay && (
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
                      const astValidation = resultDisplay.metadata
                        ?.astValidation as
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
                      diffContent={resultDisplay.fileDiff}
                      filename={resultDisplay.fileName}
                      availableTerminalHeight={availableHeight}
                      terminalWidth={childWidth}
                    />
                  </>
                )}
                {'content' in resultDisplay && (
                  <Box flexDirection="column">
                    <Box marginBottom={1} flexDirection="column">
                      {(() => {
                        const language = resultDisplay.metadata?.language;
                        const declarationsCount =
                          resultDisplay.metadata?.declarationsCount;
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
                      text={resultDisplay.content}
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
        )}
        {isThisShellFocused && config && (
          <Box paddingLeft={STATUS_INDICATOR_WIDTH} marginTop={1}>
            <ShellInputPrompt
              activeShellPtyId={activeShellPtyId ?? null}
              focus={embeddedShellFocused ?? false}
            />
          </Box>
        )}
      </Box>
    </>
  );
};

type ToolStatusIndicatorProps = {
  status: ToolCallStatus;
  name: string;
};

const ToolStatusIndicator: React.FC<ToolStatusIndicatorProps> = ({
  status,
  name,
}) => {
  const isShell = name === SHELL_COMMAND_NAME || name === SHELL_NAME || false;
  const warningColor = isShell ? Colors.Foreground : Colors.AccentYellow;

  return (
    <Box minWidth={STATUS_INDICATOR_WIDTH}>
      {status === ToolCallStatus.Pending && (
        <Text color={Colors.AccentGreen}>{TOOL_STATUS.PENDING}</Text>
      )}
      {status === ToolCallStatus.Executing && (
        <GeminiRespondingSpinner
          spinnerType="toggle"
          nonRespondingDisplay={TOOL_STATUS.EXECUTING}
        />
      )}
      {status === ToolCallStatus.Success && (
        <Text color={Colors.AccentGreen} aria-label={'Success:'}>
          {TOOL_STATUS.SUCCESS}
        </Text>
      )}
      {status === ToolCallStatus.Confirming && (
        <Text color={warningColor} aria-label={'Confirming:'}>
          {TOOL_STATUS.CONFIRMING}
        </Text>
      )}
      {status === ToolCallStatus.Canceled && (
        <Text color={warningColor} aria-label={'Canceled:'} bold>
          {TOOL_STATUS.CANCELED}
        </Text>
      )}
      {status === ToolCallStatus.Error && (
        <Text color={Colors.AccentRed} aria-label={'Error:'} bold>
          {TOOL_STATUS.ERROR}
        </Text>
      )}
    </Box>
  );
};

type ToolInfo = {
  name: string;
  description: string;
  status: ToolCallStatus;
  emphasis: TextEmphasis;
  showFullDescription?: boolean;
};
const ToolInfo: React.FC<ToolInfo> = ({
  name,
  description,
  status,
  emphasis,
  showFullDescription = false,
}) => {
  const nameColor = React.useMemo<string>(() => {
    switch (emphasis) {
      case 'high':
        return Colors.Foreground;
      case 'medium':
        return Colors.Foreground;
      case 'low':
        return Colors.Gray;
      default: {
        const exhaustiveCheck: never = emphasis;
        return exhaustiveCheck;
      }
    }
  }, [emphasis]);
  return (
    <Box>
      <Text
        color={Colors.Foreground}
        wrap={showFullDescription ? 'wrap' : 'truncate-end'}
        strikethrough={status === ToolCallStatus.Canceled}
      >
        <Text color={nameColor} bold>
          {name}
        </Text>{' '}
        <Text color={Colors.Gray}>{description}</Text>
      </Text>
    </Box>
  );
};

const TrailingIndicator: React.FC = () => (
  <Text color={Colors.Foreground} wrap="truncate">
    {' '}
    ←
  </Text>
);
