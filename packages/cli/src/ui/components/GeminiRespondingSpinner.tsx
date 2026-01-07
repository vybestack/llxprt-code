/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text, useIsScreenReaderEnabled } from 'ink';
import Spinner from 'ink-spinner';
import type { SpinnerName } from 'cli-spinners';
import { useStreamingContext } from '../contexts/StreamingContext.js';
import { StreamingState } from '../types.js';
import { Colors } from '../colors.js';
import {
  SCREEN_READER_LOADING,
  SCREEN_READER_RESPONDING,
} from '../textConstants.js';

interface GeminiRespondingSpinnerProps {
  /**
   * Optional string to display when not in Responding state.
   * If not provided and not Responding, renders null.
   */
  nonRespondingDisplay?: string;
  spinnerType?: SpinnerName;
}

export const GeminiRespondingSpinner: React.FC<
  GeminiRespondingSpinnerProps
> = ({ nonRespondingDisplay, spinnerType = 'dots' }) => {
  const streamingState = useStreamingContext();
  const isScreenReaderEnabled = useIsScreenReaderEnabled();
  if (streamingState === StreamingState.Responding) {
    return isScreenReaderEnabled ? (
      <Text color={Colors.Foreground}>{SCREEN_READER_RESPONDING}</Text>
    ) : (
      <Spinner type={spinnerType} />
    );
  } else if (nonRespondingDisplay) {
    return isScreenReaderEnabled ? (
      <Text color={Colors.Foreground}>{SCREEN_READER_LOADING}</Text>
    ) : (
      <Text color={Colors.Foreground}>{nonRespondingDisplay}</Text>
    );
  }
  return null;
};
