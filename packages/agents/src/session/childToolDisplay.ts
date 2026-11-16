/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolScriptEventPayload } from '@vybestack/llxprt-code-core';
import type { AgentDisplayCallbacks } from '../api/agent.js';

export type ChildToolDisplayCallbacks = {
  [K in keyof AgentDisplayCallbacks]?: (
    executionId: symbol,
    ...args: Parameters<NonNullable<AgentDisplayCallbacks[K]>>
  ) => ReturnType<NonNullable<AgentDisplayCallbacks[K]>>;
} & {
  /**
   * Operational records of code mode script runs (issue #4084): one
   * `started`, one `call` per nested call, one `finished`. Serializable;
   * the session recording stores them for resume.
   */
  readonly onToolScriptEvent?: (event: ToolScriptEventPayload) => void;
};

export interface ChildToolDisplaySubscription {
  /**
   * The subscriber renders a waiting child call's confirmation and answers
   * it through the call's own `onConfirm` (the interactive CLI does). Code
   * mode lets a nested call wait for approval only when some subscriber, or
   * the session's approval handler, can answer it.
   */
  readonly answersApprovals?: boolean;
}

/**
 * Observes child executions (subagent tools, code mode nested calls) and
 * code mode script records. Pass `answersApprovals: true` only when the
 * subscriber renders a waiting child call's confirmation and answers it;
 * code mode lets a nested call wait for approval only then (#4084).
 */
export type SubscribeChildTools = (
  callbacks: ChildToolDisplayCallbacks,
  options?: ChildToolDisplaySubscription,
) => () => void;

export class ChildToolDisplay {
  private readonly observers = new Map<
    ChildToolDisplayCallbacks,
    ChildToolDisplaySubscription
  >();

  subscribe(
    callbacks: ChildToolDisplayCallbacks,
    options: ChildToolDisplaySubscription = {},
  ): () => void {
    this.observers.set(callbacks, options);
    return () => {
      this.observers.delete(callbacks);
    };
  }

  clear(): void {
    this.observers.clear();
  }

  answersApprovals(): boolean {
    for (const options of this.observers.values())
      if (options.answersApprovals === true) return true;
    return false;
  }

  publishToolScriptEvent(event: ToolScriptEventPayload): void {
    for (const observer of [...this.observers.keys()])
      observer.onToolScriptEvent?.(event);
  }

  open(): AgentDisplayCallbacks {
    const id = Symbol('child-execution');
    return {
      outputUpdateHandler: (callId, update) => {
        for (const observer of this.observers.keys())
          observer.outputUpdateHandler?.(id, callId, update);
      },
      onToolCallsUpdate: (calls) => {
        for (const observer of this.observers.keys())
          observer.onToolCallsUpdate?.(id, calls);
      },
      onAllToolCallsComplete: async (calls) => {
        for (const observer of [...this.observers.keys()])
          await observer.onAllToolCallsComplete?.(id, calls);
      },
    };
  }
}
