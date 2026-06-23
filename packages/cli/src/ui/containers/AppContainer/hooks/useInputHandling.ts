/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useLayoutEffect, useRef } from 'react';
import type { TextBuffer } from '../../../components/shared/text-buffer.js';
import type { UseInputHistoryStoreReturn } from '../../../hooks/useInputHistoryStore.js';
import type { HistoryItemWithoutId } from '../../../types.js';
import { ToolCallStatus } from '../../../types.js';
import { isSlashCommand } from '../../../utils/commandUtils.js';
import type { AppAction } from '../../../reducers/appReducer.js';

export interface UseInputHandlingParams {
  buffer: TextBuffer;
  inputHistoryStore: Pick<UseInputHistoryStoreReturn, 'addInput'>;
  submitQuery: (query: string) => Promise<void>;
  pendingHistoryItems: HistoryItemWithoutId[];
  lastSubmittedPromptRef: React.MutableRefObject<string | null>;
  hadToolCallsRef: React.MutableRefObject<boolean>;
  todoContinuationRef: React.MutableRefObject<{
    clearPause: () => void;
  } | null>;
  /** Whether MCP discovery has completed (or no MCP servers configured). */
  isMcpReady: boolean;
  /** Enqueue a message when gates are closed. From useMessageQueue. */
  addMessage: (message: string) => void;
  /** Whether the user needs to re-authenticate before continuing. */
  needsRelogin: boolean;
  /** Dispatch app actions (e.g., open auth dialog). */
  appDispatch: React.Dispatch<AppAction>;
}

export interface UseInputHandlingResult {
  handleUserCancel: (shouldRestorePrompt?: boolean) => void;
  handleFinalSubmit: (submittedValue: string) => void;
  cancelHandlerRef: React.MutableRefObject<
    ((shouldRestorePrompt?: boolean) => void) | null
  >;
}

/**
 * Checks if any tool is currently executing in pending history items.
 */
function isToolExecuting(pendingHistoryItems: HistoryItemWithoutId[]): boolean {
  return pendingHistoryItems.some((item) => {
    if (item.type === 'tool_group') {
      return item.tools.some(
        (tool) => tool.status === ToolCallStatus.Executing,
      );
    }
    return false;
  });
}

function restoreOrClearBuffer(
  buffer: TextBuffer,
  lastSubmittedPromptRef: React.MutableRefObject<string | null>,
  shouldRestorePrompt?: boolean,
): void {
  if (shouldRestorePrompt === true) {
    const lastUserMessage = lastSubmittedPromptRef.current;
    if (lastUserMessage != null) {
      buffer.setText(lastUserMessage);
    }
  } else {
    buffer.setText('');
  }
}

function captureDeferredPrompt(
  trimmedValue: string,
  inputHistoryStore: Pick<UseInputHistoryStoreReturn, 'addInput'>,
  lastSubmittedPromptRef: React.MutableRefObject<string | null>,
): void {
  if (lastSubmittedPromptRef.current !== trimmedValue) {
    inputHistoryStore.addInput(trimmedValue);
  }
  lastSubmittedPromptRef.current = trimmedValue;
}

function useFinalSubmitHandler({
  inputHistoryStore,
  submitQuery,
  lastSubmittedPromptRef,
  hadToolCallsRef,
  todoContinuationRef,
  isMcpReady,
  addMessage,
  needsRelogin,
  appDispatch,
}: UseInputHandlingParams): (submittedValue: string) => void {
  return useCallback(
    (submittedValue: string) => {
      const trimmedValue = submittedValue.trim();
      if (trimmedValue.length === 0) return;

      const isCommand = isSlashCommand(trimmedValue);
      if (!isCommand && needsRelogin) {
        appDispatch({ type: 'OPEN_DIALOG', payload: 'auth' });
        captureDeferredPrompt(
          trimmedValue,
          inputHistoryStore,
          lastSubmittedPromptRef,
        );
        return;
      }

      if (!isCommand && !isMcpReady) {
        addMessage(trimmedValue);
        captureDeferredPrompt(
          trimmedValue,
          inputHistoryStore,
          lastSubmittedPromptRef,
        );
        return;
      }

      /**
       * @plan PLAN-20260129-TODOPERSIST.P12
       * Reset continuation attempt counter when user submits a new prompt.
       * This prevents the continuation limit from blocking future continuations
       * after user interaction.
       */
      hadToolCallsRef.current = false;
      todoContinuationRef.current?.clearPause();
      lastSubmittedPromptRef.current = trimmedValue;
      inputHistoryStore.addInput(trimmedValue);
      void submitQuery(trimmedValue);
    },
    [
      submitQuery,
      inputHistoryStore,
      hadToolCallsRef,
      todoContinuationRef,
      lastSubmittedPromptRef,
      isMcpReady,
      addMessage,
      needsRelogin,
      appDispatch,
    ],
  );
}

export function useInputHandling(
  params: UseInputHandlingParams,
): UseInputHandlingResult {
  const { buffer, pendingHistoryItems, lastSubmittedPromptRef } = params;
  const cancelHandlerRef = useRef<
    ((shouldRestorePrompt?: boolean) => void) | null
  >(null);
  const handleFinalSubmit = useFinalSubmitHandler(params);
  const handleUserCancel = useCallback(
    (shouldRestorePrompt?: boolean) => {
      restoreOrClearBuffer(buffer, lastSubmittedPromptRef, shouldRestorePrompt);
    },
    [buffer, lastSubmittedPromptRef],
  );
  const cancelHandler = useCallback(
    (shouldRestorePrompt?: boolean) => {
      if (isToolExecuting(pendingHistoryItems)) {
        buffer.setText('');
        return;
      }
      restoreOrClearBuffer(buffer, lastSubmittedPromptRef, shouldRestorePrompt);
    },
    [buffer, pendingHistoryItems, lastSubmittedPromptRef],
  );

  useLayoutEffect(() => {
    cancelHandlerRef.current = cancelHandler;
  }, [cancelHandlerRef, cancelHandler]);

  return {
    handleUserCancel,
    handleFinalSubmit,
    cancelHandlerRef,
  };
}
