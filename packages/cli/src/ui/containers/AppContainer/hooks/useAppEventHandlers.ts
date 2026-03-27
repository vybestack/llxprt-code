/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';
import { appEvents, AppEvent } from '../../../../utils/events.js';

interface UseAppEventHandlersParams {
  handleNewMessage: (message: {
    type: 'error' | 'warn' | 'info' | 'debug';
    content: string;
    count: number;
  }) => void;
  setShowErrorDetails: (value: boolean) => void;
  setConstrainHeight: (value: boolean) => void;
}

/**
 * @hook useAppEventHandlers
 * @description Bridges AppEvent bus events to UI state updates
 * @inputs handleNewMessage, setShowErrorDetails, setConstrainHeight
 * @outputs void
 * @sideEffects AppEvent subscriptions
 * @cleanup Removes event listeners on unmount
 */
export function useAppEventHandlers({
  handleNewMessage,
  setShowErrorDetails,
  setConstrainHeight,
}: UseAppEventHandlersParams): void {
  useEffect(() => {
    const openDebugConsole = () => {
      setShowErrorDetails(true);
      setConstrainHeight(false);
    };

    const logErrorHandler = (errorMessage: unknown) => {
      handleNewMessage({
        type: 'error',
        content: String(errorMessage),
        count: 1,
      });
    };

    appEvents.on(AppEvent.OpenDebugConsole, openDebugConsole);
    appEvents.on(AppEvent.LogError, logErrorHandler);

    return () => {
      appEvents.off(AppEvent.OpenDebugConsole, openDebugConsole);
      appEvents.off(AppEvent.LogError, logErrorHandler);
    };
  }, [handleNewMessage, setConstrainHeight, setShowErrorDetails]);
}
