/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { useOverflowState } from '../contexts/OverflowContext.js';
import { useStreamingContext } from '../contexts/StreamingContext.js';
import { StreamingState } from '../types.js';
import { Colors } from '../colors.js';

interface ShowMoreLinesProps {
  constrainHeight: boolean;
}

export const ShowMoreLines = ({ constrainHeight }: ShowMoreLinesProps) => {
  const overflowState = useOverflowState();
  const streamingState = useStreamingContext();

  const hasOverflow =
    overflowState !== undefined && overflowState.overflowingIds.size > 0;
  const isIdleState =
    streamingState === StreamingState.Idle ||
    streamingState === StreamingState.WaitingForConfirmation;

  if (!hasOverflow || !constrainHeight || !isIdleState) {
    return null;
  }

  return (
    <Box>
      <Text color={Colors.Gray} wrap="truncate">
        Press ctrl-s to show more lines
      </Text>
    </Box>
  );
};
