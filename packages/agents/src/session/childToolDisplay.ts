/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentDisplayCallbacks } from '../api/agent.js';

export type ChildToolDisplayCallbacks = {
  [K in keyof AgentDisplayCallbacks]?: (
    executionId: symbol,
    ...args: Parameters<NonNullable<AgentDisplayCallbacks[K]>>
  ) => ReturnType<NonNullable<AgentDisplayCallbacks[K]>>;
};

export class ChildToolDisplay {
  private readonly observers = new Set<ChildToolDisplayCallbacks>();

  subscribe(callbacks: ChildToolDisplayCallbacks): () => void {
    this.observers.add(callbacks);
    return () => {
      this.observers.delete(callbacks);
    };
  }

  clear(): void {
    this.observers.clear();
  }

  open(): AgentDisplayCallbacks {
    const id = Symbol('child-execution');
    return {
      outputUpdateHandler: (callId, update) => {
        for (const observer of this.observers)
          observer.outputUpdateHandler?.(id, callId, update);
      },
      onToolCallsUpdate: (calls) => {
        for (const observer of this.observers)
          observer.onToolCallsUpdate?.(id, calls);
      },
      onAllToolCallsComplete: async (calls) => {
        for (const observer of this.observers)
          await observer.onAllToolCallsComplete?.(id, calls);
      },
    };
  }
}
