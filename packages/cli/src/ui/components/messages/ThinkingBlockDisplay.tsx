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
 * Displays a ThinkingBlock with italic text and shaded background.
 * Visibility controlled by reasoning.includeInResponse setting.
 *
 * Visual style:
 * - Italic text
 * - Slightly shaded background (theme-aware gray)
 * - Small margin for separation from other content
 *
 * @plan:PLAN-20251202-THINKING-UI.P05
 * @requirement:REQ-THINK-UI-002 - Visual styling
 * @requirement:REQ-THINK-UI-003 - Visibility toggle
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

  return (
    <Box flexDirection="column" marginTop={0} marginBottom={1} paddingX={1}>
      <Text italic color={Colors.DimComment}>
        {block.thought}
      </Text>
    </Box>
  );
};
