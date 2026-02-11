/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useCompletion } from './useCompletion.js';
import { Suggestion } from '../components/SuggestionsDisplay.js';
import {
  TextBuffer,
  logicalPosToOffset,
} from '../components/shared/text-buffer.js';
import {
  extractPathToken,
  getPathSuggestions,
} from '@vybestack/llxprt-code-core';

const DEBOUNCE_MS = 100;

export interface UseShellPathCompletionReturn {
  readonly suggestions: Suggestion[];
  readonly activeSuggestionIndex: number;
  readonly visibleStartIndex: number;
  readonly showSuggestions: boolean;
  readonly isLoadingSuggestions: boolean;
  navigateUp: () => void;
  navigateDown: () => void;
  handleAutocomplete: (index: number) => void;
  resetCompletionState: () => void;
}

export function useShellPathCompletion(
  buffer: TextBuffer,
  cwd: string,
  shellModeActive: boolean,
  reverseSearchActive: boolean,
): UseShellPathCompletionReturn {
  const {
    suggestions,
    activeSuggestionIndex,
    visibleStartIndex,
    showSuggestions,
    isLoadingSuggestions,

    setSuggestions,
    setShowSuggestions,
    setActiveSuggestionIndex,
    setVisibleStartIndex,
    setIsLoadingSuggestions,

    resetCompletionState,
    navigateUp,
    navigateDown,
  } = useCompletion();

  const generationRef = useRef(0);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const cursorRow = buffer.cursor[0];
  const cursorCol = buffer.cursor[1];

  const pathToken = useMemo(() => {
    if (!shellModeActive || reverseSearchActive) {
      return null;
    }
    const currentLine = buffer.lines[cursorRow] || '';
    const extraction = extractPathToken(currentLine, cursorCol);
    if (!extraction.isPathLike || extraction.token.length === 0) {
      return null;
    }
    return extraction;
  }, [
    shellModeActive,
    reverseSearchActive,
    buffer.lines,
    cursorRow,
    cursorCol,
  ]);

  useEffect(() => {
    if (!shellModeActive || reverseSearchActive) {
      resetCompletionState();
      return;
    }
  }, [shellModeActive, reverseSearchActive, resetCompletionState]);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (!pathToken) {
      resetCompletionState();
      return;
    }

    const generation = ++generationRef.current;

    debounceTimerRef.current = setTimeout(() => {
      setIsLoadingSuggestions(true);
      getPathSuggestions(pathToken.token, cwd)
        .then((results) => {
          if (generation !== generationRef.current) return;

          const mapped: Suggestion[] = results.map((r) => ({
            label: r.label,
            value: r.value,
          }));

          setSuggestions(mapped);
          setActiveSuggestionIndex(mapped.length > 0 ? 0 : -1);
          setVisibleStartIndex(0);
          setShowSuggestions(mapped.length > 0);
          setIsLoadingSuggestions(false);
        })
        .catch(() => {
          if (generation !== generationRef.current) return;
          resetCompletionState();
        });
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [
    pathToken,
    cwd,
    resetCompletionState,
    setSuggestions,
    setActiveSuggestionIndex,
    setVisibleStartIndex,
    setShowSuggestions,
    setIsLoadingSuggestions,
  ]);

  const handleAutocomplete = useCallback(
    (index: number) => {
      if (index < 0 || index >= suggestions.length) return;

      const suggestion = suggestions[index];
      if (!pathToken) return;

      const { tokenStart, tokenEnd } = pathToken;
      const isDir = suggestion.value.endsWith('/');

      let replacementText = suggestion.value;
      if (!isDir) {
        replacementText += ' ';
      }

      buffer.replaceRangeByOffset(
        logicalPosToOffset(buffer.lines, cursorRow, tokenStart),
        logicalPosToOffset(buffer.lines, cursorRow, tokenEnd),
        replacementText,
      );

      if (isDir) {
        // Keep completion active for further navigation
      } else {
        resetCompletionState();
      }
    },
    [suggestions, pathToken, buffer, cursorRow, resetCompletionState],
  );

  return {
    suggestions,
    activeSuggestionIndex,
    visibleStartIndex,
    showSuggestions,
    isLoadingSuggestions,
    navigateUp,
    navigateDown,
    handleAutocomplete,
    resetCompletionState,
  };
}
