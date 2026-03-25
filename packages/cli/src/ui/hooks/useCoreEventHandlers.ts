/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @hook useCoreEventHandlers
 * @description Bridge core event system to UI
 * @inputs handleNewMessage, config, recordingIntegrationRef
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
  type RecordingIntegration,
  type Config,
} from '@vybestack/llxprt-code-core';
import { ConsolePatcher } from '../utils/ConsolePatcher.js';
import { registerCleanup } from '../../utils/cleanup.js';
import type { ConsoleMessageItem } from '../types.js';

interface UseCoreEventHandlersOptions {
  handleNewMessage: (message: ConsoleMessageItem) => void;
  config: Config;
  recordingIntegrationRef: React.MutableRefObject<RecordingIntegration | null>;
}

export function useCoreEventHandlers({
  handleNewMessage,
  config,
  recordingIntegrationRef,
}: UseCoreEventHandlersOptions): void {
  // Handle core event system for surfacing internal errors
  useEffect(() => {
    const handleUserFeedback = (payload: UserFeedbackPayload) => {
      const messageType =
        payload.severity === 'error'
          ? 'error'
          : payload.severity === 'warning'
            ? 'warn'
            : 'info';
      handleNewMessage({
        type: messageType,
        content: payload.message,
        count: 1,
      });
      if (payload.severity === 'error' || payload.severity === 'warning') {
        recordingIntegrationRef.current?.recordSessionEvent(
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
  }, [handleNewMessage, recordingIntegrationRef]);

  useEffect(() => {
    const consolePatcher = new ConsolePatcher({
      onNewMessage: handleNewMessage,
      debugMode: config.getDebugMode(),
    });
    consolePatcher.patch();
    registerCleanup(consolePatcher.cleanup);
  }, [handleNewMessage, config]);
}
