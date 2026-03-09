/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { type Config, MessageBusType } from '@vybestack/llxprt-code-core';
import type { ActiveHook } from '../types.js';

/**
 * Hook to track actively executing hooks for UI display.
 * Subscribes to MessageBus HOOK_EXECUTION_REQUEST/RESPONSE events.
 */
export function useHookDisplayState(config: Config): ActiveHook[] {
  const [activeHooks, setActiveHooks] = useState<ActiveHook[]>([]);

  useEffect(() => {
    const messageBus = config.getMessageBus?.();
    if (!messageBus) {
      return;
    }

    const requestSubscription = messageBus.subscribe(
      MessageBusType.HOOK_EXECUTION_REQUEST,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (message: any) => {
        const payload = message.payload as { eventName?: string } | undefined;
        if (payload?.eventName) {
          setActiveHooks((prev) => [
            ...prev,
            {
              name: payload.eventName,
              eventName: payload.eventName,
            },
          ]);
        }
      },
    );

    const responseSubscription = messageBus.subscribe(
      MessageBusType.HOOK_EXECUTION_RESPONSE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (message: any) => {
        const payload = message.payload;
        if ((payload as { correlationId?: string })?.correlationId) {
          // Remove the oldest hook with matching eventName
          // (simple FIFO strategy since we don't have correlation tracking)
          setActiveHooks((prev) => {
            if (prev.length > 0) {
              return prev.slice(1);
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
  }, [config]);

  return activeHooks;
}
