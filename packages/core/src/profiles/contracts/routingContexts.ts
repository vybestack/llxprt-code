/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Immutable routing records that carry runtime identity explicitly through
 * Agent/Turn/ProviderCall/ToolInvocation instead of ambient globals.
 *
 * Each factory returns a deep-frozen record: nothing that captured a context can mutate
 * it, so in-flight work keeps its policy snapshot even when the profile transitions to a
 * new revision mid-turn.
 */

/**
 * Policy surface captured at a routing decision point.
 */
export type ToolPolicySnapshot = {
  readonly allowedTools: readonly string[];
  readonly disabledTools: readonly string[];
  readonly shellMode: 'allowlist' | 'all' | 'none';
  readonly approvalCeiling: 'yolo' | 'standard' | 'strict';
};

/**
 * Identity of the agent a turn is routed to.
 */
export type AgentRoutingTarget = {
  readonly agentId: string;
  readonly parentAgentId?: string;
};

/**
 * Identity of a single agent turn.
 */
export type TurnContext = {
  readonly target: AgentRoutingTarget;
  readonly profileRevision: number;
  readonly startedAt: number;
};

/**
 * Routing identity for a single provider call within a turn.
 */
export type ProviderCallContext = {
  readonly turn: TurnContext;
  readonly providerName: string;
  readonly model: string;
  readonly capturedPolicy: ToolPolicySnapshot;
};

/**
 * Routing identity for a single tool invocation within a turn.
 */
export type ToolInvocationContext = {
  readonly turn: TurnContext;
  readonly toolId: string;
  readonly capturedPolicy: ToolPolicySnapshot;
  readonly background: boolean;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Recursively freeze a value: every nested plain object and array becomes frozen.
 */
export function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
  } else if (isObject(value)) {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze(value[key]);
    }
  }
  return Object.freeze(value);
}

/**
 * Build a deep-frozen turn context.
 */
export function createTurnContext(
  target: AgentRoutingTarget,
  profileRevision: number,
  startedAt: number,
): TurnContext {
  return deepFreeze(structuredClone({ target, profileRevision, startedAt }));
}

/**
 * Build a deep-frozen provider call context.
 */
export function createProviderCallContext(
  turn: TurnContext,
  providerName: string,
  model: string,
  capturedPolicy: ToolPolicySnapshot,
): ProviderCallContext {
  return deepFreeze(
    structuredClone({ turn, providerName, model, capturedPolicy }),
  );
}

/**
 * Build a deep-frozen tool invocation context.
 */
export function createToolInvocationContext(
  turn: TurnContext,
  toolId: string,
  capturedPolicy: ToolPolicySnapshot,
  background: boolean,
): ToolInvocationContext {
  return deepFreeze(
    structuredClone({ turn, toolId, capturedPolicy, background }),
  );
}
