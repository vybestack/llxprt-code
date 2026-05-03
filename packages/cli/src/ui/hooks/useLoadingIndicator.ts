/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { StreamingState } from '../types.js';
import { useTimer } from './useTimer.js';
import { usePhraseCycler } from './usePhraseCycler.js';
import { type WittyPhraseStyle } from '../constants/phrasesCollections.js';
import { useState, useEffect, useRef } from 'react'; // Added useRef

export const useLoadingIndicator = (
  streamingState: StreamingState,
  wittyPhraseStyle: WittyPhraseStyle = 'default',
  customWittyPhrases?: string[],
  isInteractiveShellWaiting: boolean = false,
  lastOutputTime: number = 0,
) => {
  const [timerResetKey, setTimerResetKey] = useState(0);
  const isTimerActive = streamingState === StreamingState.Responding;

  const elapsedTimeFromTimer = useTimer(isTimerActive, timerResetKey);

  const isPhraseCyclingActive = streamingState === StreamingState.Responding;
  const isWaiting = streamingState === StreamingState.WaitingForConfirmation;
  const currentLoadingPhrase = usePhraseCycler(
    isPhraseCyclingActive,
    isWaiting,
    wittyPhraseStyle,
    isInteractiveShellWaiting,
    lastOutputTime,
    customWittyPhrases,
  );

  const [retainedElapsedTime, setRetainedElapsedTime] = useState(0);
  const prevStreamingStateRef = useRef<StreamingState | null>(null);

  useEffect(() => {
    const prevState = prevStreamingStateRef.current;

    // Timer reset needed when transitioning from states with accumulated time
    const needsTimerReset =
      (prevState === StreamingState.WaitingForConfirmation &&
        streamingState === StreamingState.Responding) ||
      (streamingState === StreamingState.Idle &&
        prevState === StreamingState.Responding);

    if (needsTimerReset) {
      setTimerResetKey((prevKey) => prevKey + 1);
      setRetainedElapsedTime(0);
    } else if (streamingState === StreamingState.WaitingForConfirmation) {
      // Capture the time when entering WaitingForConfirmation
      // elapsedTimeFromTimer will hold the last value from when isTimerActive was true.
      setRetainedElapsedTime(elapsedTimeFromTimer);
    }

    prevStreamingStateRef.current = streamingState;
  }, [streamingState, elapsedTimeFromTimer]);

  return {
    elapsedTime:
      streamingState === StreamingState.WaitingForConfirmation
        ? retainedElapsedTime
        : elapsedTimeFromTimer,
    currentLoadingPhrase,
  };
};
