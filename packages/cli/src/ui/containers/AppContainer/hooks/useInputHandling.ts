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

export interface UseInputHandlingParams {
  buffer: TextBuffer;
  inputHistoryStore: Pick<UseInputHistoryStoreReturn, 'addInput'>;
  submitQuery: (query: string) => Promise<void>;
  pendingHistoryItems: HistoryItemWithoutId[];
  lastSubmittedPromptRef: React.MutableRefObject<string | null>;
  /** Whether the user needs to re-authenticate before continuing. */
  needsRelogin: boolean;
  /** Opens the auth dialog when a submit is deferred for re-login. */
  openAuthDialog: () => void;
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
export function isToolExecuting(
  pendingHistoryItems: HistoryItemWithoutId[],
): boolean {
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
  needsRelogin,
  openAuthDialog,
}: UseInputHandlingParams): (submittedValue: string) => void {
  return useCallback(
    (submittedValue: string) => {
      const trimmedValue = submittedValue.trim();
      if (trimmedValue.length === 0) return;

      const isCommand = isSlashCommand(trimmedValue);
      if (!isCommand && needsRelogin) {
        openAuthDialog();
        captureDeferredPrompt(
          trimmedValue,
          inputHistoryStore,
          lastSubmittedPromptRef,
        );
        return;
      }

      lastSubmittedPromptRef.current = trimmedValue;
      inputHistoryStore.addInput(trimmedValue);
      void submitQuery(trimmedValue);
    },
    [
      submitQuery,
      inputHistoryStore,
      lastSubmittedPromptRef,
      needsRelogin,
      openAuthDialog,
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
