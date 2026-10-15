/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @hook useCoreEventHandlers
 * @description Bridge core event system to UI
 * @inputs handleNewMessage, readDebugMode, recordFeedback
 * @outputs void
 * @sideEffects Multiple event subscriptions
 * @cleanup Unsubscribes all listeners on unmount
 * @strictMode Safe - all cleanups run on unmounts
 * @subscriptionStrategy Stable (refs for handler freshness)
 */

import { useEffect } from 'react';
import {
  coreEvents,
  CoreEvent,
  type UserFeedbackPayload,
} from '@vybestack/llxprt-code-core';
import { ConsolePatcher } from '../utils/ConsolePatcher.js';
import { registerCleanup } from '../../utils/cleanup.js';
import type { ConsoleMessageItem } from '../types.js';

interface UseCoreEventHandlersOptions {
  handleNewMessage: (message: ConsoleMessageItem) => void;
  readDebugMode: () => boolean;
  recordFeedback: (
    severity: 'warning' | 'error',
    message: string,
  ) => void | Promise<void>;
}

export function useCoreEventHandlers({
  handleNewMessage,
  readDebugMode,
  recordFeedback,
}: UseCoreEventHandlersOptions): void {
  // Handle core event system for surfacing internal errors
  useEffect(() => {
    const handleUserFeedback = (payload: UserFeedbackPayload) => {
      let messageType: 'error' | 'warn' | 'info';
      if (payload.severity === 'error') {
        messageType = 'error';
      } else if (payload.severity === 'warning') {
        messageType = 'warn';
      } else {
        messageType = 'info';
      }
      handleNewMessage({
        type: messageType,
        content: payload.message,
        count: 1,
      });
      if (payload.severity === 'error' || payload.severity === 'warning') {
        Promise.resolve(
          recordFeedback(payload.severity, payload.message),
        ).catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          handleNewMessage({
            type: 'error',
            content: `Failed to record session event: ${reason}`,
            count: 1,
          });
        });
      }
    };

    coreEvents.on(CoreEvent.UserFeedback, handleUserFeedback);
    coreEvents.drainFeedbackBacklog();

    return () => {
      coreEvents.off(CoreEvent.UserFeedback, handleUserFeedback);
    };
  }, [handleNewMessage, recordFeedback]);

  useEffect(() => {
    const consolePatcher = new ConsolePatcher({
      onNewMessage: handleNewMessage,
      debugMode: readDebugMode(),
    });
    consolePatcher.patch();
    // registerCleanup handles process.exit; React return handles unmount.
    // cleanup() is idempotent, so double invocation is safe.
    registerCleanup(consolePatcher.cleanup);
    return () => consolePatcher.cleanup();
  }, [handleNewMessage, readDebugMode]);
}
