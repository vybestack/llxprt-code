/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback } from 'react';

interface UseClearScreenActionParams {
  clearItems: () => void;
  clearConsoleMessagesState: () => void;
  useAlternateBuffer: boolean;
  refreshStatic: () => void;
}

/**
 * @hook useClearScreenAction
 * @description Provides clear-screen action with history and console reset
 * @inputs clearItems, clearConsoleMessagesState, useAlternateBuffer, refreshStatic
 * @outputs handleClearScreen callback
 */
export function useClearScreenAction({
  clearItems,
  clearConsoleMessagesState,
  useAlternateBuffer,
  refreshStatic,
}: UseClearScreenActionParams): () => void {
  return useCallback(() => {
    clearItems();
    clearConsoleMessagesState();
    if (!useAlternateBuffer) {
      // eslint-disable-next-line no-console
      console.clear();
    }
    refreshStatic();
  }, [
    clearItems,
    clearConsoleMessagesState,
    refreshStatic,
    useAlternateBuffer,
  ]);
}
