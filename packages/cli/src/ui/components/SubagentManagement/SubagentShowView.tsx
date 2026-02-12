/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import {
  type Direction,
  logicalPosToOffset,
  useTextBuffer,
} from '../shared/text-buffer.js';
import { Colors } from '../../colors.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import type { SubagentInfo } from './types.js';

interface SubagentShowViewProps {
  subagent: SubagentInfo;
  onEdit: () => void;
  onBack: () => void;
  isFocused?: boolean;
}

export const SubagentShowView: React.FC<SubagentShowViewProps> = ({
  subagent,
  onEdit,
  onBack,
  isFocused = true,
}) => {
  const { rows: terminalRows, columns: terminalColumns } = useTerminalSize();

  // Keep this conservative so the whole view fits with dialog chrome.
  const NON_PROMPT_HEIGHT = 14;
  const promptViewportHeight = Math.max(
    4,
    Math.min(12, terminalRows - NON_PROMPT_HEIGHT),
  );
  const promptViewportWidth = Math.max(20, terminalColumns - 24);
  const pageJump = Math.max(3, Math.floor(promptViewportHeight * 0.75));

  const promptBuffer = useTextBuffer({
    initialText: subagent.systemPrompt,
    viewport: { width: promptViewportWidth, height: promptViewportHeight },
    isValidPath: () => false,
  });

  const { setText, moveToOffset, move } = promptBuffer;

  useEffect(() => {
    setText(subagent.systemPrompt);
    moveToOffset(0);
  }, [setText, moveToOffset, subagent.name, subagent.systemPrompt]);

  const movePrompt = useCallback(
    (dir: Direction, amount: number) => {
      const lineCount = Math.max(1, Math.floor(amount));

      if (lineCount === 1 || (dir !== 'up' && dir !== 'down')) {
        move(dir);
        return;
      }

      if (promptBuffer.allVisualLines.length === 0) {
        return;
      }

      const [currentVisualRow, currentVisualCol] = promptBuffer.visualCursor;
      const targetVisualRow =
        dir === 'down'
          ? Math.min(
              promptBuffer.allVisualLines.length - 1,
              currentVisualRow + lineCount,
            )
          : Math.max(0, currentVisualRow - lineCount);

      const targetVisualMap = promptBuffer.visualToLogicalMap[targetVisualRow];
      if (!targetVisualMap) {
        return;
      }

      const [targetLogicalRow, targetLogicalStartCol] = targetVisualMap;
      const targetVisualLine =
        promptBuffer.allVisualLines[targetVisualRow] ?? '';
      const targetVisualLineLength = Array.from(targetVisualLine).length;
      const targetLogicalCol =
        targetLogicalStartCol +
        Math.min(currentVisualCol, targetVisualLineLength);

      moveToOffset(
        logicalPosToOffset(
          promptBuffer.lines,
          targetLogicalRow,
          targetLogicalCol,
        ),
      );
    },
    [
      move,
      moveToOffset,
      promptBuffer.allVisualLines,
      promptBuffer.lines,
      promptBuffer.visualCursor,
      promptBuffer.visualToLogicalMap,
    ],
  );

  useKeypress(
    (key) => {
      if (key.name === 'escape') {
        onBack();
        return;
      }

      if (key.sequence === 'e') {
        onEdit();
        return;
      }

      const isUp = key.name === 'up' || key.sequence === 'k';
      const isDown = key.name === 'down' || key.sequence === 'j';

      if (isUp) {
        movePrompt('up', 1);
        return;
      }

      if (isDown) {
        movePrompt('down', 1);
        return;
      }

      if (key.name === 'pageup') {
        movePrompt('up', pageJump);
        return;
      }

      if (key.name === 'pagedown') {
        movePrompt('down', pageJump);
        return;
      }

      if (key.name === 'home' || key.sequence === 'g') {
        moveToOffset(0);
        return;
      }

      if (key.name === 'end' || key.sequence === 'G') {
        moveToOffset(promptBuffer.text.length);
      }
    },
    { isActive: isFocused },
  );

  const visibleLines = promptBuffer.viewportVisualLines;
  const totalVisualLines = promptBuffer.allVisualLines.length;
  const startLine = totalVisualLines > 0 ? promptBuffer.visualScrollRow + 1 : 0;
  const endLine =
    totalVisualLines > 0
      ? Math.min(startLine + visibleLines.length - 1, totalVisualLines)
      : 0;

  const profileDetails = useMemo(() => {
    const parts = [subagent.profile];
    if (subagent.profileInfo?.model) {
      parts.push(subagent.profileInfo.model);
    }
    return parts.join(' • ');
  }, [subagent.profile, subagent.profileInfo?.model]);

  return (
    <Box flexDirection="column">
      <Text bold color={Colors.Foreground}>
        {subagent.name}
      </Text>
      <Text color={Colors.Gray}>Profile: {profileDetails}</Text>

      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          System Prompt (lines {startLine}-{endLine} of {totalVisualLines})
        </Text>
      </Box>

      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={Colors.Gray}
        paddingX={1}
        height={promptViewportHeight + 2}
        overflow="hidden"
      >
        {visibleLines.length > 0 ? (
          visibleLines.map((line, idx) => (
            <Text key={idx} color={Colors.Foreground} wrap="truncate-end">
              {line || ' '}
            </Text>
          ))
        ) : (
          <Text color={Colors.Foreground}> </Text>
        )}
      </Box>

      <Box marginTop={1}>
        <Text color={Colors.Gray}>
          [↑↓/j/k] Scroll [PgUp/PgDn] Jump [Home/End] [e] Edit [ESC] Back
        </Text>
      </Box>
    </Box>
  );
};
