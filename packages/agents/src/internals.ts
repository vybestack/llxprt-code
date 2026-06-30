/**
 * @plan:PLAN-20260617-COREAPI.P07
 * @requirement:REQ-018
 *
 * Power-user / low-level subpath barrel.
 *
 * This module is the SINGLE SOURCE of the low-level re-export surface. The
 * package top-level (`index.ts`) re-exports everything here via
 * `export * from './internals.js'` so that the top-level and the
 * `./internals.js` subpath expose the EXACT SAME low-level symbols (no
 * duplication drift). #1595 will migrate CLI/a2a consumers to this subpath and
 * then remove the low-level re-exports from the top-level, leaving only the
 * curated public Agent API at the package root.
 *
 * `createTaskToolRegistration` is intentionally NOT re-exported here: it is
 * app-glue (a factory function), not a power-user primitive, and re-exporting
 * it from internals.ts would create a circular dependency (internals.ts ←
 * index.ts). It remains exported solely from index.ts.
 *
 * Name-collision note: `ModelInfo`, `ChatCompressionInfo`, and
 * `StructuredError` are re-exported by BOTH this barrel (via
 * `./core/turn.js`) and the public api barrel (via
 * `./api/event-types.ts`). Because both paths trace back to the SAME source
 * module (`@vybestack/llxprt-code-core/core/turn.js`), TypeScript deduplicates
 * them at `export *` boundaries — no explicit disambiguation is required.
 *
 * Non-breaking proof: every symbol that `index.ts` exported at HEAD is
 * re-exported below (verified via `git show HEAD:packages/agents/src/index.ts`).
 * No top-level symbol was removed.
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export { AgentClient, PostTurnAction } from './core/client.js';
export {
  ChatSession,
  StreamEventType,
  InvalidStreamError,
  type StreamEvent,
} from './core/chatSession.js';
export * from './core/ChatSessionFactory.js';
export { CoreToolScheduler } from './core/coreToolScheduler.js';
export { getTokenLimitForConfiguredContext } from './core/contextLimitResolver.js';
export { executeToolCall } from './core/nonInteractiveToolExecutor.js';
export { SubagentOrchestrator } from './core/subagentOrchestrator.js';
export { TaskTool } from './tools/task.js';
export type { TaskToolDependencies, TaskToolParams } from './tools/task.js';
export * from './core/turn.js';
export * from './core/subagent.js';
export * from './core/subagentExecution.js';
export * from './core/subagentRuntimeSetup.js';
export * from './core/subagentToolProcessing.js';
export * from './core/subagentScheduler.js';
export {
  buildToolGovernance,
  isToolBlocked,
  type ToolGovernance,
  type ToolGovernanceConfig,
} from './core/toolGovernance.js';
export * from './compression/index.js';
export * from './agents/types.js';
export * from './agents/invocation.js';
export * from './agents/executor.js';
export * from './core/agenticLoop/index.js';
