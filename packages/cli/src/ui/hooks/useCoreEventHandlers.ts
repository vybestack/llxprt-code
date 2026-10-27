/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @hook useCoreEventHandlers
 * @description Bridge core event system to UI
 * @inputs handleNewMessage, uiRuntime, recordingIntegrationRef
 * @outputs void
 * @sideEffects Multiple event subscriptions
 * @cleanup Unsubscribes all listeners on unmount
 * @strictMode Safe - all cleanups run on unmounts
 * @subscriptionStrategy Stable (refs for handler freshness)
 */

import { useEffect, type MutableRefObject } from 'react';
import {
  coreEvents,
  CoreEvent,
  type UserFeedbackPayload,
  type RecordingIntegration,
} from '@vybestack/llxprt-code-core';
import { ConsolePatcher } from '../utils/ConsolePatcher.js';
import { registerCleanup } from '../../utils/cleanup.js';
import type { ConsoleMessageItem } from '../types.js';
import type { UiRuntime } from '../cliUiRuntime.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { appendJournalUiItem } from './command-journal-output.js';

interface UseCoreEventHandlersOptions {
  handleNewMessage: (message: ConsoleMessageItem) => void;
  uiRuntime: UiRuntime;
  recordingIntegrationRef?: MutableRefObject<RecordingIntegration | null>;
  recordingOwner?: 'agent' | 'raw';
  agent?: Agent;
}

export function useCoreEventHandlers({
  handleNewMessage,
  uiRuntime,
  recordingIntegrationRef,
  recordingOwner,
  agent,
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
      if (recordingOwner === 'agent') {
        if (!agent) throw new Error('Session agent is unavailable');
        void appendJournalUiItem(agent, {
          type: payload.severity,
          text: payload.message,
        }).catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          handleNewMessage({
            type: 'error',
            content: `Failed to record session event: ${reason}`,
            count: 1,
          });
        });
        return;
      }
      handleNewMessage({
        type: messageType,
        content: payload.message,
        count: 1,
      });
      if (payload.severity === 'error' || payload.severity === 'warning') {
        recordingIntegrationRef?.current?.recordSessionEvent(
          payload.severity,
          payload.message,
        );
      }
    };

    coreEvents.on(CoreEvent.UserFeedback, handleUserFeedback);
    coreEvents.drainFeedbackBacklog();

    return () => {
      coreEvents.off(CoreEvent.UserFeedback, handleUserFeedback);
    };
  }, [handleNewMessage, recordingIntegrationRef, recordingOwner, agent]);

  useEffect(() => {
    const consolePatcher = new ConsolePatcher({
      onNewMessage: handleNewMessage,
      debugMode: uiRuntime.app.getDebugMode(),
    });
    consolePatcher.patch();
    // registerCleanup handles process.exit; React return handles unmount.
    // cleanup() is idempotent, so double invocation is safe.
    registerCleanup(consolePatcher.cleanup);
    return () => consolePatcher.cleanup();
  }, [handleNewMessage, uiRuntime]);
}
