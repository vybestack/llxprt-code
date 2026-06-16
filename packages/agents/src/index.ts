/**
 * @plan:PLAN-20260610-ISSUE1592.P02
 * @requirement:REQ-PKG-001
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  TaskToolArgs,
  TaskToolRegistration,
} from '@vybestack/llxprt-code-core/config/toolRegistryFactory.js';
import { TaskTool } from './tools/task.js';

export { AgentClient, PostTurnAction } from './core/client.js';
export {
  ChatSession,
  StreamEventType,
  InvalidStreamError,
  type StreamEvent,
} from './core/chatSession.js';
export * from './core/ChatSessionFactory.js';
export { CoreToolScheduler } from './core/coreToolScheduler.js';
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

/**
 * @plan PLAN-20260610-ISSUE1592.P03
 * @requirement REQ-INV-003
 *
 * Creates the core-owned TaskToolRegistration descriptor without requiring core
 * to import the concrete agents-owned TaskTool class.
 */
export function createTaskToolRegistration(): TaskToolRegistration {
  return {
    toolClass: TaskTool,
    className: 'TaskTool',
    staticName: TaskTool.Name,
    buildArgs(config: unknown, taskToolArgs: TaskToolArgs): unknown[] {
      return [config, taskToolArgs];
    },
    create(config: unknown, taskToolArgs: TaskToolArgs) {
      return new TaskTool(config as Config, taskToolArgs);
    },
  };
}
