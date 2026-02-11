/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ThoughtSummary } from '@vybestack/llxprt-code-core';
import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { useStreamingContext } from '../contexts/StreamingContext.js';
import { StreamingState } from '../types.js';
import { GeminiRespondingSpinner } from './GeminiRespondingSpinner.js';
import { formatDuration } from '../utils/formatters.js';
import { INTERACTIVE_SHELL_WAITING_PHRASE } from '../hooks/usePhraseCycler.js';

interface LoadingIndicatorProps {
  currentLoadingPhrase?: string;
  elapsedTime: number;
  rightContent?: React.ReactNode;
  thought?: ThoughtSummary | null;
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  currentLoadingPhrase,
  elapsedTime,
  rightContent,
  thought,
}) => {
  const streamingState = useStreamingContext();

  if (streamingState === StreamingState.Idle) {
    return null;
  }

  const isShellFocusHint =
    currentLoadingPhrase === INTERACTIVE_SHELL_WAITING_PHRASE;
  const primaryText = isShellFocusHint
    ? currentLoadingPhrase
    : thought?.subject || currentLoadingPhrase;

  const timerText =
    streamingState === StreamingState.WaitingForConfirmation
      ? ''
      : ` (esc to cancel, ${
          elapsedTime < 60
            ? `${elapsedTime}s`
            : formatDuration(elapsedTime * 1000)
        })`;

  const lineText = primaryText
    ? `${primaryText}${timerText}`
    : timerText.trimStart();

  return (
    <Box marginTop={1} paddingLeft={0} flexDirection="column">
      {/* Main loading line */}
      <Box width="100%" flexDirection="row">
        <Box marginRight={1}>
          <GeminiRespondingSpinner
            nonRespondingDisplay={
              streamingState === StreamingState.WaitingForConfirmation
                ? '⠏'
                : ''
            }
          />
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          {lineText && (
            <Text
              color={Colors.AccentPurple}
              wrap={timerText ? 'truncate-middle' : 'truncate-end'}
            >
              {lineText}
            </Text>
          )}
        </Box>
        {rightContent && (
          <Box marginLeft={1} flexShrink={0}>
            {rightContent}
          </Box>
        )}
      </Box>
    </Box>
  );
};
