/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
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

const mergeThinkingBlocks = (
  blocks: ThinkingBlock[] | undefined,
): ThinkingBlock | null => {
  if (!blocks || blocks.length === 0) {
    return null;
  }
  const visibleBlocks = blocks.filter(
    (block) => !block.isHidden && block.thought.length > 0,
  );
  if (visibleBlocks.length === 0) {
    return null;
  }
  const thought = visibleBlocks.map((block) => block.thought).join('');
  if (!thought.trim()) {
    return null;
  }
  return { ...visibleBlocks[0], thought };
};

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

  // Show thinkingBlocks during streaming (isPending=true) so thinking content
  // streams to the UI as it arrives, not just after the response completes.
  // Issue #1272: Previously thinking was hidden during streaming, only showing
  // the subject in LoadingIndicator. Now we show the full thinking content.
  const shouldShowThinkingBlocks = showThinking;
  const mergedThinkingBlock = useMemo(
    () => mergeThinkingBlocks(thinkingBlocks),
    [thinkingBlocks],
  );

  return (
    <Box flexDirection="column">
      {model && (
        <Box marginBottom={0}>
          <Text color={Colors.DimComment}>{model}</Text>
        </Box>
      )}
      {shouldShowThinkingBlocks && mergedThinkingBlock && (
        <ThinkingBlockDisplay block={mergedThinkingBlock} visible={true} />
      )}
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
