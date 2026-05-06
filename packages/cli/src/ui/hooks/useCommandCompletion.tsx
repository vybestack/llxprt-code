/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo, useEffect } from 'react';
import type { Suggestion } from '../components/SuggestionsDisplay.js';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import type { TextBuffer } from '../components/shared/text-buffer.js';
import { logicalPosToOffset } from '../components/shared/buffer-operations.js';
import { isSlashCommand } from '../utils/commandUtils.js';
import { toCodePoints } from '../utils/textUtils.js';
import { useAtCompletion } from './useAtCompletion.js';
import { useSlashCompletion } from './useSlashCompletion.js';
import type { PromptCompletion } from './usePromptCompletion.js';
import {
  usePromptCompletion,
  PROMPT_COMPLETION_MIN_LENGTH,
} from './usePromptCompletion.js';
import type { Config } from '@vybestack/llxprt-code-core';
import { useCompletion } from './useCompletion.js';

export enum CompletionMode {
  IDLE = 'IDLE',
  AT = 'AT',
  SLASH = 'SLASH',
  PROMPT = 'PROMPT',
}

export interface UseCommandCompletionReturn {
  suggestions: Suggestion[];
  activeSuggestionIndex: number;
  visibleStartIndex: number;
  showSuggestions: boolean;
  isLoadingSuggestions: boolean;
  isPerfectMatch: boolean;
  activeHint: string;
  setActiveSuggestionIndex: React.Dispatch<React.SetStateAction<number>>;
  setShowSuggestions: React.Dispatch<React.SetStateAction<boolean>>;
  resetCompletionState: () => void;
  navigateUp: () => void;
  navigateDown: () => void;
  handleAutocomplete: (indexToUse: number) => string | undefined;
  promptCompletion: PromptCompletion;
  getCommandFromSuggestion: (suggestionIndex: number) => SlashCommand | null;
  isArgumentCompletion: boolean;
  leafCommand: SlashCommand | null;
}

/**
 * Counts consecutive backslashes before a position in the codepoints array.
 */
function countBackslashesBefore(
  codePoints: string[],
  position: number,
): number {
  let count = 0;
  for (let j = position - 1; j >= 0 && codePoints[j] === '\\'; j--) {
    count++;
  }
  return count;
}

/**
 * Finds the end position of an @ path by scanning for unescaped spaces.
 */
function findAtPathEnd(codePoints: string[], cursorCol: number): number {
  for (let k = cursorCol; k < codePoints.length; k++) {
    if (
      codePoints[k] === ' ' &&
      countBackslashesBefore(codePoints, k) % 2 === 0
    ) {
      return k;
    }
  }
  return codePoints.length;
}

interface CompletionAnalysis {
  completionMode: CompletionMode;
  query: string | null;
  completionStart: number;
  completionEnd: number;
}

function analyzeCompletionMode(
  cursorRow: number,
  cursorCol: number,
  bufferLines: string[],
  bufferText: string,
  config: Config | undefined,
): CompletionAnalysis {
  const currentLine = bufferLines[cursorRow] || '';
  const codePoints = toCodePoints(currentLine);

  // FIRST: Check for @ completion (scan backwards from cursor)
  for (let i = cursorCol - 1; i >= 0; i--) {
    const char = codePoints[i];

    if (char === ' ') {
      const backslashCount = countBackslashesBefore(codePoints, i);
      if (backslashCount % 2 === 0) {
        break;
      }
    } else if (char === '@') {
      const end = findAtPathEnd(codePoints, cursorCol);
      const pathStart = i + 1;
      const partialPath = currentLine.substring(pathStart, end);
      return {
        completionMode: CompletionMode.AT,
        query: partialPath,
        completionStart: pathStart,
        completionEnd: end,
      };
    }
  }

  // THEN: Check for slash command (only if no @ completion is active)
  if (cursorRow === 0 && isSlashCommand(currentLine.trim())) {
    return {
      completionMode: CompletionMode.SLASH,
      query: currentLine,
      completionStart: 0,
      completionEnd: currentLine.length,
    };
  }

  // Check for prompt completion - only if enabled
  const trimmedText = bufferText.trim();
  const isPromptCompletionEnabled =
    config?.getEnablePromptCompletion() ?? false;

  if (
    isPromptCompletionEnabled &&
    trimmedText.length >= PROMPT_COMPLETION_MIN_LENGTH &&
    !isSlashCommand(trimmedText) &&
    !trimmedText.includes('@')
  ) {
    return {
      completionMode: CompletionMode.PROMPT,
      query: trimmedText,
      completionStart: 0,
      completionEnd: trimmedText.length,
    };
  }

  return {
    completionMode: CompletionMode.IDLE,
    query: null,
    completionStart: -1,
    completionEnd: -1,
  };
}

function buildSuggestionText(
  suggestion: string,
  completionMode: CompletionMode,
  start: number,
  end: number,
  bufferLines: string[],
  cursorRow: number,
): string {
  let suggestionText = suggestion;
  const isSlashMode = completionMode === CompletionMode.SLASH;
  const isEmptyRange = start === end;
  const hasNonSpaceCharBefore =
    start > 1 && (bufferLines[cursorRow] || '')[start - 1] !== ' ';
  if (isSlashMode && isEmptyRange && hasNonSpaceCharBefore) {
    suggestionText = ' ' + suggestionText;
  }

  const lineCodePoints = toCodePoints(bufferLines[cursorRow] || '');
  const charAfterCompletion = lineCodePoints[end];
  if (
    charAfterCompletion !== ' ' &&
    !suggestionText.endsWith('/') &&
    !suggestionText.endsWith('\\')
  ) {
    suggestionText += ' ';
  }

  return suggestionText;
}

function useAutocompleteHandler(
  suggestions: Suggestion[],
  completionMode: CompletionMode,
  completionStart: number,
  completionEnd: number,
  buffer: TextBuffer,
  cursorRow: number,
): (indexToUse: number) => string | undefined {
  return useCallback(
    (indexToUse: number): string | undefined => {
      if (indexToUse < 0 || indexToUse >= suggestions.length) {
        return undefined;
      }
      const suggestion = suggestions[indexToUse].value;

      let start = completionStart;
      let end = completionEnd;
      if (completionMode === CompletionMode.SLASH) {
        start = 0;
        end = 0;
      }

      if (start === -1 || end === -1) {
        return undefined;
      }

      const suggestionText = buildSuggestionText(
        suggestion,
        completionMode,
        start,
        end,
        buffer.lines,
        cursorRow,
      );

      const startOffset = logicalPosToOffset(buffer.lines, cursorRow, start);
      const endOffset = logicalPosToOffset(buffer.lines, cursorRow, end);

      const resultingText =
        buffer.text.substring(0, startOffset) +
        suggestionText +
        buffer.text.substring(endOffset);

      buffer.replaceRangeByOffset(startOffset, endOffset, suggestionText);

      return resultingText;
    },
    [
      cursorRow,
      buffer,
      suggestions,
      completionMode,
      completionStart,
      completionEnd,
    ],
  );
}

function useCompletionIndexSync(
  suggestions: Suggestion[],
  setActiveSuggestionIndex: React.Dispatch<React.SetStateAction<number>>,
  setVisibleStartIndex: React.Dispatch<React.SetStateAction<number>>,
): void {
  useEffect(() => {
    setActiveSuggestionIndex(suggestions.length > 0 ? 0 : -1);
    setVisibleStartIndex(0);
  }, [suggestions, setActiveSuggestionIndex, setVisibleStartIndex]);
}

function useCompletionVisibility(
  completionMode: CompletionMode,
  suggestionsLength: number,
  isLoadingSuggestions: boolean,
  reverseSearchActive: boolean,
  resetCompletionState: () => void,
  setShowSuggestions: React.Dispatch<React.SetStateAction<boolean>>,
): void {
  useEffect(() => {
    if (completionMode === CompletionMode.IDLE || reverseSearchActive) {
      resetCompletionState();
      return;
    }
    setShowSuggestions(isLoadingSuggestions || suggestionsLength > 0);
  }, [
    completionMode,
    suggestionsLength,
    isLoadingSuggestions,
    reverseSearchActive,
    resetCompletionState,
    setShowSuggestions,
  ]);
}

function buildSlashModeReturn(
  slashCompletionResults: ReturnType<typeof useSlashCompletion>,
  promptCompletion: PromptCompletion,
): UseCommandCompletionReturn {
  return {
    suggestions: slashCompletionResults.suggestions,
    activeSuggestionIndex: slashCompletionResults.activeSuggestionIndex,
    visibleStartIndex: slashCompletionResults.visibleStartIndex,
    showSuggestions: slashCompletionResults.showSuggestions,
    isLoadingSuggestions: slashCompletionResults.isLoadingSuggestions,
    isPerfectMatch: slashCompletionResults.isPerfectMatch,
    activeHint: slashCompletionResults.activeHint,
    setActiveSuggestionIndex: slashCompletionResults.setActiveSuggestionIndex,
    setShowSuggestions: slashCompletionResults.setShowSuggestions,
    resetCompletionState: slashCompletionResults.resetCompletionState,
    navigateUp: slashCompletionResults.navigateUp,
    navigateDown: slashCompletionResults.navigateDown,
    handleAutocomplete: slashCompletionResults.handleAutocomplete,
    getCommandFromSuggestion: slashCompletionResults.getCommandFromSuggestion,
    isArgumentCompletion: slashCompletionResults.isArgumentCompletion,
    leafCommand: slashCompletionResults.leafCommand,
    promptCompletion,
  };
}

function buildNonSlashReturn(
  completion: ReturnType<typeof useCompletion>,
  handleAutocomplete: (indexToUse: number) => string | undefined,
  promptCompletion: PromptCompletion,
): UseCommandCompletionReturn {
  return {
    suggestions: completion.suggestions,
    activeSuggestionIndex: completion.activeSuggestionIndex,
    visibleStartIndex: completion.visibleStartIndex,
    showSuggestions: completion.showSuggestions,
    isLoadingSuggestions: completion.isLoadingSuggestions,
    isPerfectMatch: completion.isPerfectMatch,
    activeHint: '',
    setActiveSuggestionIndex: completion.setActiveSuggestionIndex,
    setShowSuggestions: completion.setShowSuggestions,
    resetCompletionState: completion.resetCompletionState,
    navigateUp: completion.navigateUp,
    navigateDown: completion.navigateDown,
    handleAutocomplete,
    getCommandFromSuggestion: () => null,
    isArgumentCompletion: false,
    leafCommand: null,
    promptCompletion,
  };
}

export function useCommandCompletion(
  buffer: TextBuffer,
  cwd: string,
  slashCommands: readonly SlashCommand[],
  commandContext: CommandContext,
  reverseSearchActive: boolean = false,
  shellModeActive: boolean,
  config?: Config,
): UseCommandCompletionReturn {
  const dirs = useMemo(
    () => config?.getWorkspaceContext().getDirectories() ?? [cwd],
    [config, cwd],
  );

  const completion = useCompletion();
  const [cursorRow, cursorCol] = buffer.cursor;

  const { completionMode, query, completionStart, completionEnd } = useMemo(
    () =>
      analyzeCompletionMode(
        cursorRow,
        cursorCol,
        buffer.lines,
        buffer.text,
        config,
      ),
    [cursorRow, cursorCol, buffer.lines, buffer.text, config],
  );

  useAtCompletion({
    enabled: completionMode === CompletionMode.AT,
    pattern: query ?? '',
    config,
    cwd,
    setSuggestions: completion.setSuggestions,
    setIsLoadingSuggestions: completion.setIsLoadingSuggestions,
  });

  const slashCompletionResults = useSlashCompletion(
    buffer,
    dirs,
    cwd,
    slashCommands,
    commandContext,
    reverseSearchActive || shellModeActive,
    config,
  );

  const promptCompletion = usePromptCompletion({
    buffer,
    config,
    enabled: completionMode === CompletionMode.PROMPT,
  });

  useCompletionIndexSync(
    completion.suggestions,
    completion.setActiveSuggestionIndex,
    completion.setVisibleStartIndex,
  );

  useCompletionVisibility(
    completionMode,
    completion.suggestions.length,
    completion.isLoadingSuggestions,
    reverseSearchActive,
    completion.resetCompletionState,
    completion.setShowSuggestions,
  );

  const handleAutocomplete = useAutocompleteHandler(
    completion.suggestions,
    completionMode,
    completionStart,
    completionEnd,
    buffer,
    cursorRow,
  );

  if (completionMode === CompletionMode.SLASH) {
    return buildSlashModeReturn(slashCompletionResults, promptCompletion);
  }

  return buildNonSlashReturn(completion, handleAutocomplete, promptCompletion);
}
