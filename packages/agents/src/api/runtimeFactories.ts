/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260629-ISSUE2204.P01
 * @requirement:REQ-2204-001
 *
 * Curated public factories for the agent runtime construction primitives the
 * CLI (and other non-CLI clients) need at composition time: the agent-client
 * factory, the tool-scheduler factory, the task-tool registration descriptor,
 * and the multi-turn agentic loop.
 *
 * Exposing these as PUBLIC functions/types means consumers no longer import
 * the internal `AgentClient`, `CoreToolScheduler`, `createTaskToolRegistration`,
 * or concrete `AgenticLoop` class from the package root — they call a curated
 * public helper instead (#2204).
 */

import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type {
  ToolSchedulerFactory,
  ToolSchedulerContract,
} from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import type {
  TaskToolArgs,
  TaskToolRegistration,
} from '@vybestack/llxprt-code-core/config/toolRegistryFactory.js';
import { AgentClient } from '../core/client.js';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';
import { TaskTool } from '../tools/task.js';
import { AgenticLoop } from '../core/agenticLoop/index.js';
import type {
  AgenticLoopMessage,
  AgenticLoopOptions,
} from '../core/agenticLoop/index.js';
import type {
  AgenticLoopEvent,
  ApprovalHandler as AgenticLoopApprovalHandler,
  DisplayCallbacks,
} from '../core/agenticLoop/types.js';

/**
 * A descriptor the composition root (the CLI bootstrap) registers with the
 * providers package's dependency-inversion seam (`registerAgentRuntimeFactories`)
 * so the providers package can construct agent-owned primitives without a
 * providers→agents dependency cycle.
 *
 * This is a structural re-declaration of the providers-owned
 * `AgentRuntimeFactoryBindings` interface, expressed purely in terms of
 * core-owned contract types so this module has no providers dependency. The
 * shapes are identical and structurally compatible.
 */
export interface AgentRuntimeFactoryBindings {
  agentClientFactory: (
    config: Config,
    runtimeState: AgentRuntimeState,
  ) => AgentClientContract;
  toolSchedulerFactory: ToolSchedulerFactory;
  taskToolRegistration: () => TaskToolRegistration;
}

function assertConfig(
  value: unknown,
  context: string,
): asserts value is Config {
  if (!(value instanceof Config)) {
    throw new TypeError(`${context}: expected Config instance`);
  }
}

/**
 * Builds the {@link AgentRuntimeFactoryBindings} descriptor wiring the
 * agents-owned concrete primitives (AgentClient, CoreToolScheduler,
 * TaskToolRegistration) behind the core-owned contract types.
 *
 * Consumers that need to register agent runtime factories with a runtime
 * composition seam call this once at bootstrap and pass the result to that
 * seam — they never import the concrete classes directly (#2204).
 */
export function createAgentRuntimeFactoryBindings(): AgentRuntimeFactoryBindings {
  return {
    agentClientFactory: (config, runtimeState) =>
      new AgentClient(config, runtimeState),
    toolSchedulerFactory: (options) => new CoreToolScheduler(options),
    taskToolRegistration: () => createTaskRegistration(),
  };
}

/**
 * Constructs an agents-owned {@link AgentClientContract} for a detached
 * (subagent) context. Callers that previously `new AgentClient(config, state)`
 * directly call this helper instead so they do not couple to the concrete
 * class (#2204).
 */
export function createAgentClient(
  config: Config,
  runtimeState: AgentRuntimeState,
): AgentClientContract {
  return new AgentClient(config, runtimeState);
}

/**
 * Constructs an agents-owned {@link ToolSchedulerContract}. Callers that
 * previously `new CoreToolScheduler(options)` directly call this helper
 * instead so they do not couple to the concrete class (#2204).
 */
export function createToolScheduler(
  options: Parameters<ToolSchedulerFactory>[0],
): ToolSchedulerContract {
  return new CoreToolScheduler(options);
}

/**
 * Creates the task-tool registration descriptor. Callers that previously
 * imported the internal `createTaskToolRegistration` symbol call this helper
 * instead (#2204).
 */
export function createTaskRegistration(): TaskToolRegistration {
  return {
    toolClass: TaskTool,
    className: 'TaskTool',
    staticName: TaskTool.Name,
    buildArgs(config: unknown, taskToolArgs: TaskToolArgs): unknown[] {
      assertConfig(config, 'TaskToolRegistration.buildArgs');
      return [config, taskToolArgs];
    },
    create(config: unknown, taskToolArgs: TaskToolArgs) {
      assertConfig(config, 'TaskToolRegistration.create');
      return new TaskTool(config, taskToolArgs);
    },
  };
}

// Re-export the agentic-loop public surface so consumers construct the loop
// via the curated api barrel rather than importing the concrete class.
export type {
  AgenticLoopEvent,
  AgenticLoopMessage,
  AgenticLoopOptions,
  AgenticLoopApprovalHandler,
  DisplayCallbacks,
};

/** Public runner contract returned by {@link createAgenticLoop}. */
export interface AgenticLoopRunner {
  run(
    message: AgenticLoopMessage,
    signal: AbortSignal,
    promptId?: string,
  ): AsyncGenerator<AgenticLoopEvent>;
}

/**
 * Constructs an {@link AgenticLoopRunner}. Callers that previously
 * `new AgenticLoop(options)` directly call this helper instead so they do not
 * couple to the concrete class via the internals barrel (#2204).
 */
export function createAgenticLoop(
  options: AgenticLoopOptions,
): AgenticLoopRunner {
  return new AgenticLoop(options);
}
