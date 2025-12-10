import type { RefObject, Dispatch, SetStateAction } from 'react';
import { useCallback, useState } from 'react';
import type { TextareaRenderable } from '@opentui/core';
import type { Role } from './useChatStore';

type StateSetter<T> = Dispatch<SetStateAction<T>>;

const MIN_INPUT_LINES = 1;
const MAX_INPUT_LINES = 10;

function clampInputLines(value: number): number {
  return Math.min(MAX_INPUT_LINES, Math.max(MIN_INPUT_LINES, value));
}

export interface UseInputManagerReturn {
  inputLineCount: number;
  enforceInputLineBounds: () => void;
  handleSubmit: () => Promise<void>;
  handleTabComplete: () => void;
}

export function useInputManager(
  textareaRef: RefObject<TextareaRenderable | null>,
  appendMessage: (role: Role, text: string) => string,
  setPromptCount: StateSetter<number>,
  setAutoFollow: StateSetter<boolean>,
  startStreamingResponder: (prompt: string) => Promise<void>,
  refreshCompletion: () => void,
  clearCompletion: () => void,
  applyCompletion: () => void,
  handleCommand: (command: string) => Promise<boolean>,
  recordHistory: (prompt: string) => void,
): UseInputManagerReturn {
  const [inputLineCount, setInputLineCount] = useState(MIN_INPUT_LINES);

  const enforceInputLineBounds = useCallback(() => {
    const editor = textareaRef.current;
    if (editor == null) {
      return;
    }
    const clamped = clampInputLines(editor.lineCount);
    setInputLineCount(clamped);
    refreshCompletion();
  }, [refreshCompletion, textareaRef]);

  const handleSubmit = useCallback(async () => {
    const editor = textareaRef.current;
    if (editor == null) {
      return;
    }
    const raw = editor.plainText.trimEnd();
    if (raw.trim().length === 0) {
      return;
    }
    const trimmed = raw.trim();
    if (await handleCommand(trimmed)) {
      recordHistory(raw);
      editor.clear();
      setInputLineCount(MIN_INPUT_LINES);
      setAutoFollow(true);
      clearCompletion();
      editor.submit();
      return;
    }
    if (trimmed === '/quit') {
      process.exit(0);
    }
    recordHistory(raw);
    appendMessage('user', raw);
    setPromptCount((count) => count + 1);
    editor.clear();
    setInputLineCount(MIN_INPUT_LINES);
    setAutoFollow(true);
    clearCompletion();
    editor.submit();
    await startStreamingResponder(trimmed);
  }, [
    appendMessage,
    clearCompletion,
    handleCommand,
    recordHistory,
    setAutoFollow,
    setPromptCount,
    startStreamingResponder,
    textareaRef,
  ]);

  const handleTabComplete = useCallback(() => {
    applyCompletion();
    refreshCompletion();
  }, [applyCompletion, refreshCompletion]);

  return {
    inputLineCount,
    enforceInputLineBounds,
    handleSubmit,
    handleTabComplete,
  };
}
