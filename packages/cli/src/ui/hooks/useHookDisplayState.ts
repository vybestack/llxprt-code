/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import type { AgentHookControl } from '@vybestack/llxprt-code-agents';
import type { ActiveHook } from '../types.js';

/**
 * Hook to track actively executing hooks for UI display.
 * Observes correlated execution phases from the hook owner.
 */
/**
 * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
 * @requirement REQ-D01-002
 * @requirement REQ-D01-003
 * @pseudocode lines 122-133
 */
export function useHookDisplayState(
  subscribeExecutionPhase?: AgentHookControl['subscribeExecutionPhase'],
): ActiveHook[] {
  const [activeHooks, setActiveHooks] = useState<ActiveHook[]>([]);

  useEffect(() => {
    if (!subscribeExecutionPhase) return undefined;
    return subscribeExecutionPhase((phase) => {
      const { correlationId } = phase;
      if (phase.phase === 'start') {
        const { eventName } = phase;
        if (eventName)
          setActiveHooks((prev) => [
            ...prev,
            { name: eventName, eventName, correlationId },
          ]);
      } else {
        setActiveHooks((prev) => {
          const idx = prev.findIndex(
            (hook) => hook.correlationId === correlationId,
          );
          return idx >= 0
            ? [...prev.slice(0, idx), ...prev.slice(idx + 1)]
            : prev;
        });
      }
    });
  }, [subscribeExecutionPhase]);

  return activeHooks;
}
