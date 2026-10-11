import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import type {
  ToolExecutionPolicy,
  ToolGovernance,
} from '@vybestack/llxprt-code-tools';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';

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
import { bindSchedulerOwner } from '../session/assembleSchedulerOwner.js';
import { createChildToolAssembly } from '../session/childToolAssembly.js';
import { ShellJobOwner } from '../session/shell-job-owner.js';
import type { TaskLaunchOwner } from '../session/task-launch-owner.js';
export { TaskLaunchOwner } from '../session/task-launch-owner.js';
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
import type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core';
import { buildAgentClientFactory } from './agentBootstrap.js';
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

export type { AgentRuntimeFactoryBindings } from '@vybestack/llxprt-code-core';

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
 * Internal Agents assembly uses this descriptor for owned runtimes. Hosts
 * use createAgent/fromConfig or activation bootstrap, which install defaults
 * without exposing the assembly descriptor (#3222).
 */
export function createAgentRuntimeFactoryBindings(
  mediaStore?: LocalMediaStore,
): AgentRuntimeFactoryBindings {
  return {
    agentClientFactory: buildAgentClientFactory(mediaStore),
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
export function createTaskRegistration(): TaskToolRegistration {
  return {
    toolClass: TaskTool,
    className: 'TaskTool',
    staticName: TaskTool.Name,
    buildArgs(config: unknown, taskToolArgs: TaskToolArgs): unknown[] {
      assertConfig(config, 'TaskToolRegistration.buildArgs');
      return [
        config,
        {
          ...taskToolArgs,
          readMcpInstructions:
            taskToolArgs.readMcpInstructions ?? (() => undefined),
        },
      ];
    },
    create(config: unknown, taskToolArgs: TaskToolArgs) {
      assertConfig(config, 'TaskToolRegistration.create');
      if (taskToolArgs.instructions === undefined)
        throw new Error('Task requires explicit instruction operations');
      if (taskToolArgs.workspacePaths === undefined)
        throw new Error('Task requires explicit workspace paths');
      if (
        taskToolArgs.createChildSettings === undefined ||
        taskToolArgs.readTaskPolicy === undefined ||
        taskToolArgs.readRunPolicy === undefined ||
        taskToolArgs.readGovernance === undefined
      )
        throw new Error(
          'Task requires explicit session policy and child settings',
        );
      return new TaskTool(config, {
        createChildSettings: taskToolArgs.createChildSettings,
        readTaskPolicy: taskToolArgs.readTaskPolicy,
        readRunPolicy: taskToolArgs.readRunPolicy,
        readGovernance: taskToolArgs.readGovernance,
        ...taskToolArgs,
        toolRegistry: taskToolArgs.toolSelection,
        workspacePaths: taskToolArgs.workspacePaths,
        instructions: taskToolArgs.instructions,
        readMcpInstructions:
          taskToolArgs.readMcpInstructions ?? (() => undefined),
      });
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
  dispose(): Promise<void>;
}

/**
 * Constructs an {@link AgenticLoopRunner}. Callers that previously
 * `new AgenticLoop(options)` directly call this helper instead so they do not
 * couple to the concrete class via the internals barrel (#2204).
 */
export function createAgenticLoop(
  options: Omit<AgenticLoopOptions, 'createSchedulerOwner' | 'config'> & {
    config: Config;
    telemetry: RootTelemetry;
    taskLaunchOwner: TaskLaunchOwner;
    readShellJobSettings: () => {
      maxBackgroundJobs: number;
      logMaxBytes: number;
    };
    readExecutionPolicy: () => ToolExecutionPolicy;
    getToolGovernance: () => ToolGovernance;
  },
): AgenticLoopRunner {
  const shellOwner = new ShellJobOwner(options.readShellJobSettings);
  const assembly = createChildToolAssembly(
    (schedulerOptions) => new CoreToolScheduler(schedulerOptions),
    options.taskLaunchOwner,
    shellOwner,
  );
  const loop = new AgenticLoop({
    ...options,
    createSchedulerOwner: bindSchedulerOwner(
      options.config,
      options.messageBus,
      options.interactiveMode ?? false,
      options.agentClient.tools,
      assembly.schedulerFactory,
      options.readExecutionPolicy,
      options.getToolGovernance,
      undefined,
      options.telemetry,
    ),
  });
  return {
    run: (message, signal, promptId) => loop.run(message, signal, promptId),
    dispose: () => shellOwner.dispose(),
  };
}
