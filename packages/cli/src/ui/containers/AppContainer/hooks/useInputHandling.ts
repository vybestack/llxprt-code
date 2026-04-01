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

/**
 * @hook useInputHandling
 * @description Cancel handler and final submit logic with MCP-readiness gating
 * @inputs buffer, inputHistoryStore, submitQuery, pendingHistoryItems, lastSubmittedPromptRef, hadToolCallsRef, todoContinuationRef, isMcpReady, addMessage
 * @outputs handleUserCancel, handleFinalSubmit, cancelHandlerRef
 * @sideEffects None (callbacks only)
 * @cleanup N/A
 * @strictMode Safe - callbacks use latest refs
 * @subscriptionStrategy N/A
 */

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
    if (item && item.type === 'tool_group') {
      return item.tools.some(
        (tool) => tool.status === ToolCallStatus.Executing,
      );
    }
    return false;
  });
}

export function useInputHandling({
  buffer,
  inputHistoryStore,
  submitQuery,
  pendingHistoryItems,
  lastSubmittedPromptRef,
  hadToolCallsRef,
  todoContinuationRef,
  isMcpReady,
  addMessage,
}: UseInputHandlingParams): UseInputHandlingResult {
  const cancelHandlerRef = useRef<
    ((shouldRestorePrompt?: boolean) => void) | null
  >(null);

  // Keybinding-triggered cancel: intentionally skips the isToolExecuting() check.
  // This handler is invoked from keyboard shortcuts (e.g. Ctrl+C) and should always
  // clear or restore the buffer regardless of tool state. The cancelHandlerRef below
  // is the programmatic cancel path that guards against tool execution.
  const handleUserCancel = useCallback(
    (shouldRestorePrompt?: boolean) => {
      if (shouldRestorePrompt) {
        const lastUserMessage = lastSubmittedPromptRef.current;
        if (lastUserMessage) {
          buffer.setText(lastUserMessage);
        }
      } else {
        buffer.setText('');
      }
    },
    [buffer, lastSubmittedPromptRef],
  );

  // Update the cancel handler with message queue support.
  // The handler is stored in a ref to avoid stale closures, and the assignment
  // is deferred to useEffect to avoid mutating a ref during render.
  const cancelHandler = useCallback(
    (shouldRestorePrompt?: boolean) => {
      if (isToolExecuting(pendingHistoryItems)) {
        buffer.setText('');
        return;
      }

      if (shouldRestorePrompt) {
        const lastUserMessage = lastSubmittedPromptRef.current;
        if (lastUserMessage) {
          buffer.setText(lastUserMessage);
        }
      } else {
        buffer.setText('');
      }
    },
    [buffer, pendingHistoryItems, lastSubmittedPromptRef],
  );

  // useLayoutEffect ensures the ref is updated synchronously after render,
  // before any event handlers can read it (avoids one-render stale window).
  useLayoutEffect(() => {
    cancelHandlerRef.current = cancelHandler;
  }, [cancelHandlerRef, cancelHandler]);

  const handleFinalSubmit = useCallback(
    (submittedValue: string) => {
      const trimmedValue = submittedValue.trim();
      if (trimmedValue.length > 0) {
        // Slash commands always pass through regardless of MCP readiness.
        if (!isSlashCommand(trimmedValue) && !isMcpReady) {
          addMessage(trimmedValue);
          inputHistoryStore.addInput(trimmedValue);
          lastSubmittedPromptRef.current = trimmedValue;
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

        // Capture synchronously before async state updates (prevents race condition on restore)
        lastSubmittedPromptRef.current = trimmedValue;
        // Add to independent input history
        inputHistoryStore.addInput(trimmedValue);
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        submitQuery(trimmedValue);
      }
    },
    [
      submitQuery,
      inputHistoryStore,
      hadToolCallsRef,
      todoContinuationRef,
      lastSubmittedPromptRef,
      isMcpReady,
      addMessage,
    ],
  );

  return {
    handleUserCancel,
    handleFinalSubmit,
    cancelHandlerRef,
  };
}
