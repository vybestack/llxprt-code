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
  allowedTools: readonly string[];
  disabledTools: readonly string[];
  shellMode: 'allowlist' | 'all' | 'none';
  approvalCeiling: 'yolo' | 'standard' | 'strict';
};

/**
 * Identity of the agent a turn is routed to.
 */
export type AgentRoutingTarget = {
  agentId: string;
  parentAgentId?: string;
};

/**
 * Identity of a single agent turn.
 */
export type TurnContext = {
  target: AgentRoutingTarget;
  profileRevision: number;
  startedAt: number;
};

/**
 * Routing identity for a single provider call within a turn.
 */
export type ProviderCallContext = {
  turn: TurnContext;
  providerName: string;
  model: string;
  capturedPolicy: ToolPolicySnapshot;
};

/**
 * Routing identity for a single tool invocation within a turn.
 */
export type ToolInvocationContext = {
  turn: TurnContext;
  toolId: string;
  capturedPolicy: ToolPolicySnapshot;
  background: boolean;
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
  return deepFreeze({ target, profileRevision, startedAt });
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
  return deepFreeze({ turn, providerName, model, capturedPolicy });
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
  return deepFreeze({ turn, toolId, capturedPolicy, background });
}
