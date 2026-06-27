/**
 * @plan:PLAN-20260608-ISSUE1585.P05
 * @requirement:REQ-API-001, REQ-INTERFACE-OWNERSHIP
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Package-local ToolContext interface.
 *
 * Provides a narrow execution context for tools — not a service bag.
 * Tools receive context through constructor injection, not by pulling
 * arbitrary services from a bag.
 *
 * Self-contained with zero core imports.
 */

/** Narrow execution context passed to tools. */
export interface ToolContext {
  /** Unique session identifier. */
  sessionId: string;
  /** Optional agent identifier for subagent contexts. */
  agentId?: string;
  /** Whether the tool is running in interactive mode. */
  interactiveMode?: boolean;
}

/** Interface for tools that accept execution context. */
export interface ContextAwareTool {
  context?: ToolContext;
}

/** Type guard: does the given tool accept an execution context? */
export function isContextAwareTool(tool: object): tool is ContextAwareTool {
  return 'context' in tool;
}
