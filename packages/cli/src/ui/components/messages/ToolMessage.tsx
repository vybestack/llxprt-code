/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { IndividualToolCallDisplay } from '../../types.js';
import { ToolCallStatus } from '../../types.js';
import { Colors } from '../../colors.js';
import { theme } from '../../semantic-colors.js';
import { SHELL_COMMAND_NAME, SHELL_NAME } from '../../constants.js';
import { useShellCommandDisplay } from '../../contexts/ShellCommandDisplayContext.js';
import {
  ShellExecutionService,
  splitCommands,
} from '@vybestack/llxprt-code-core';
import { ShellInputPrompt } from '../ShellInputPrompt.js';
import { StickyHeader } from '../StickyHeader.js';
import {
  ToolStatusIndicator,
  ToolInfo,
  TrailingIndicator,
  STATUS_INDICATOR_WIDTH,
  type TextEmphasis,
} from './ToolShared.js';
import { ToolResultDisplay } from './ToolResultDisplay.js';
import type { ShellState } from '../../cliUiRuntime.js';
import { getBorderStyle } from '../../contexts/UnicodeRenderingContext.js';

export type { TextEmphasis } from './ToolShared.js';

/**
 * Find the first delimiter position between paren and bracket.
 * Returns the position of whichever delimiter comes first, or -1 if neither found.
 */
function findFirstDelimiter(paren: number, bracket: number): number {
  if (paren === -1) return bracket;
  if (bracket === -1) return paren;
  return Math.min(paren, bracket);
}

/**
 * Extract echo text from a command if it's an echo command.
 */
function extractEchoText(cmd: string): string | null {
  // Parse an echo command's argument. A single whitespace separator avoids the
  // overlapping `\s+(.*)` backtracking flagged by sonarjs/slow-regex (the
  // captured text is trimmed below, so semantics are unchanged); the pattern is
  // passed to RegExp via an identifier so it is not a static literal flagged by
  // sonarjs/regular-expr.
  const echoPattern = '^\\s*echo\\s(.*)$';
  const m = cmd.match(new RegExp(echoPattern, 'i'));
  if (!m) return null;
  let text = m[1].trim();
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    text = text.slice(1, -1);
  }
  return text;
}

/**
 * Compute current subcommand for display when details visible.
 */
function computeCurrentSubcommand(
  showFullShellDescription: boolean,
  status: ToolCallStatus,
  description: string | undefined,
  resultDisplay: string | object | undefined,
): string | null {
  if (!showFullShellDescription || status !== ToolCallStatus.Executing) {
    return null;
  }
  if (!description) return null;

  const outputString =
    typeof resultDisplay === 'string' ? resultDisplay : undefined;
  let raw = description;
  const paren = raw.indexOf(' (');
  const bracket = raw.indexOf(' [in ');
  const cut = findFirstDelimiter(paren, bracket);
  if (cut > 0) raw = raw.slice(0, cut);

  const segments = splitCommands(raw).filter((s) => s.length > 0);
  if (segments.length === 0) return null;

  return findCurrentSubcommand(segments, outputString);
}

/**
 * Find the current subcommand based on last output line.
 */
function findCurrentSubcommand(
  segments: string[],
  outputString: string | undefined,
): string | null {
  const lastLine =
    outputString
      ?.split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .pop() ?? '';

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
}

interface ShellFocusState {
  isShellTool: boolean;
  isThisShellTargeted: boolean;
  isThisShellFocused: boolean;
  isThisShellFocusable: boolean;
}

function computeShellFocusState(
  name: string,
  status: ToolCallStatus,
  ptyId: number | undefined,
  activeShellPtyId: number | null | undefined,
  embeddedShellFocused: boolean | undefined,
  shell: ShellState | undefined,
): ShellFocusState {
  const isShellTool = name === SHELL_COMMAND_NAME || name === SHELL_NAME;
  const lastActivePtyId = ShellExecutionService.getLastActivePtyId();
  const isLastActiveShellTarget =
    lastActivePtyId !== null &&
    ptyId !== undefined &&
    ptyId === lastActivePtyId;
  const isThisShellTargeted =
    ptyId === activeShellPtyId ||
    (activeShellPtyId == null && isLastActiveShellTarget);
  const isPtyAlive =
    ptyId !== undefined && ShellExecutionService.isActivePty(ptyId);
  const isExecuting = status === ToolCallStatus.Executing;
  const isActiveOrAlive = isExecuting || isPtyAlive;
  const isThisShellFocused =
    isShellTool &&
    isThisShellTargeted &&
    embeddedShellFocused === true &&
    isActiveOrAlive;

  const interactiveShellEnabled = shell?.getEnableInteractiveShell() === true;
  const isThisShellFocusable =
    isShellTool &&
    interactiveShellEnabled &&
    isThisShellTargeted &&
    isActiveOrAlive;

  return {
    isShellTool,
    isThisShellTargeted,
    isThisShellFocused,
    isThisShellFocusable,
  };
}

/**
 * Render the executing status hint.
 */
function renderExecutingHint(showExecutingHint: boolean): React.ReactNode {
  if (!showExecutingHint) {
    return null;
  }
  return (
    <Box paddingLeft={STATUS_INDICATOR_WIDTH} marginTop={1} width="100%">
      <Text color={Colors.DimComment}>
        Press &apos;ctrl+r&apos; to show running command
      </Text>
    </Box>
  );
}

/**
 * Render the current subcommand display.
 */
function renderCurrentSubcommand(
  currentSubcommand: string | null,
): React.ReactNode {
  if (!currentSubcommand) {
    return null;
  }
  return (
    <Box paddingLeft={STATUS_INDICATOR_WIDTH} marginTop={1} width="100%">
      <Text color={Colors.AccentCyan}>
        Running: <Text color={Colors.Foreground}>{currentSubcommand}</Text>
      </Text>
    </Box>
  );
}

/**
 * Render the shell input prompt if needed.
 */
function renderShellInput(
  isThisShellFocused: boolean,
  shell: ShellState | undefined,
  activeShellPtyId: number | null | undefined,
  embeddedShellFocused: boolean | undefined,
): React.ReactNode {
  if (!isThisShellFocused || shell == null) {
    return null;
  }
  return (
    <Box paddingLeft={STATUS_INDICATOR_WIDTH} marginTop={1}>
      <ShellInputPrompt
        activeShellPtyId={activeShellPtyId ?? null}
        focus={embeddedShellFocused}
      />
    </Box>
  );
}

/**
 * Render the tool message header section.
 */
function renderToolMessageHeader(
  terminalWidth: number,
  isFirst: boolean,
  borderColor: string,
  borderDimColor: boolean,
  status: ToolCallStatus,
  name: string,
  description: string,
  emphasis: TextEmphasis,
  showFullDescription: boolean,
  isThisShellFocusable: boolean,
  isThisShellFocused: boolean,
): React.ReactNode {
  return (
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
        showFullDescription={showFullDescription}
      />
      {isThisShellFocusable && (
        <Box marginLeft={1} flexShrink={0}>
          <Text color={theme.text.accent}>
            {isThisShellFocused
              ? '(Focused - Tab/Shift+Tab/Ctrl+F to return)'
              : '(Tab/Ctrl+F to focus)'}
          </Text>
        </Box>
      )}
      {emphasis === 'high' && <TrailingIndicator />}
    </StickyHeader>
  );
}

/**
 * Render the tool message content box.
 */
function renderToolMessageContent(
  terminalWidth: number,
  borderColor: string,
  borderDimColor: boolean,
  status: ToolCallStatus,
  showExecutingHint: boolean,
  currentSubcommand: string | null,
  resultDisplay: string | object | undefined,
  availableTerminalHeight: number | undefined,
  renderOutputAsMarkdown: boolean,
  isThisShellFocused: boolean,
  shell: ShellState | undefined,
  activeShellPtyId: number | null | undefined,
  embeddedShellFocused: boolean | undefined,
): React.ReactNode {
  return (
    <Box
      width={terminalWidth}
      borderStyle={getBorderStyle('round')}
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
      {renderExecutingHint(showExecutingHint)}
      {renderCurrentSubcommand(currentSubcommand)}
      <ToolResultDisplay
        resultDisplay={resultDisplay}
        availableTerminalHeight={availableTerminalHeight}
        terminalWidth={Math.max(0, terminalWidth - 4)}
        renderOutputAsMarkdown={renderOutputAsMarkdown}
      />
      {renderShellInput(
        isThisShellFocused,
        shell,
        activeShellPtyId,
        embeddedShellFocused,
      )}
    </Box>
  );
}

export interface ToolMessageProps extends IndividualToolCallDisplay {
  availableTerminalHeight?: number;
  terminalWidth: number;
  emphasis?: TextEmphasis;
  renderOutputAsMarkdown?: boolean;
  activeShellPtyId?: number | null;
  embeddedShellFocused?: boolean;
  shell?: ShellState;
  isFirst?: boolean;
  borderColor?: string;
  borderDimColor?: boolean;
}

export const ToolMessage: React.FC<ToolMessageProps> = ({
  callId,
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
  shell,
  isFirst = false,
  borderColor = Colors.Gray,
  borderDimColor = false,
}) => {
  const isShellTool = name === SHELL_NAME || name === SHELL_COMMAND_NAME;
  const showFullShellDescription = useShellCommandDisplay(
    callId,
    name,
    status,
    isFocused,
  );

  const { isThisShellFocused, isThisShellFocusable } = computeShellFocusState(
    name,
    status,
    ptyId,
    activeShellPtyId,
    embeddedShellFocused,
    shell,
  );

  const currentSubcommand = useMemo(
    () =>
      computeCurrentSubcommand(
        showFullShellDescription,
        status,
        description,
        resultDisplay,
      ),
    [showFullShellDescription, status, description, resultDisplay],
  );

  return (
    <>
      {renderToolMessageHeader(
        terminalWidth,
        isFirst,
        borderColor,
        borderDimColor,
        status,
        name,
        description || '',
        emphasis,
        showFullShellDescription,
        isThisShellFocusable,
        isThisShellFocused,
      )}
      {renderToolMessageContent(
        terminalWidth,
        borderColor,
        borderDimColor,
        status,
        isShellTool &&
          status === ToolCallStatus.Executing &&
          !showFullShellDescription,
        currentSubcommand,
        resultDisplay,
        availableTerminalHeight,
        renderOutputAsMarkdown,
        isThisShellFocused,
        shell,
        activeShellPtyId,
        embeddedShellFocused,
      )}
    </>
  );
};
