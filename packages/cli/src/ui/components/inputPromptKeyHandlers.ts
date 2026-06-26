/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommand } from '../commands/types.js';
import type { UseCommandCompletionReturn } from '../hooks/useCommandCompletion.js';
import type { Key } from '../hooks/useKeypress.js';
import type { useReverseSearchCompletion } from '../hooks/useReverseSearchCompletion.js';
import type { useShellPathCompletion } from '../hooks/useShellPathCompletion.js';
import { Command, keyMatchers } from '../keyMatchers.js';
import { isAutoExecutableCommand } from '../utils/commandUtils.js';
import { cpSlice } from '../utils/textUtils.js';
import type { Suggestion } from './SuggestionsDisplay.js';
import { handleLargePaste } from './inputPromptText.js';
import { logicalPosToOffset } from './shared/buffer-operations.js';
import type { TextBuffer } from './shared/text-buffer.js';
import type React from 'react';

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

const handleInputHistoryNavigation = (
  key: Key,
  deps: HistoryNavDeps,
): boolean => {
  const { inputHistory, buffer } = deps;

  if (keyMatchers[Command.HISTORY_UP](key)) {
    inputHistory.navigateUp();
    return true;
  }
  if (keyMatchers[Command.HISTORY_DOWN](key)) {
    inputHistory.navigateDown();
    return true;
  }

  const atFirstVisualRow =
    buffer.allVisualLines.length === 1 ||
    (buffer.visualCursor[0] === 0 && buffer.visualScrollRow === 0);
  if (keyMatchers[Command.NAVIGATION_UP](key) && atFirstVisualRow) {
    inputHistory.navigateUp();
    return true;
  }

  const atLastVisualRow =
    buffer.allVisualLines.length === 1 ||
    buffer.visualCursor[0] === buffer.allVisualLines.length - 1;
  if (keyMatchers[Command.NAVIGATION_DOWN](key) && atLastVisualRow) {
    inputHistory.navigateDown();
    return true;
  }
  return false;
};

const handleShellCompletionNavigation = (
  key: Key,
  deps: HistoryNavDeps,
): boolean => {
  const { shellPathCompletion } = deps;

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
  return false;
};

const handleShellHistoryNavigation = (
  key: Key,
  deps: HistoryNavDeps,
): boolean => {
  const { shellHistory, buffer } = deps;

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
  return false;
};

const handleHistoryNavigation = (key: Key, deps: HistoryNavDeps): boolean => {
  const { shellModeActive, shellPathCompletion } = deps;

  if (!shellModeActive) {
    return handleInputHistoryNavigation(key, deps);
  }
  if (shellPathCompletion.showSuggestions) {
    return handleShellCompletionNavigation(key, deps);
  }
  return handleShellHistoryNavigation(key, deps);
};

export type InputHandlerDeps = {
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
    void deps.buffer.openInExternalEditor();
    return true;
  }
  if (keyMatchers[Command.PASTE_CLIPBOARD](key)) {
    void deps.handleClipboardPaste();
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

export const handleInputKey = (key: Key, deps: InputHandlerDeps): void => {
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
