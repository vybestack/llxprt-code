/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import {
  MessageBusType,
  type MessageBus,
  type HookExecutionRequest,
  type HookExecutionResponse,
} from '@vybestack/llxprt-code-core';
import type { ActiveHook } from '../types.js';

/**
 * Hook to track actively executing hooks for UI display.
 * Subscribes to MessageBus HOOK_EXECUTION_REQUEST/RESPONSE events.
 */
/**
 * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
 * @requirement REQ-D01-002
 * @requirement REQ-D01-003
 * @pseudocode lines 122-133
 */
export function useHookDisplayState(messageBus?: MessageBus): ActiveHook[] {
  const [activeHooks, setActiveHooks] = useState<ActiveHook[]>([]);

  useEffect(() => {
    if (!messageBus) {
      return undefined;
    }

    const requestSubscription = messageBus.subscribe(
      MessageBusType.HOOK_EXECUTION_REQUEST,
      (message: HookExecutionRequest) => {
        const { eventName, correlationId } = message.payload;
        if (eventName) {
          setActiveHooks((prev) => [
            ...prev,
            {
              name: eventName,
              eventName,
              correlationId,
            },
          ]);
        }
      },
    );

    const responseSubscription = messageBus.subscribe(
      MessageBusType.HOOK_EXECUTION_RESPONSE,
      (message: HookExecutionResponse) => {
        const corrId = message.payload.correlationId;
        if (corrId) {
          setActiveHooks((prev) => {
            const idx = prev.findIndex((h) => h.correlationId === corrId);
            if (idx >= 0) {
              return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
            }
            return prev;
          });
        }
      },
    );

    return () => {
      requestSubscription();
      responseSubscription();
    };
  }, [messageBus]);

  return activeHooks;
}
