/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ThinkingBlockDisplay - Renders a ThinkingBlock with distinct styling
 *
 * @plan:PLAN-20251202-THINKING-UI.P03
 * @plan:PLAN-20251202-THINKING-UI.P05
 * @requirement:REQ-THINK-UI-001 - ThinkingBlock type recognition
 * @requirement:REQ-THINK-UI-002 - Visual styling (italic, shaded background)
 * @requirement:REQ-THINK-UI-003 - Toggle via visible prop
 * @issue #1272 - Uses MarkdownDisplay for proper formatting of thinking content
 */

import React from 'react';
import { Box } from 'ink';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';

export interface ThinkingBlockDisplayProps {
  /** The ThinkingBlock to display */
  block: ThinkingBlock;
  /** Whether to display the block (controlled by reasoning.includeInResponse) */
  visible?: boolean;
  /** Whether the thinking block is still being streamed */
  isPending?: boolean;
  /** Available terminal height for rendering */
  availableTerminalHeight?: number;
  /** Terminal width for proper text wrapping */
  terminalWidth?: number;
}

/**
 * Displays a ThinkingBlock with markdown rendering.
 * Visibility controlled by reasoning.includeInResponse setting.
 *
 * Visual style:
 * - Slightly shaded background (theme-aware gray) via padding
 * - Small margin for separation from other content
 * - Markdown formatting for proper newlines, lists, code blocks
 *
 * @plan:PLAN-20251202-THINKING-UI.P05
 * @requirement:REQ-THINK-UI-002 - Visual styling
 * @requirement:REQ-THINK-UI-003 - Visibility toggle
 * @issue #1272 - Proper markdown rendering for streaming thinking content
 */
export const ThinkingBlockDisplay: React.FC<ThinkingBlockDisplayProps> = ({
  block,
  visible = true,
  isPending = false,
  availableTerminalHeight,
  terminalWidth = 80,
}) => {
  // @requirement REQ-THINK-UI-003 - Toggle via visible prop
  if (!visible) {
    return null;
  }

  // @requirement REQ-THINK-UI-002 - Visual styling
  // Empty thought handling - render nothing if thought is empty
  if (!block.thought || block.thought.trim() === '') {
    return <Box />;
  }

  return (
    <Box flexDirection="column" marginTop={0} marginBottom={1} paddingX={1}>
      <MarkdownDisplay
        text={block.thought}
        isPending={isPending}
        availableTerminalHeight={availableTerminalHeight}
        terminalWidth={terminalWidth - 2}
        renderMarkdown={true}
      />
    </Box>
  );
};
