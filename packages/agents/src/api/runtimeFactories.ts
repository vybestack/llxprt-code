/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';

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

import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { withChildToolDisplay } from '../session/childToolAssembly.js';
import { ChildToolDisplay } from '../session/childToolDisplay.js';
import type { SchedulerConstruction } from '../session/assembleSchedulerOwner.js';
import type { TaskLaunchOwner } from '../session/task-launch-owner.js';
import { ShellJobOwner } from '../session/shell-job-owner.js';
import { LoopRunLifetime } from './loop-run-lifetime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { TaskToolRegistration } from '@vybestack/llxprt-code-core/config/toolRegistryFactory.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type {
  ToolSchedulerContract,
  ToolSchedulerFactory,
} from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';

import type {
  AgenticLoopMessage,
  AgenticLoopOptions,
} from '../core/agenticLoop/index.js';
import { AgenticLoop } from '../core/agenticLoop/index.js';
import type {
  ApprovalHandler as AgenticLoopApprovalHandler,
  AgenticLoopEvent,
  DisplayCallbacks,
} from '../core/agenticLoop/types.js';
import { CoreToolScheduler } from '../core/coreToolScheduler.js';

import { TaskTool, type TaskToolDependencies } from '../tools/task.js';
import { buildAgentClientFactory } from './agentBootstrap.js';

export { TaskLaunchOwner } from '../session/task-launch-owner.js';

/**
 * Constructs an agents-owned {@link AgentClientContract} for a detached
 * (subagent) context. Callers that previously `new AgentClient(config, state)`
 * directly call this helper instead so they do not couple to the concrete
 * class (#2204).
 */
export function createAgentClient(
  config: Config,
  runtimeState: AgentRuntimeState,
  readMcpInstructions: () => string | undefined,
  mediaStore: LocalMediaStore | undefined,
  workspacePaths: WorkspacePathOperations,
  instructions: InstructionReadOperations,
): AgentClientContract {
  return buildAgentClientFactory(mediaStore)(
    config,
    runtimeState,
    readMcpInstructions,
    mediaStore,
    workspacePaths,
    instructions,
  );
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
export function createTaskRegistration(
  config: Config,
  dependencies: TaskToolDependencies,
): TaskToolRegistration {
  return {
    toolClass: TaskTool,
    className: 'TaskTool',
    staticName: TaskTool.Name,
    buildArgs: () => [config, dependencies],
    create: () => new TaskTool(config, dependencies),
  };
}

// Re-export the agentic-loop public surface so consumers construct the loop
// via the curated api barrel rather than importing the concrete class.
export type {
  AgenticLoopApprovalHandler,
  AgenticLoopEvent,
  AgenticLoopMessage,
  AgenticLoopOptions,
  DisplayCallbacks,
};

/** Public runner contract returned by {@link createAgenticLoop}. */
export interface AgenticLoopRunner {
  run(
    message: AgenticLoopMessage,
    signal: AbortSignal,
    promptId?: string,
  ): AsyncGenerator<AgenticLoopEvent>;
  dispose(): Promise<void>;
}

/**
 * Constructs an {@link AgenticLoopRunner}. Callers that previously
 * `new AgenticLoop(options)` directly call this helper instead so they do not
 * couple to the concrete class via the internals barrel (#2204).
 */
export function createAgenticLoop(
  options: Omit<AgenticLoopOptions, 'tools'> & {
    taskLaunchOwner: TaskLaunchOwner;
    acquireTools: (
      decorateScheduler: (
        construct: SchedulerConstruction,
      ) => SchedulerConstruction,
    ) => AgenticLoopOptions['tools'];
    readShellJobSettings: () => {
      maxBackgroundJobs: number;
      logMaxBytes: number;
    };
  },
): AgenticLoopRunner {
  const shellOwner = new ShellJobOwner(options.readShellJobSettings);
  const tools = options.acquireTools((construct) =>
    withChildToolDisplay(
      construct,
      new ChildToolDisplay(),
      options.taskLaunchOwner,
      shellOwner,
    ),
  );
  const loop = new AgenticLoop({ ...options, tools });
  return new LoopRunLifetime(
    (message, signal, promptId) => loop.run(message, signal, promptId),
    async () => {
      try {
        tools.retire();
      } finally {
        await shellOwner.dispose();
      }
    },
  );
}
