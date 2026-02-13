/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  getPhraseCollection,
  type WittyPhraseStyle,
} from '../constants/phrasesCollections.js';
import { useInactivityTimer } from './useInactivityTimer.js';
import { SHELL_FOCUS_HINT_DELAY_MS } from '../constants.js';

export const PHRASE_CHANGE_INTERVAL_MS = 15000; // 15 seconds between phrase changes

export const INTERACTIVE_SHELL_WAITING_PHRASE =
  'Interactive shell awaiting input... press Ctrl+f to focus shell';

/**
 * Custom hook to manage cycling through loading phrases.
 * @param isActive Whether the phrase cycling should be active.
 * @param isWaiting Whether to show a specific waiting phrase.
 * @param style The witty phrase style setting.
 * @param isInteractiveShellWaiting Whether an interactive shell is waiting for input.
 * @param lastOutputTime Timestamp of the last output from tools/shell.
 * @param customPhrases Optional user-defined custom phrases.
 * @returns The current loading phrase.
 */
export const usePhraseCycler = (
  isActive: boolean,
  isWaiting: boolean,
  style: WittyPhraseStyle = 'default',
  isInteractiveShellWaiting: boolean = false,
  lastOutputTime: number = 0,
  customPhrases?: string[],
) => {
  const loadingPhrases = useMemo(
    () => getPhraseCollection(style, customPhrases),
    [style, customPhrases],
  );

  const [currentLoadingPhrase, setCurrentLoadingPhrase] = useState(
    loadingPhrases[0],
  );
  const phraseIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const showShellFocusHint = useInactivityTimer(
    isInteractiveShellWaiting,
    lastOutputTime,
    SHELL_FOCUS_HINT_DELAY_MS,
  );

  useEffect(() => {
    if (showShellFocusHint) {
      setCurrentLoadingPhrase(INTERACTIVE_SHELL_WAITING_PHRASE);
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
        phraseIntervalRef.current = null;
      }
      return;
    }

    if (isWaiting) {
      setCurrentLoadingPhrase('Waiting for user confirmation...');
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
        phraseIntervalRef.current = null;
      }
    } else if (isActive) {
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
      }
      // Select an initial random phrase
      const initialRandomIndex = Math.floor(
        Math.random() * loadingPhrases.length,
      );
      setCurrentLoadingPhrase(loadingPhrases[initialRandomIndex]);

      phraseIntervalRef.current = setInterval(() => {
        // Select a new random phrase
        const randomIndex = Math.floor(Math.random() * loadingPhrases.length);
        setCurrentLoadingPhrase(loadingPhrases[randomIndex]);
      }, PHRASE_CHANGE_INTERVAL_MS);
    } else {
      // Idle or other states, clear the phrase interval
      // and reset to the first phrase for next active state.
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
        phraseIntervalRef.current = null;
      }
      setCurrentLoadingPhrase(loadingPhrases[0]);
    }

    return () => {
      if (phraseIntervalRef.current) {
        clearInterval(phraseIntervalRef.current);
        phraseIntervalRef.current = null;
      }
    };
  }, [isActive, isWaiting, loadingPhrases, showShellFocusHint]);

  return currentLoadingPhrase;
};
