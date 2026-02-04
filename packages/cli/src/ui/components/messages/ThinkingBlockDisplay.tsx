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
 * @issue #1272 - Proper markdown rendering with dim comment color
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';
import { Colors } from '../../colors.js';

export interface ThinkingBlockDisplayProps {
  /** The ThinkingBlock to display */
  block: ThinkingBlock;
  /** Whether to display the block (controlled by reasoning.includeInResponse) */
  visible?: boolean;
}

/**
 * Displays a ThinkingBlock with italic text and dim comment color.
 * Visibility controlled by reasoning.includeInResponse setting.
 *
 * Visual style:
 * - Italic text
 * - Dim comment color (theme-aware, darker than regular response text)
 * - Small margin for separation from other content
 * - Preserves newlines from the thinking content
 *
 * @plan:PLAN-20251202-THINKING-UI.P05
 * @requirement:REQ-THINK-UI-002 - Visual styling
 * @requirement:REQ-THINK-UI-003 - Visibility toggle
 * @issue #1272 - Preserve newlines in thinking content
 */
export const ThinkingBlockDisplay: React.FC<ThinkingBlockDisplayProps> = ({
  block,
  visible = true,
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

  // Split by newlines and render each line separately to preserve formatting
  // This handles both \n and \r\n line endings
  const lines = block.thought.split(/\r?\n/);

  return (
    <Box flexDirection="column" marginTop={0} marginBottom={1} paddingX={1}>
      {lines.map((line, index) => (
        <Text key={index} italic color={Colors.DimComment} wrap="wrap">
          {line || ' '}
        </Text>
      ))}
    </Box>
  );
};
