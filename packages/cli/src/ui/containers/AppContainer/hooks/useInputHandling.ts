/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef } from 'react';
import type { TextBuffer } from '../../../components/shared/text-buffer.js';
import type { UseInputHistoryStoreReturn } from '../../../hooks/useInputHistoryStore.js';
import type { HistoryItemWithoutId } from '../../../types.js';
import { ToolCallStatus } from '../../../types.js';

/**
 * @hook useInputHandling
 * @description Cancel handler and final submit logic
 * @inputs buffer, inputHistoryStore, submitQuery, pendingHistoryItems, lastSubmittedPromptRef, hadToolCallsRef, todoContinuationRef
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
}: UseInputHandlingParams): UseInputHandlingResult {
  const cancelHandlerRef = useRef<
    ((shouldRestorePrompt?: boolean) => void) | null
  >(null);

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

  // Update the cancel handler with message queue support
  cancelHandlerRef.current = useCallback(
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

  const handleFinalSubmit = useCallback(
    (submittedValue: string) => {
      const trimmedValue = submittedValue.trim();
      if (trimmedValue.length > 0) {
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
    ],
  );

  return {
    handleUserCancel,
    handleFinalSubmit,
    cancelHandlerRef,
  };
}
