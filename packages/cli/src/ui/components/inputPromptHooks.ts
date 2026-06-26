/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import type { UseCommandCompletionReturn } from '../hooks/useCommandCompletion.js';
import { useCommandCompletion } from '../hooks/useCommandCompletion.js';
import { useInputHistory } from '../hooks/useInputHistory.js';
import type { Key } from '../hooks/useKeypress.js';
import { useKeypress } from '../hooks/useKeypress.js';
import type { MouseEvent } from '../hooks/useMouse.js';
import { useMouse } from '../hooks/useMouse.js';
import { useReverseSearchCompletion } from '../hooks/useReverseSearchCompletion.js';
import { useShellHistory } from '../hooks/useShellHistory.js';
import { useShellPathCompletion } from '../hooks/useShellPathCompletion.js';
import { StreamingState } from '../types.js';
import {
  cleanupOldClipboardImages,
  clipboardHasImage,
  saveClipboardImage,
} from '../utils/clipboardUtils.js';
import { isSlashCommand } from '../utils/commandUtils.js';
import type { InputHandlerDeps } from './inputPromptKeyHandlers.js';
import { handleInputKey } from './inputPromptKeyHandlers.js';
import { insertPathReference } from './inputPromptText.js';
import type {
  InputPromptProps,
  InputPromptRuntimeProps,
} from './inputPromptTypes.js';
import { logicalPosToOffset } from './shared/buffer-operations.js';
import type { TextBuffer } from './shared/text-buffer.js';
import type { Config } from '@vybestack/llxprt-code-core';
import { debugLogger } from '@vybestack/llxprt-code-core';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import clipboardy from 'clipboardy';

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
    [
      onSubmit,
      buffer,
      resetCompletionState,
      shellModeActive,
      shellHistory,
      resetReverseSearchCompletionState,
      pendingLargePastesRef,
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
        if (text !== '') {
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

export type InputPromptStateResult = Pick<
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

export const useRuntimeState = (
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
  useKeypress(state.handleInput, {
    isActive: props.isEmbeddedShellFocused !== true,
  });
  return state;
};

export const useMousePaste = (
  focus: boolean,
  isEmbeddedShellFocused: boolean | undefined,
  state: InputPromptStateResult,
): void => {
  const handleMousePaste = useCallback(
    (event: MouseEvent) => {
      if (focus !== true || isEmbeddedShellFocused === true) return;
      if (event.name === 'right-release') {
        void state.handleClipboardPaste();
      }
    },
    [focus, isEmbeddedShellFocused, state],
  );
  useMouse(handleMousePaste, {
    isActive: focus === true && isEmbeddedShellFocused !== true,
  });
};
