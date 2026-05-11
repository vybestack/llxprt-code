/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity, max-lines, eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import type React from 'react';
import { useCallback, useEffect, useState, useRef } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { Colors } from '../colors.js';
import type { Suggestion } from './SuggestionsDisplay.js';
import { SuggestionsDisplay } from './SuggestionsDisplay.js';
import { useInputHistory } from '../hooks/useInputHistory.js';
import type { TextBuffer } from './shared/text-buffer.js';
import { logicalPosToOffset } from './shared/text-buffer.js';
import {
  cpSlice,
  cpLen,
  getCachedStringWidth,
  toCodePoints,
} from '../utils/textUtils.js';
import chalk from 'chalk';
import { useShellHistory } from '../hooks/useShellHistory.js';
import { useReverseSearchCompletion } from '../hooks/useReverseSearchCompletion.js';
import type { UseCommandCompletionReturn } from '../hooks/useCommandCompletion.js';
import { useCommandCompletion } from '../hooks/useCommandCompletion.js';
import { useShellPathCompletion } from '../hooks/useShellPathCompletion.js';
import type { Key } from '../hooks/useKeypress.js';
import { useKeypress } from '../hooks/useKeypress.js';
import { keyMatchers, Command } from '../keyMatchers.js';
import type { CommandContext, SlashCommand } from '../commands/types.js';
import type { ApprovalMode, Config } from '@vybestack/llxprt-code-core';
import { StreamingState } from '../types.js';
import {
  isAutoExecutableCommand,
  isSlashCommand,
} from '../utils/commandUtils.js';
import {
  parseInputForHighlighting,
  parseSegmentsFromTokens,
} from '../utils/highlight.js';
import {
  clipboardHasImage,
  saveClipboardImage,
  cleanupOldClipboardImages,
} from '../utils/clipboardUtils.js';
import * as path from 'path';
import { SCREEN_READER_USER_PREFIX } from '../textConstants.js';
import { useMouse } from '../hooks/useMouse.js';
import type { MouseEvent } from '../hooks/useMouse.js';
import clipboardy from 'clipboardy';
import { debugLogger } from '@vybestack/llxprt-code-core';

const LARGE_PASTE_LINE_THRESHOLD = 4;
const LARGE_PASTE_CHAR_THRESHOLD = 1000;

const formatLargePastePlaceholder = (
  lines: number,
  chars: number,
  id: number,
): string => {
  const idSuffix = ` #${id}`;
  if (lines > 1) {
    const label = lines === 1 ? 'line' : 'lines';
    return `[${lines} ${label} pasted${idSuffix}]`;
  }
  const charLabel = chars === 1 ? 'character' : 'characters';
  return `[${chars} ${charLabel} pasted${idSuffix}]`;
};

export interface InputPromptProps {
  buffer: TextBuffer;
  onSubmit: (value: string) => void;
  userMessages: readonly string[];
  onClearScreen: () => void;
  config: Config;
  slashCommands: readonly SlashCommand[];
  commandContext: CommandContext;
  placeholder?: string;
  focus?: boolean;
  inputWidth: number;
  suggestionsWidth: number;
  shellModeActive: boolean;
  setShellModeActive: (value: boolean) => void;
  onEscapePromptChange?: (showPrompt: boolean) => void;
  onSuggestionsVisibilityChange?: (visible: boolean) => void;
  suggestionsPosition?: 'above' | 'below';
  vimHandleInput?: (key: Key) => boolean;
  approvalMode?: ApprovalMode;
  popAllMessages?: (callback: (messages: string) => void) => void;
  vimModeEnabled?: boolean;
  isEmbeddedShellFocused?: boolean;
  setQueueErrorMessage?: (message: string | null) => void;
  streamingState?: StreamingState;
  queueErrorMessage?: string | null;
}

// The input content, input container, and input suggestions list may have different widths
export const calculatePromptWidths = (terminalWidth: number) => {
  const widthFraction = 0.9;
  const FRAME_PADDING_AND_BORDER = 4; // Border (2) + padding (2)
  const PROMPT_PREFIX_WIDTH = 2; // '> ' or '! '
  const MIN_CONTENT_WIDTH = 2;

  const innerContentWidth =
    Math.floor(terminalWidth * widthFraction) -
    FRAME_PADDING_AND_BORDER -
    PROMPT_PREFIX_WIDTH;

  const inputWidth = Math.max(MIN_CONTENT_WIDTH, innerContentWidth);
  const FRAME_OVERHEAD = FRAME_PADDING_AND_BORDER + PROMPT_PREFIX_WIDTH;
  const containerWidth = inputWidth + FRAME_OVERHEAD;
  const suggestionsWidth = Math.max(20, Math.floor(terminalWidth * 1.0));

  return {
    inputWidth,
    containerWidth,
    suggestionsWidth,
    frameOverhead: FRAME_OVERHEAD,
  } as const;
};

// ---------------------------------------------------------------------------
// Pure helpers (no hooks, no React)
// ---------------------------------------------------------------------------

/** Wrap a single long word across multiple lines at the given width. */
const wrapOverlongWord = (
  word: string,
  width: number,
  into: string[],
): void => {
  let remaining = word;
  while (getCachedStringWidth(remaining) > width) {
    let part = '';
    const wordCP = toCodePoints(remaining);
    let partWidth = 0;
    let splitIndex = 0;
    for (let i = 0; i < wordCP.length; i++) {
      const char = wordCP[i];
      const charWidth = getCachedStringWidth(char);
      if (partWidth + charWidth > width) {
        break;
      }
      part += char;
      partWidth += charWidth;
      splitIndex = i + 1;
    }
    into.push(part);
    remaining = cpSlice(remaining, splitIndex);
  }
  if (remaining) {
    into.push(remaining);
  }
};

/** Word-wrap `text` to `width`, returning the array of wrapped lines. */
const wrapTextToWidth = (text: string, width: number): string[] => {
  const result: string[] = [];
  const words = text.split(' ');
  let currentLine = '';

  for (const word of words) {
    const prospectiveLine = currentLine ? `${currentLine} ${word}` : word;
    if (getCachedStringWidth(prospectiveLine) > width) {
      if (currentLine) {
        result.push(currentLine);
      }
      if (getCachedStringWidth(word) > width) {
        wrapOverlongWord(word, width, result);
        currentLine = '';
      } else {
        currentLine = word;
      }
    } else {
      currentLine = prospectiveLine;
    }
  }
  if (currentLine) {
    result.push(currentLine);
  }
  return result;
};

/** Compute inline ghost text and additional wrapped lines. */
const computeGhostText = (
  ghostSuffix: string,
  cursorCol: number,
  currentLogicalLine: string,
  inputWidth: number,
): { inlineGhost: string; additionalLines: string[] } => {
  const textBeforeCursor = cpSlice(currentLogicalLine, 0, cursorCol);
  const usedWidth = getCachedStringWidth(textBeforeCursor);
  const remainingWidth = Math.max(0, inputWidth - usedWidth);

  const ghostTextLinesRaw = ghostSuffix.split('\n');
  const firstLineRaw = ghostTextLinesRaw.shift() ?? '';

  let inlineGhost = '';
  let remainingFirstLine = '';

  if (getCachedStringWidth(firstLineRaw) <= remainingWidth) {
    inlineGhost = firstLineRaw;
  } else {
    const words = firstLineRaw.split(' ');
    let currentLine = '';
    let wordIdx = 0;
    for (const word of words) {
      const prospectiveLine = currentLine ? `${currentLine} ${word}` : word;
      if (getCachedStringWidth(prospectiveLine) > remainingWidth) {
        break;
      }
      currentLine = prospectiveLine;
      wordIdx++;
    }
    inlineGhost = currentLine;
    if (words.length > wordIdx) {
      remainingFirstLine = words.slice(wordIdx).join(' ');
    }
  }

  const linesToWrap: string[] = [];
  if (remainingFirstLine) {
    linesToWrap.push(remainingFirstLine);
  }
  linesToWrap.push(...ghostTextLinesRaw);
  const remainingGhostText = linesToWrap.join('\n');

  const additionalLines: string[] = [];
  if (remainingGhostText) {
    for (const textLine of remainingGhostText.split('\n')) {
      additionalLines.push(...wrapTextToWidth(textLine, inputWidth));
    }
  }

  return { inlineGhost, additionalLines };
};

/** Insert @path reference at the current cursor position in the buffer. */
const insertPathReference = (
  buffer: TextBuffer,
  relativePath: string,
): void => {
  const insertText = `@${relativePath}`;
  const currentText = buffer.text;
  const [row, col] = buffer.cursor;
  const offset = logicalPosToOffset(buffer.lines, row, col);

  let textToInsert = insertText;
  const charBefore = offset > 0 ? currentText[offset - 1] : '';
  const charAfter = offset < currentText.length ? currentText[offset] : '';

  if (charBefore && charBefore !== ' ' && charBefore !== '\n') {
    textToInsert = ' ' + textToInsert;
  }
  if (!charAfter || (charAfter !== ' ' && charAfter !== '\n')) {
    textToInsert = textToInsert + ' ';
  }

  buffer.replaceRangeByOffset(offset, offset, textToInsert);
};

/** Handle a large paste by inserting a placeholder into the buffer. */
const handleLargePaste = (
  key: Key,
  buffer: TextBuffer,
  nextPlaceholderIdRef: React.MutableRefObject<number>,
  pendingLargePastesRef: React.MutableRefObject<Map<string, string>>,
): void => {
  const sanitized = key.sequence.replace(/\r\n?/g, '\n');
  const charCount = cpLen(sanitized);
  const lineCount = sanitized.length === 0 ? 0 : sanitized.split('\n').length;

  if (
    lineCount < LARGE_PASTE_LINE_THRESHOLD &&
    charCount < LARGE_PASTE_CHAR_THRESHOLD
  ) {
    buffer.handleInput({ ...key, sequence: sanitized });
    return;
  }

  const existingText = buffer.text;
  const cursorOffset = logicalPosToOffset(
    buffer.lines,
    buffer.cursor[0],
    buffer.cursor[1],
  );
  const before = existingText.slice(0, cursorOffset);
  const after = existingText.slice(cursorOffset);
  const placeholderId = nextPlaceholderIdRef.current++;
  const placeholderLabel = formatLargePastePlaceholder(
    lineCount,
    charCount,
    placeholderId,
  );
  const placeholderText = `${before}${placeholderLabel}${after}`;

  buffer.setText(placeholderText);
  buffer.moveToOffset(cursorOffset + placeholderLabel.length);
  const nextPendingPastes = new Map(pendingLargePastesRef.current);
  nextPendingPastes.set(placeholderLabel, sanitized);
  pendingLargePastesRef.current = nextPendingPastes;
};

// ---------------------------------------------------------------------------
// Sub-handlers for handleInput
// ---------------------------------------------------------------------------

type EscapeHandlerDeps = {
  reverseSearchActive: boolean;
  setReverseSearchActive: (v: boolean) => void;
  reverseSearchCompletion: { resetCompletionState: () => void };
  textBeforeReverseSearch: string;
  cursorPosition: [number, number];
  buffer: TextBuffer;
  shellModeActive: boolean;
  setShellModeActive: (v: boolean) => void;
  shellPathCompletion: {
    showSuggestions: boolean;
    resetCompletionState: () => void;
  };
  completion: { showSuggestions: boolean; resetCompletionState: () => void };
  escPressCount: React.MutableRefObject<number>;
  showEscapePrompt: boolean;
  setShowEscapePrompt: (v: boolean) => void;
  escapeTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
  resetEscapeState: () => void;
  resetCompletionState: () => void;
};

const handleEscapeKey = (deps: EscapeHandlerDeps): boolean => {
  const {
    reverseSearchActive,
    setReverseSearchActive,
    reverseSearchCompletion,
    textBeforeReverseSearch,
    cursorPosition,
    buffer,
    shellModeActive,
    setShellModeActive,
    shellPathCompletion,
    completion,
    escPressCount,
    setShowEscapePrompt,
    escapeTimerRef,
    resetEscapeState,
    resetCompletionState,
  } = deps;

  if (reverseSearchActive) {
    setReverseSearchActive(false);
    reverseSearchCompletion.resetCompletionState();
    buffer.setText(textBeforeReverseSearch);
    const offset = logicalPosToOffset(
      buffer.lines,
      cursorPosition[0],
      cursorPosition[1],
    );
    buffer.moveToOffset(offset);
    return true;
  }
  if (shellModeActive && shellPathCompletion.showSuggestions) {
    shellPathCompletion.resetCompletionState();
    resetEscapeState();
    return true;
  }
  if (shellModeActive) {
    setShellModeActive(false);
    resetEscapeState();
    return true;
  }
  if (completion.showSuggestions) {
    completion.resetCompletionState();
    resetEscapeState();
    return true;
  }

  if (escPressCount.current === 0) {
    if (buffer.text === '') {
      return true;
    }
    escPressCount.current = 1;
    setShowEscapePrompt(true);
    if (escapeTimerRef.current) {
      clearTimeout(escapeTimerRef.current);
    }
    escapeTimerRef.current = setTimeout(() => {
      resetEscapeState();
    }, 500);
  } else {
    buffer.setText('');
    resetCompletionState();
    resetEscapeState();
  }
  return true;
};

type ReverseSearchHandlerDeps = {
  reverseSearchActive: boolean;
  reverseSearchCompletion: {
    activeSuggestionIndex: number;
    navigateUp: () => void;
    navigateDown: () => void;
    showSuggestions: boolean;
    suggestions: Suggestion[];
    handleAutocomplete: (idx: number) => string | undefined | void;
    resetCompletionState: () => void;
  };
  setReverseSearchActive: (v: boolean) => void;
  handleSubmitAndClear: (v: string) => void;
  buffer: TextBuffer;
};

const handleReverseSearchKeys = (
  key: Key,
  deps: ReverseSearchHandlerDeps,
): boolean => {
  if (!deps.reverseSearchActive) return false;

  const {
    reverseSearchCompletion,
    setReverseSearchActive,
    handleSubmitAndClear,
    buffer,
  } = deps;
  const { showSuggestions, activeSuggestionIndex, suggestions } =
    reverseSearchCompletion;

  if (showSuggestions) {
    if (keyMatchers[Command.NAVIGATION_UP](key)) {
      reverseSearchCompletion.navigateUp();
      return true;
    }
    if (keyMatchers[Command.NAVIGATION_DOWN](key)) {
      reverseSearchCompletion.navigateDown();
      return true;
    }
    if (keyMatchers[Command.ACCEPT_SUGGESTION_REVERSE_SEARCH](key)) {
      reverseSearchCompletion.handleAutocomplete(activeSuggestionIndex);
      reverseSearchCompletion.resetCompletionState();
      setReverseSearchActive(false);
      return true;
    }
  }

  if (keyMatchers[Command.SUBMIT_REVERSE_SEARCH](key)) {
    const textToSubmit =
      showSuggestions && activeSuggestionIndex > -1
        ? suggestions[activeSuggestionIndex].value
        : buffer.text;
    handleSubmitAndClear(textToSubmit);
    reverseSearchCompletion.resetCompletionState();
    setReverseSearchActive(false);
    return true;
  }

  if (
    keyMatchers[Command.NAVIGATION_UP](key) ||
    keyMatchers[Command.NAVIGATION_DOWN](key)
  ) {
    return true;
  }
  return false;
};

/** Try to auto-execute an argument-completion or leaf-command suggestion. */
const tryAutoExecuteCompletion = (
  completion: {
    isArgumentCompletion: boolean;
    leafCommand: SlashCommand | null;
    handleAutocomplete: (idx: number) => string | undefined | void;
    getCommandFromSuggestion: (idx: number) => SlashCommand | null;
  },
  targetIndex: number,
  handleSubmit: (v: string) => void,
): boolean => {
  if (
    completion.isArgumentCompletion &&
    isAutoExecutableCommand(completion.leafCommand)
  ) {
    const completedText = completion.handleAutocomplete(targetIndex);
    if (completedText !== undefined) {
      handleSubmit(completedText.trim());
      return true;
    }
    return false;
  }
  if (!completion.isArgumentCompletion) {
    const command = completion.getCommandFromSuggestion(targetIndex);
    if (isAutoExecutableCommand(command) && !command?.completion) {
      const completedText = completion.handleAutocomplete(targetIndex);
      if (completedText !== undefined) {
        handleSubmit(completedText.trim());
        return true;
      }
      return false;
    }
  }
  return false;
};

type CompletionHandlerDeps = {
  completion: UseCommandCompletionReturn;
  handleSubmit: (v: string) => void;
  buffer: TextBuffer;
};

const acceptCompletionSuggestion = (
  key: Key,
  deps: CompletionHandlerDeps,
): boolean => {
  const { completion, handleSubmit, buffer } = deps;
  if (!keyMatchers[Command.ACCEPT_SUGGESTION](key)) {
    return false;
  }

  const targetIndex =
    completion.activeSuggestionIndex === -1
      ? 0
      : completion.activeSuggestionIndex;
  if (targetIndex < completion.suggestions.length) {
    const handled =
      key.name === 'return' && buffer.text.startsWith('/')
        ? tryAutoExecuteCompletion(completion, targetIndex, handleSubmit)
        : false;
    if (!handled) {
      completion.handleAutocomplete(targetIndex);
    }
  }
  return true;
};

const navigateCompletionSuggestions = (
  key: Key,
  completion: UseCommandCompletionReturn,
): boolean => {
  if (completion.suggestions.length <= 1) {
    return false;
  }
  if (keyMatchers[Command.COMPLETION_UP](key)) {
    completion.navigateUp();
    return true;
  }
  if (keyMatchers[Command.COMPLETION_DOWN](key)) {
    completion.navigateDown();
    return true;
  }
  return false;
};

const handleCompletionKeys = (
  key: Key,
  deps: CompletionHandlerDeps,
): boolean => {
  const { completion, handleSubmit, buffer } = deps;

  if (
    completion.isPerfectMatch &&
    keyMatchers[Command.RETURN](key) &&
    (!completion.showSuggestions || completion.activeSuggestionIndex <= 0)
  ) {
    handleSubmit(buffer.text);
    return true;
  }

  if (completion.showSuggestions) {
    return (
      navigateCompletionSuggestions(key, completion) ||
      acceptCompletionSuggestion(key, deps)
    );
  }

  if (key.name === 'tab' && completion.promptCompletion.text !== '') {
    completion.promptCompletion.accept();
    return true;
  }

  return false;
};

type HistoryNavDeps = {
  shellModeActive: boolean;
  shellPathCompletion: {
    showSuggestions: boolean;
    suggestions: Suggestion[];
    activeSuggestionIndex: number;
    navigateUp: () => void;
    navigateDown: () => void;
    handleAutocomplete: (idx: number) => string | undefined | void;
  };
  shellHistory: {
    getPreviousCommand: () => string | null;
    getNextCommand: () => string | null;
  };
  inputHistory: { navigateUp: () => void; navigateDown: () => void };
  buffer: TextBuffer;
};

const handleHistoryNavigation = (key: Key, deps: HistoryNavDeps): boolean => {
  const {
    shellModeActive,
    shellPathCompletion,
    shellHistory,
    inputHistory,
    buffer,
  } = deps;

  if (!shellModeActive) {
    if (keyMatchers[Command.HISTORY_UP](key)) {
      inputHistory.navigateUp();
      return true;
    }
    if (keyMatchers[Command.HISTORY_DOWN](key)) {
      inputHistory.navigateDown();
      return true;
    }
    if (
      keyMatchers[Command.NAVIGATION_UP](key) &&
      (buffer.allVisualLines.length === 1 ||
        (buffer.visualCursor[0] === 0 && buffer.visualScrollRow === 0))
    ) {
      inputHistory.navigateUp();
      return true;
    }
    if (
      keyMatchers[Command.NAVIGATION_DOWN](key) &&
      (buffer.allVisualLines.length === 1 ||
        buffer.visualCursor[0] === buffer.allVisualLines.length - 1)
    ) {
      inputHistory.navigateDown();
      return true;
    }
  } else if (shellPathCompletion.showSuggestions) {
    if (shellPathCompletion.suggestions.length > 1) {
      if (keyMatchers[Command.COMPLETION_UP](key)) {
        shellPathCompletion.navigateUp();
        return true;
      }
      if (keyMatchers[Command.COMPLETION_DOWN](key)) {
        shellPathCompletion.navigateDown();
        return true;
      }
    }
    if (key.name === 'tab') {
      const idx =
        shellPathCompletion.activeSuggestionIndex === -1
          ? 0
          : shellPathCompletion.activeSuggestionIndex;
      if (idx < shellPathCompletion.suggestions.length) {
        shellPathCompletion.handleAutocomplete(idx);
      }
      return true;
    }
  } else {
    if (keyMatchers[Command.NAVIGATION_UP](key)) {
      const prevCommand = shellHistory.getPreviousCommand();
      if (prevCommand !== null) buffer.setText(prevCommand);
      return true;
    }
    if (keyMatchers[Command.NAVIGATION_DOWN](key)) {
      const nextCommand = shellHistory.getNextCommand();
      if (nextCommand !== null) buffer.setText(nextCommand);
      return true;
    }
  }
  return false;
};

type InputHandlerDeps = {
  focus: boolean;
  buffer: TextBuffer;
  completion: UseCommandCompletionReturn;
  shellModeActive: boolean;
  setShellModeActive: (value: boolean) => void;
  onClearScreen: () => void;
  inputHistory: { navigateUp: () => void; navigateDown: () => void };
  handleSubmitAndClear: (value: string) => void;
  handleSubmit: (value: string) => void;
  shellHistory: {
    getPreviousCommand: () => string | null;
    getNextCommand: () => string | null;
  };
  reverseSearchCompletion: ReturnType<typeof useReverseSearchCompletion>;
  shellPathCompletion: ReturnType<typeof useShellPathCompletion>;
  handleClipboardPaste: () => Promise<void>;
  resetCompletionState: () => void;
  escPressCount: React.MutableRefObject<number>;
  showEscapePrompt: boolean;
  setShowEscapePrompt: (v: boolean) => void;
  escapeTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
  resetEscapeState: () => void;
  vimHandleInput: ((key: Key) => boolean) | undefined;
  reverseSearchActive: boolean;
  setReverseSearchActive: (value: boolean) => void;
  setTextBeforeReverseSearch: (value: string) => void;
  textBeforeReverseSearch: string;
  setCursorPosition: (value: [number, number]) => void;
  cursorPosition: [number, number];
  nextPlaceholderIdRef: React.MutableRefObject<number>;
  pendingLargePastesRef: React.MutableRefObject<Map<string, string>>;
};

const submitBufferInput = (
  buffer: TextBuffer,
  handleSubmit: (value: string) => void,
): void => {
  if (buffer.text.trim() === '') {
    return;
  }
  const [row, col] = buffer.cursor;
  const line = buffer.lines[row];
  const charBefore = col > 0 ? cpSlice(line, col - 1, col) : '';
  if (charBefore === '\\') {
    buffer.backspace();
    buffer.newline();
    return;
  }
  handleSubmit(buffer.text);
};

const handleSpecialInputKey = (key: Key, deps: InputHandlerDeps): boolean => {
  const { focus, buffer, vimHandleInput, resetEscapeState } = deps;
  if (!focus && key.name !== 'paste') {
    return true;
  }
  if (key.name === 'paste') {
    handleLargePaste(
      key,
      buffer,
      deps.nextPlaceholderIdRef,
      deps.pendingLargePastesRef,
    );
    return true;
  }
  if (vimHandleInput?.(key) === true) {
    return true;
  }
  if (
    key.name !== 'escape' &&
    (deps.escPressCount.current > 0 || deps.showEscapePrompt)
  ) {
    resetEscapeState();
  }
  return false;
};

const handleModeAndEscapeKeys = (key: Key, deps: InputHandlerDeps): boolean => {
  const { buffer, completion, shellModeActive } = deps;
  if (
    key.sequence === '!' &&
    buffer.text === '' &&
    !completion.showSuggestions
  ) {
    deps.setShellModeActive(!shellModeActive);
    buffer.setText('');
    return true;
  }
  if (keyMatchers[Command.ESCAPE](key)) {
    handleEscapeKey(deps);
    return true;
  }
  if (shellModeActive && keyMatchers[Command.REVERSE_SEARCH](key)) {
    deps.setReverseSearchActive(true);
    deps.setTextBeforeReverseSearch(buffer.text);
    deps.setCursorPosition(buffer.cursor);
    return true;
  }
  if (keyMatchers[Command.CLEAR_SCREEN](key)) {
    deps.onClearScreen();
    return true;
  }
  return false;
};

const handleNavigationInputKeys = (key: Key, deps: InputHandlerDeps): boolean =>
  handleReverseSearchKeys(key, deps) ||
  handleCompletionKeys(key, deps) ||
  handleHistoryNavigation(key, deps);

const handleSubmitAndEditKeys = (key: Key, deps: InputHandlerDeps): boolean => {
  const { buffer, handleSubmit, resetCompletionState } = deps;
  if (keyMatchers[Command.SUBMIT](key)) {
    submitBufferInput(buffer, handleSubmit);
    return true;
  }
  if (handleEditingCommands(key, buffer)) {
    return true;
  }
  if (keyMatchers[Command.CLEAR_INPUT](key)) {
    if (buffer.text.length > 0) {
      buffer.setText('');
      resetCompletionState();
    }
    return true;
  }
  return false;
};

const handleExternalInputKeys = (key: Key, deps: InputHandlerDeps): boolean => {
  if (keyMatchers[Command.OPEN_EXTERNAL_EDITOR](key)) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    deps.buffer.openInExternalEditor();
    return true;
  }
  if (keyMatchers[Command.PASTE_CLIPBOARD](key)) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    deps.handleClipboardPaste();
    return true;
  }
  return false;
};

const shouldClearPromptCompletion = (
  key: Key,
  completionText: string,
): boolean => {
  if (completionText === '') {
    return false;
  }
  if (key.sequence.length !== 1) {
    return false;
  }
  return key.ctrl !== true && key.meta !== true;
};

const handleTextInputKey = (key: Key, deps: InputHandlerDeps): void => {
  deps.buffer.handleInput(key);
  if (shouldClearPromptCompletion(key, deps.completion.promptCompletion.text)) {
    deps.completion.promptCompletion.clear();
  }
};

const handleInputKey = (key: Key, deps: InputHandlerDeps): void => {
  if (handleSpecialInputKey(key, deps)) return;
  if (handleModeAndEscapeKeys(key, deps)) return;
  if (handleNavigationInputKeys(key, deps)) return;
  if (handleSubmitAndEditKeys(key, deps)) return;
  if (handleExternalInputKeys(key, deps)) return;
  handleTextInputKey(key, deps);
};

/** Handle simple editing commands (newline, home, end, kill-line, etc.). */
const handleEditingCommands = (key: Key, buffer: TextBuffer): boolean => {
  if (keyMatchers[Command.NEWLINE](key)) {
    buffer.newline();
    return true;
  }
  if (keyMatchers[Command.HOME](key)) {
    buffer.move('home');
    return true;
  }
  if (keyMatchers[Command.END](key)) {
    buffer.move('end');
    return true;
  }
  if (keyMatchers[Command.KILL_LINE_RIGHT](key)) {
    buffer.killLineRight();
    return true;
  }
  if (keyMatchers[Command.KILL_LINE_LEFT](key)) {
    buffer.killLineLeft();
    return true;
  }
  if (keyMatchers[Command.DELETE_WORD_BACKWARD](key)) {
    buffer.deleteWordLeft();
    return true;
  }
  return false;
};

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

/** Build a highlighted cursor character if it falls within this segment. */
const applyCursorHighlight = (
  display: string,
  isOnCursorLine: boolean,
  segLen: number,
  charCount: number,
  cursorVisualColAbsolute: number,
): { display: string; newCharCount: number } => {
  if (!isOnCursorLine || segLen === 0) {
    return { display, newCharCount: charCount + segLen };
  }

  const segStart = charCount;
  const segEnd = segStart + segLen;

  if (cursorVisualColAbsolute >= segStart && cursorVisualColAbsolute < segEnd) {
    const charToHighlight = cpSlice(
      display,
      cursorVisualColAbsolute - segStart,
      cursorVisualColAbsolute - segStart + 1,
    );
    const highlighted = charToHighlight
      ? chalk.inverse(charToHighlight)
      : charToHighlight;
    const newDisplay =
      cpSlice(display, 0, cursorVisualColAbsolute - segStart) +
      highlighted +
      cpSlice(display, cursorVisualColAbsolute - segStart + 1);
    return { display: newDisplay, newCharCount: segEnd };
  }
  return { display, newCharCount: segEnd };
};

/** Render highlighted segments for a single visual line. */
const renderSegments = (
  segments: ReadonlyArray<{ text: string; type: string }>,
  isOnCursorLine: boolean,
  cursorVisualColAbsolute: number,
): React.ReactNode[] => {
  const renderedLine: React.ReactNode[] = [];
  let charCount = 0;

  segments.forEach((seg, segIdx) => {
    const segLen = cpLen(seg.text);
    let display = seg.text;

    const result = applyCursorHighlight(
      display,
      isOnCursorLine,
      segLen,
      charCount,
      cursorVisualColAbsolute,
    );
    display = result.display;
    charCount = result.newCharCount;

    const color =
      seg.type === 'command' || seg.type === 'file'
        ? theme.text.accent
        : undefined;

    if (segLen > 0) {
      renderedLine.push(
        <Text key={`token-${segIdx}`} color={color}>
          {display}
        </Text>,
      );
    }
  });

  return renderedLine;
};

/** Render a single visual line with syntax highlighting and cursor. */
const renderVisualLine = (
  lineText: string,
  visualIdxInRenderedSet: number,
  scrollVisualRow: number,
  cursorVisualRowAbsolute: number,
  cursorVisualColAbsolute: number,
  buffer: TextBuffer,
  focus: boolean,
  inlineGhost: string,
): React.ReactNode => {
  const absoluteVisualIdx = scrollVisualRow + visualIdxInRenderedSet;
  const mapEntry = buffer.visualToLogicalMap[absoluteVisualIdx];
  const cursorVisualRow = cursorVisualRowAbsolute - scrollVisualRow;
  const isOnCursorLine = focus && visualIdxInRenderedSet === cursorVisualRow;

  const [logicalLineIdx] = mapEntry;
  const logicalLine = buffer.lines[logicalLineIdx] ?? '';
  const transformations = buffer.transformationsByLine[logicalLineIdx] ?? [];
  const tokens = parseInputForHighlighting(
    logicalLine,
    logicalLineIdx,
    transformations,
    ...(focus && buffer.cursor[0] === logicalLineIdx ? [buffer.cursor[1]] : []),
  );
  const startColInTransformed =
    buffer.visualToTransformedMap[absoluteVisualIdx] ?? 0;
  const visualEndCol = startColInTransformed + cpLen(lineText);
  const segments = parseSegmentsFromTokens(
    tokens,
    startColInTransformed,
    visualEndCol,
  );

  const renderedLine = renderSegments(
    segments,
    isOnCursorLine,
    cursorVisualColAbsolute,
  );

  const currentLineGhost = isOnCursorLine ? inlineGhost : '';
  if (
    isOnCursorLine &&
    cursorVisualColAbsolute === cpLen(lineText) &&
    !currentLineGhost
  ) {
    renderedLine.push(
      <Text key="cursor-end" color={Colors.Foreground}>
        {chalk.inverse(' ')}
      </Text>,
    );
  }

  const showCursorBeforeGhost =
    focus === true &&
    isOnCursorLine === true &&
    cursorVisualColAbsolute === cpLen(lineText) &&
    currentLineGhost !== '';

  if (!currentLineGhost && renderedLine.length === 0) {
    renderedLine.push(
      <Text key="blank-placeholder" color={Colors.Foreground}>
        {' '}
      </Text>,
    );
  }

  return (
    <Text key={`line-${visualIdxInRenderedSet}`} color={theme.text.accent}>
      {renderedLine}
      {showCursorBeforeGhost === true && chalk.inverse(' ')}
      {currentLineGhost !== '' && (
        <Text color={theme.text.secondary}>{currentLineGhost}</Text>
      )}
    </Text>
  );
};

// ---------------------------------------------------------------------------
// Custom hooks
// ---------------------------------------------------------------------------

const useEscapeState = (
  onEscapePromptChange: ((showPrompt: boolean) => void) | undefined,
) => {
  const escPressCount = useRef(0);
  const [showEscapePrompt, setShowEscapePrompt] = useState(false);
  const escapeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const resetEscapeState = useCallback(() => {
    if (escapeTimerRef.current) {
      clearTimeout(escapeTimerRef.current);
      escapeTimerRef.current = null;
    }
    escPressCount.current = 0;
    setShowEscapePrompt(false);
  }, [escPressCount, escapeTimerRef, setShowEscapePrompt]);

  useEffect(() => {
    if (onEscapePromptChange) {
      onEscapePromptChange(showEscapePrompt);
    }
  }, [showEscapePrompt, onEscapePromptChange]);

  useEffect(
    () => () => {
      if (escapeTimerRef.current) {
        clearTimeout(escapeTimerRef.current);
      }
    },
    [escapeTimerRef],
  );

  return {
    escPressCount,
    showEscapePrompt,
    setShowEscapePrompt,
    escapeTimerRef,
    resetEscapeState,
  };
};

const useSubmitHandlers = (
  onSubmit: (value: string) => void,
  buffer: TextBuffer,
  shellModeActive: boolean,
  shellHistory: { addCommandToHistory: (cmd: string) => void },
  resetCompletionState: () => void,
  resetReverseSearchCompletionState: () => void,
  pendingLargePastesRef: React.MutableRefObject<Map<string, string>>,
  streamingState: StreamingState | undefined,
  setQueueErrorMessage: ((message: string | null) => void) | undefined,
) => {
  const handleSubmitAndClear = useCallback(
    (submittedValue: string) => {
      let actualValue = submittedValue;
      const pendingPastes = pendingLargePastesRef.current;
      if (pendingPastes.size > 0) {
        pendingPastes.forEach((actualContent, placeholderLabel) => {
          if (actualValue.includes(placeholderLabel)) {
            actualValue = actualValue
              .split(placeholderLabel)
              .join(actualContent);
          }
        });
      }

      if (shellModeActive) {
        shellHistory.addCommandToHistory(actualValue);
      }
      buffer.setText('');
      pendingLargePastesRef.current = new Map();
      onSubmit(actualValue);
      resetCompletionState();
      resetReverseSearchCompletionState();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable and do not need to be in deps
    [
      onSubmit,
      buffer,
      resetCompletionState,
      shellModeActive,
      shellHistory,
      resetReverseSearchCompletionState,
    ],
  );

  const handleSubmit = useCallback(
    (submittedValue: string) => {
      const trimmedMessage = submittedValue.trim();
      const isSlash = isSlashCommand(trimmedMessage);
      const isShell = shellModeActive;
      if (
        (isSlash || isShell) &&
        streamingState === StreamingState.Responding
      ) {
        setQueueErrorMessage?.(
          `${isShell ? 'Shell' : 'Slash'} commands cannot be queued`,
        );
        return;
      }
      handleSubmitAndClear(trimmedMessage);
    },
    [
      handleSubmitAndClear,
      shellModeActive,
      streamingState,
      setQueueErrorMessage,
    ],
  );

  return { handleSubmitAndClear, handleSubmit };
};

/** Suggestion nodes for completion, reverse search, and shell path. */
const useSuggestionsNodes = (
  completion: UseCommandCompletionReturn,
  shellModeActive: boolean,
  reverseSearchActive: boolean,
  reverseSearchCompletion: {
    suggestions: Suggestion[];
    activeSuggestionIndex: number;
    isLoadingSuggestions: boolean;
    visibleStartIndex: number;
  },
  shellPathCompletion: {
    showSuggestions: boolean;
    suggestions: Suggestion[];
    activeSuggestionIndex: number;
    isLoadingSuggestions: boolean;
    visibleStartIndex: number;
  },
  suggestionsWidth: number,
  bufferText: string,
) => {
  const completionSuggestionsNode =
    completion.showSuggestions && !shellModeActive ? (
      <Box paddingRight={2}>
        <SuggestionsDisplay
          suggestions={completion.suggestions}
          activeIndex={completion.activeSuggestionIndex}
          isLoading={completion.isLoadingSuggestions}
          width={suggestionsWidth}
          scrollOffset={completion.visibleStartIndex}
          userInput={bufferText}
          activeHint={completion.activeHint}
        />
      </Box>
    ) : null;

  const reverseSearchSuggestionsNode = reverseSearchActive ? (
    <Box paddingRight={2}>
      <SuggestionsDisplay
        suggestions={reverseSearchCompletion.suggestions}
        activeIndex={reverseSearchCompletion.activeSuggestionIndex}
        isLoading={reverseSearchCompletion.isLoadingSuggestions}
        width={suggestionsWidth}
        scrollOffset={reverseSearchCompletion.visibleStartIndex}
        userInput={bufferText}
      />
    </Box>
  ) : null;

  const shellPathSuggestionsNode = shellPathCompletion.showSuggestions ? (
    <Box paddingRight={2}>
      <SuggestionsDisplay
        suggestions={shellPathCompletion.suggestions}
        activeIndex={shellPathCompletion.activeSuggestionIndex}
        isLoading={shellPathCompletion.isLoadingSuggestions}
        width={suggestionsWidth}
        scrollOffset={shellPathCompletion.visibleStartIndex}
        userInput={bufferText}
      />
    </Box>
  ) : null;

  const suggestionsNode =
    completionSuggestionsNode ??
    shellPathSuggestionsNode ??
    reverseSearchSuggestionsNode;

  return suggestionsNode;
};

const useClipboardPasteHandler = (buffer: TextBuffer, config: Config) =>
  useCallback(async () => {
    try {
      if (await clipboardHasImage()) {
        const imagePath = await saveClipboardImage(config.getTargetDir());
        if (imagePath) {
          cleanupOldClipboardImages(config.getTargetDir()).catch(() => {});
          const relativePath = path.relative(config.getTargetDir(), imagePath);
          insertPathReference(buffer, relativePath);
        }
        return;
      }

      try {
        const text = await clipboardy.read();
        if (text) {
          const [row, col] = buffer.cursor;
          const offset = logicalPosToOffset(buffer.lines, row, col);
          buffer.replaceRangeByOffset(offset, offset, text);
        }
      } catch {
        // clipboard read can fail on Wayland, SSH, headless, etc.
      }
    } catch (error) {
      debugLogger.error('Error handling clipboard paste:', error);
    }
  }, [buffer, config]);

type InputPromptState = Pick<
  InputPromptProps,
  | 'buffer'
  | 'onSubmit'
  | 'userMessages'
  | 'onClearScreen'
  | 'config'
  | 'slashCommands'
  | 'commandContext'
  | 'shellModeActive'
  | 'setShellModeActive'
  | 'onEscapePromptChange'
  | 'onSuggestionsVisibilityChange'
  | 'vimHandleInput'
  | 'setQueueErrorMessage'
  | 'streamingState'
  | 'focus'
> & {
  pendingLargePastesRef: React.MutableRefObject<Map<string, string>>;
  nextPlaceholderIdRef: React.MutableRefObject<number>;
};

type CompletionState = {
  completion: UseCommandCompletionReturn;
  reverseSearchCompletion: ReturnType<typeof useReverseSearchCompletion>;
  shellPathCompletion: ReturnType<typeof useShellPathCompletion>;
  shellHistory: ReturnType<typeof useShellHistory>;
  reverseSearchActive: boolean;
  setReverseSearchActive: (value: boolean) => void;
};

type ReverseSearchState = {
  textBeforeReverseSearch: string;
  setTextBeforeReverseSearch: (value: string) => void;
  cursorPosition: [number, number];
  setCursorPosition: (value: [number, number]) => void;
};

type InputPromptStateResult = Pick<
  CompletionState,
  | 'completion'
  | 'reverseSearchCompletion'
  | 'shellPathCompletion'
  | 'reverseSearchActive'
> & {
  handleClipboardPaste: () => Promise<void>;
  handleInput: (key: Key) => void;
};

const useCompletionState = ({
  buffer,
  config,
  slashCommands,
  commandContext,
  shellModeActive,
}: Pick<
  InputPromptState,
  'buffer' | 'config' | 'slashCommands' | 'commandContext' | 'shellModeActive'
>): CompletionState => {
  const [reverseSearchActive, setReverseSearchActive] = useState(false);
  const shellHistory = useShellHistory(config.getProjectRoot(), config.storage);
  const completion = useCommandCompletion(
    buffer,
    config.getTargetDir(),
    slashCommands,
    commandContext,
    reverseSearchActive,
    shellModeActive,
    config,
  );
  const reverseSearchCompletion = useReverseSearchCompletion(
    buffer,
    shellHistory.history,
    reverseSearchActive,
  );
  const shellPathCompletion = useShellPathCompletion(
    buffer,
    config.getTargetDir(),
    shellModeActive,
    reverseSearchActive,
  );

  return {
    completion,
    reverseSearchCompletion,
    shellPathCompletion,
    shellHistory,
    reverseSearchActive,
    setReverseSearchActive,
  };
};

const useReverseSearchState = (): ReverseSearchState => {
  const [textBeforeReverseSearch, setTextBeforeReverseSearch] = useState('');
  const [cursorPosition, setCursorPosition] = useState<[number, number]>([
    0, 0,
  ]);

  return {
    textBeforeReverseSearch,
    setTextBeforeReverseSearch,
    cursorPosition,
    setCursorPosition,
  };
};

const useSuggestionVisibilityEffect = (
  onSuggestionsVisibilityChange: InputPromptState['onSuggestionsVisibilityChange'],
  completion: UseCommandCompletionReturn,
  reverseSearchActive: boolean,
  shellPathCompletion: ReturnType<typeof useShellPathCompletion>,
): void => {
  useEffect(() => {
    onSuggestionsVisibilityChange?.(
      completion.showSuggestions ||
        reverseSearchActive ||
        shellPathCompletion.showSuggestions,
    );
  }, [
    completion.showSuggestions,
    reverseSearchActive,
    shellPathCompletion.showSuggestions,
    onSuggestionsVisibilityChange,
  ]);
};

const useInputHistoryState = (
  buffer: TextBuffer,
  userMessages: readonly string[],
  handleSubmitAndClear: (value: string) => void,
  completion: UseCommandCompletionReturn,
  shellModeActive: boolean,
  resetReverseSearchCompletionState: () => void,
) => {
  const [justNavigatedHistory, setJustNavigatedHistory] = useState(false);
  const resetCompletionState = completion.resetCompletionState;
  const customSetTextAndResetCompletionSignal = useCallback(
    (newText: string) => {
      buffer.setText(newText);
      setJustNavigatedHistory(true);
    },
    [buffer],
  );

  const inputHistory = useInputHistory({
    userMessages,
    onSubmit: handleSubmitAndClear,
    isActive:
      (!completion.showSuggestions || completion.suggestions.length === 1) &&
      !shellModeActive,
    currentQuery: buffer.text,
    onChange: customSetTextAndResetCompletionSignal,
  });

  useEffect(() => {
    if (justNavigatedHistory) {
      resetCompletionState();
      resetReverseSearchCompletionState();
      setJustNavigatedHistory(false);
    }
  }, [
    justNavigatedHistory,
    buffer.text,
    resetCompletionState,
    resetReverseSearchCompletionState,
  ]);

  return inputHistory;
};

const usePendingPastePruning = (
  buffer: TextBuffer,
  pendingLargePastesRef: React.MutableRefObject<Map<string, string>>,
): void => {
  useEffect(() => {
    const pendingPastes = pendingLargePastesRef.current;
    if (pendingPastes.size === 0) return;
    const filtered = Array.from(pendingPastes.entries()).filter(
      ([placeholderLabel]) => buffer.text.includes(placeholderLabel),
    );
    if (filtered.length !== pendingPastes.size) {
      pendingLargePastesRef.current = new Map(filtered);
    }
  }, [buffer.text, pendingLargePastesRef]);
};

const buildInputHandlerDeps = (
  state: InputPromptState,
  completionState: CompletionState,
  escapeState: ReturnType<typeof useEscapeState>,
  submitState: ReturnType<typeof useSubmitHandlers>,
  reverseSearchState: ReverseSearchState,
  inputHistory: { navigateUp: () => void; navigateDown: () => void },
  handleClipboardPaste: () => Promise<void>,
): InputHandlerDeps => ({
  focus: state.focus ?? true,
  buffer: state.buffer,
  completion: completionState.completion,
  shellModeActive: state.shellModeActive,
  setShellModeActive: state.setShellModeActive,
  onClearScreen: state.onClearScreen,
  inputHistory,
  handleSubmitAndClear: submitState.handleSubmitAndClear,
  handleSubmit: submitState.handleSubmit,
  shellHistory: completionState.shellHistory,
  reverseSearchCompletion: completionState.reverseSearchCompletion,
  shellPathCompletion: completionState.shellPathCompletion,
  handleClipboardPaste,
  resetCompletionState: completionState.completion.resetCompletionState,
  escPressCount: escapeState.escPressCount,
  showEscapePrompt: escapeState.showEscapePrompt,
  setShowEscapePrompt: escapeState.setShowEscapePrompt,
  escapeTimerRef: escapeState.escapeTimerRef,
  resetEscapeState: escapeState.resetEscapeState,
  vimHandleInput: state.vimHandleInput,
  reverseSearchActive: completionState.reverseSearchActive,
  setReverseSearchActive: completionState.setReverseSearchActive,
  setTextBeforeReverseSearch: reverseSearchState.setTextBeforeReverseSearch,
  textBeforeReverseSearch: reverseSearchState.textBeforeReverseSearch,
  setCursorPosition: reverseSearchState.setCursorPosition,
  cursorPosition: reverseSearchState.cursorPosition,
  nextPlaceholderIdRef: state.nextPlaceholderIdRef,
  pendingLargePastesRef: state.pendingLargePastesRef,
});

const useInputHandler = (
  state: InputPromptState,
  completionState: CompletionState,
  escapeState: ReturnType<typeof useEscapeState>,
  submitState: ReturnType<typeof useSubmitHandlers>,
  reverseSearchState: ReverseSearchState,
  inputHistory: { navigateUp: () => void; navigateDown: () => void },
  handleClipboardPaste: () => Promise<void>,
): ((key: Key) => void) =>
  useCallback(
    (key: Key) => {
      const deps = buildInputHandlerDeps(
        state,
        completionState,
        escapeState,
        submitState,
        reverseSearchState,
        inputHistory,
        handleClipboardPaste,
      );
      handleInputKey(key, deps);
    },
    [
      state,
      completionState,
      escapeState,
      submitState,
      reverseSearchState,
      inputHistory,
      handleClipboardPaste,
    ],
  );

const useInputPromptState = (
  state: InputPromptState,
): InputPromptStateResult => {
  const completionState = useCompletionState(state);
  const reverseSearchState = useReverseSearchState();
  const escapeState = useEscapeState(state.onEscapePromptChange);
  const submitState = useSubmitHandlers(
    state.onSubmit,
    state.buffer,
    state.shellModeActive,
    completionState.shellHistory,
    completionState.completion.resetCompletionState,
    completionState.reverseSearchCompletion.resetCompletionState,
    state.pendingLargePastesRef,
    state.streamingState,
    state.setQueueErrorMessage,
  );
  useSuggestionVisibilityEffect(
    state.onSuggestionsVisibilityChange,
    completionState.completion,
    completionState.reverseSearchActive,
    completionState.shellPathCompletion,
  );
  const inputHistory = useInputHistoryState(
    state.buffer,
    state.userMessages,
    submitState.handleSubmitAndClear,
    completionState.completion,
    state.shellModeActive,
    completionState.reverseSearchCompletion.resetCompletionState,
  );
  usePendingPastePruning(state.buffer, state.pendingLargePastesRef);
  const handleClipboardPaste = useClipboardPasteHandler(
    state.buffer,
    state.config,
  );
  const handleInput = useInputHandler(
    state,
    completionState,
    escapeState,
    submitState,
    reverseSearchState,
    inputHistory,
    handleClipboardPaste,
  );

  return {
    completion: completionState.completion,
    reverseSearchCompletion: completionState.reverseSearchCompletion,
    shellPathCompletion: completionState.shellPathCompletion,
    reverseSearchActive: completionState.reverseSearchActive,
    handleClipboardPaste,
    handleInput,
  };
};

/** Render ghost-line padding nodes for additional ghost text lines. */
const renderGhostLines = (
  additionalLines: string[],
  inputWidth: number,
): React.ReactNode[] =>
  additionalLines.map((ghostLine, index) => {
    const padding = Math.max(0, inputWidth - getCachedStringWidth(ghostLine));
    return (
      <Text key={`ghost-line-${index}`} color={theme.text.secondary}>
        {ghostLine}
        {' '.repeat(padding)}
      </Text>
    );
  });

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type PromptInputBoxProps = {
  buffer: TextBuffer;
  placeholder: string;
  focus: boolean;
  shellModeActive: boolean;
  reverseSearchActive: boolean;
  inputWidth: number;
  inlineGhost: string;
  additionalLines: string[];
};

type InputPromptRuntimeProps = Omit<
  InputPromptProps,
  'placeholder' | 'inputWidth' | 'suggestionsWidth' | 'suggestionsPosition'
>;

type InputPromptViewProps = {
  buffer: TextBuffer;
  placeholder: string;
  focus: boolean;
  inputWidth: number;
  suggestionsPosition: 'above' | 'below';
  shellModeActive: boolean;
  state: InputPromptStateResult;
  suggestionsNode: React.ReactNode;
  ghostText: { inlineGhost: string; additionalLines: string[] };
};

const useGhostTextLines = (
  completion: UseCommandCompletionReturn,
  buffer: TextBuffer,
  inputWidth: number,
): { inlineGhost: string; additionalLines: string[] } => {
  if (
    completion.promptCompletion.text === '' ||
    buffer.text === '' ||
    !completion.promptCompletion.text.startsWith(buffer.text)
  ) {
    return { inlineGhost: '', additionalLines: [] };
  }

  const ghostSuffix = completion.promptCompletion.text.slice(
    buffer.text.length,
  );
  if (ghostSuffix === '') {
    return { inlineGhost: '', additionalLines: [] };
  }

  return computeGhostText(
    ghostSuffix,
    buffer.cursor[1],
    buffer.lines[buffer.cursor[0]] ?? '',
    inputWidth,
  );
};

const renderPromptPrefix = (
  shellModeActive: boolean,
  reverseSearchActive: boolean,
): React.ReactNode => (
  <Text color={shellModeActive ? theme.status.warning : theme.text.accent}>
    {shellModeActive ? (
      // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      reverseSearchActive ? (
        <Text color={theme.text.link} aria-label={SCREEN_READER_USER_PREFIX}>
          (r:){' '}
        </Text>
      ) : (
        '! '
      )
    ) : (
      '> '
    )}
  </Text>
);

const renderPlaceholder = (
  placeholder: string,
  focus: boolean,
): React.ReactNode =>
  focus ? (
    <Text color={Colors.Foreground}>
      {chalk.inverse(placeholder.slice(0, 1))}
      <Text color={Colors.DimComment}>{placeholder.slice(1)}</Text>
    </Text>
  ) : (
    <Text color={Colors.DimComment}>{placeholder}</Text>
  );

const renderInputLines = (
  buffer: TextBuffer,
  focus: boolean,
  inputWidth: number,
  inlineGhost: string,
  additionalLines: string[],
): React.ReactNode[] => {
  const [cursorVisualRowAbsolute, cursorVisualColAbsolute] =
    buffer.visualCursor;
  const scrollVisualRow = buffer.visualScrollRow;
  return buffer.viewportVisualLines
    .map((lineText, visualIdxInRenderedSet) =>
      renderVisualLine(
        lineText,
        visualIdxInRenderedSet,
        scrollVisualRow,
        cursorVisualRowAbsolute,
        cursorVisualColAbsolute,
        buffer,
        focus,
        inlineGhost,
      ),
    )
    .concat(renderGhostLines(additionalLines, inputWidth));
};

const PromptInputBox: React.FC<PromptInputBoxProps> = ({
  buffer,
  placeholder,
  focus,
  shellModeActive,
  reverseSearchActive,
  inputWidth,
  inlineGhost,
  additionalLines,
}) => (
  <Box
    borderStyle="round"
    borderColor={shellModeActive ? theme.status.warning : theme.border.focused}
    paddingX={1}
  >
    {renderPromptPrefix(shellModeActive, reverseSearchActive)}
    <Box flexGrow={1} flexDirection="column">
      {buffer.text.length === 0 && placeholder
        ? renderPlaceholder(placeholder, focus)
        : renderInputLines(
            buffer,
            focus,
            inputWidth,
            inlineGhost,
            additionalLines,
          )}
    </Box>
  </Box>
);

const useRuntimeState = (
  props: InputPromptRuntimeProps,
): InputPromptStateResult => {
  const pendingLargePastesRef = useRef<Map<string, string>>(new Map());
  const nextPlaceholderIdRef = useRef(1);
  const state = useInputPromptState({
    ...props,
    focus: props.focus ?? true,
    pendingLargePastesRef,
    nextPlaceholderIdRef,
  });
  useKeypress(state.handleInput, { isActive: true });
  return state;
};

const useMousePaste = (
  focus: boolean,
  isEmbeddedShellFocused: boolean | undefined,
  state: InputPromptStateResult,
): void => {
  const handleMousePaste = useCallback(
    (event: MouseEvent) => {
      if (focus !== true || isEmbeddedShellFocused === true) return;
      if (event.name === 'right-release') {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        state.handleClipboardPaste();
      }
    },
    [focus, isEmbeddedShellFocused, state],
  );
  useMouse(handleMousePaste, {
    isActive: focus === true && isEmbeddedShellFocused !== true,
  });
};

const InputPromptView: React.FC<InputPromptViewProps> = ({
  buffer,
  placeholder,
  focus,
  inputWidth,
  suggestionsPosition,
  shellModeActive,
  state,
  suggestionsNode,
  ghostText,
}) => (
  <>
    {suggestionsPosition === 'above' && suggestionsNode}
    <PromptInputBox
      buffer={buffer}
      placeholder={placeholder}
      focus={focus}
      shellModeActive={shellModeActive}
      reverseSearchActive={state.reverseSearchActive}
      inputWidth={inputWidth}
      inlineGhost={ghostText.inlineGhost}
      additionalLines={ghostText.additionalLines}
    />
    {suggestionsPosition === 'below' && suggestionsNode}
  </>
);

export const InputPrompt: React.FC<InputPromptProps> = ({
  placeholder = '  Type your message or @path/to/file',
  focus = true,
  inputWidth,
  suggestionsWidth,
  suggestionsPosition = 'below',
  ...runtimeProps
}) => {
  const state = useRuntimeState({ ...runtimeProps, focus });
  useMousePaste(focus, runtimeProps.isEmbeddedShellFocused, state);
  const ghostText = useGhostTextLines(
    state.completion,
    runtimeProps.buffer,
    inputWidth,
  );
  const suggestionsNode = useSuggestionsNodes(
    state.completion,
    runtimeProps.shellModeActive,
    state.reverseSearchActive,
    state.reverseSearchCompletion,
    state.shellPathCompletion,
    suggestionsWidth,
    runtimeProps.buffer.text,
  );

  return (
    <InputPromptView
      buffer={runtimeProps.buffer}
      placeholder={placeholder}
      focus={focus}
      inputWidth={inputWidth}
      suggestionsPosition={suggestionsPosition}
      shellModeActive={runtimeProps.shellModeActive}
      state={state}
      suggestionsNode={suggestionsNode}
      ghostText={ghostText}
    />
  );
};
