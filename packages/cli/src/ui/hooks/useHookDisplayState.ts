/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { MessageBusType } from '@vybestack/llxprt-code-core';
import type { MessageBus } from '@vybestack/llxprt-code-core';
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
      return;
    }

    const requestSubscription = messageBus.subscribe(
      MessageBusType.HOOK_EXECUTION_REQUEST,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (message: any) => {
        const payload = message.payload as
          | { eventName?: string; correlationId?: string }
          | undefined;
        if (payload?.eventName) {
          setActiveHooks((prev) => [
            ...prev,
            {
              name: payload.eventName,
              eventName: payload.eventName,
              correlationId: payload.correlationId,
            },
          ]);
        }
      },
    );

    const responseSubscription = messageBus.subscribe(
      MessageBusType.HOOK_EXECUTION_RESPONSE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (message: any) => {
        const payload = message.payload as
          | { correlationId?: string }
          | undefined;
        const corrId = payload?.correlationId;
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
