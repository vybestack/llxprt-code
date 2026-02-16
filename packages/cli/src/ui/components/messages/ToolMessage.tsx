/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState } from 'react';
import { Box, Text } from 'ink';
import { IndividualToolCallDisplay, ToolCallStatus } from '../../types.js';
import { Colors } from '../../colors.js';
import { SHELL_COMMAND_NAME, SHELL_NAME } from '../../constants.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import {
  ShellExecutionService,
  type Config,
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

export type { TextEmphasis } from './ToolShared.js';

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

  // Derive current subcommand for display when details visible
  const currentSubcommand = useMemo((): string | null => {
    if (!isDetailsVisible || status !== ToolCallStatus.Executing) return null;
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
  }, [isDetailsVisible, status, description, resultDisplay]);

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
        <ToolResultDisplay
          resultDisplay={resultDisplay}
          availableTerminalHeight={availableTerminalHeight}
          terminalWidth={Math.max(0, terminalWidth - 4)}
          renderOutputAsMarkdown={renderOutputAsMarkdown}
        />
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
