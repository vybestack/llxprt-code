/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text, Box } from 'ink';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { Colors } from '../../colors.js';
import { SCREEN_READER_MODEL_PREFIX } from '../../textConstants.js';
import { ThinkingBlockDisplay } from './ThinkingBlockDisplay.js';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';
import { useRuntimeApi } from '../../contexts/RuntimeContext.js';
import { useUIState } from '../../contexts/UIStateContext.js';

interface GeminiMessageProps {
  text: string;
  isPending: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
  model?: string;
  thinkingBlocks?: ThinkingBlock[]; // @plan:PLAN-20251202-THINKING-UI.P06
}

export const GeminiMessage: React.FC<GeminiMessageProps> = ({
  text,
  isPending,
  availableTerminalHeight,
  terminalWidth,
  model,
  thinkingBlocks,
}) => {
  /**
   * @plan:PLAN-20251202-THINKING-UI.P06
   * @requirement:REQ-THINK-UI-001
   * @requirement:REQ-THINK-UI-003
   */
  const { getEphemeralSetting } = useRuntimeApi();
  const showThinking = (getEphemeralSetting('reasoning.includeInResponse') ??
    true) as boolean;
  const { renderMarkdown } = useUIState();

  const prefix = ' ';
  const prefixWidth = prefix.length;

  // Don't show thinkingBlocks in pending items - LoadingIndicator shows the
  // thought subject/description as spinner text during streaming. Only show
  // thinkingBlocks in committed history items to avoid duplication (fixes #922).
  const shouldShowThinkingBlocks = showThinking && !isPending;

  return (
    <Box flexDirection="column">
      {model && (
        <Box marginBottom={0}>
          <Text color={Colors.DimComment}>{model}</Text>
        </Box>
      )}
      {shouldShowThinkingBlocks &&
        thinkingBlocks?.map((block, index) => (
          <ThinkingBlockDisplay
            key={`thinking-${index}`}
            block={block}
            visible={true}
          />
        ))}
      <Box flexDirection="row">
        <Box width={prefixWidth}>
          <Text
            color={Colors.AccentPurple}
            aria-label={SCREEN_READER_MODEL_PREFIX}
          >
            {prefix}
          </Text>
        </Box>
        <Box flexGrow={1} flexDirection="column">
          <MarkdownDisplay
            text={text}
            isPending={isPending}
            availableTerminalHeight={availableTerminalHeight}
            terminalWidth={terminalWidth}
            renderMarkdown={renderMarkdown}
          />
        </Box>
      </Box>
    </Box>
  );
};
