/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';
import type { MemoryCommandRuntime } from '../commands/memoryCommandHost.js';
import type { BugCommandRuntime } from '../commands/bugCommandHost.js';
import type { DirectoryCommandRuntime } from '../commands/directoryCommandHost.js';
import { createHooksCommand } from '../commands/hooksCommand.js';
import { createTaskCommand } from '../commands/tasksCommand.js';
import { createToolsCommand } from '../commands/toolsCommand.js';
import {
  createDirectoryCommand,
  type DirectoryCommandOperations,
} from '../commands/directoryCommand.js';
import { bindDirectoryCommand } from '../commands/directoryCommandHost.js';
import { createMemoryCommand } from '../commands/memoryCommand.js';
import { bindMemoryCommand } from '../commands/memoryCommandHost.js';
import {
  createImageCommand,
  type ImageCommandOperations,
} from '../commands/imageCommand.js';
import {
  createBugCommand,
  type BugCommandOperations,
} from '../commands/bugCommand.js';
import { bindBugCommand } from '../commands/bugCommandHost.js';
import { createPoliciesCommand } from '../commands/policiesCommand.js';
import { bindPoliciesCommand } from '../commands/policiesCommandHost.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';

/**
 * The runtime reads the workspace command owners need: one narrow port per
 * command family, plus the workspace root used by /image.
 */
export interface WorkspaceCommandRuntime {
  readonly memory: MemoryCommandRuntime;
  readonly bug: BugCommandRuntime | null;
  readonly directory: DirectoryCommandRuntime | null;
  getTargetDir(): string;
}

/** History and memory writes every workspace command family shares. */
export interface WorkspaceCommandWrites {
  readonly addItem: UseHistoryManagerReturn['addItem'];
  readonly setMemoryFileCount: (count: number) => void;
}

/** Policy reads behind /policies. */
export interface PoliciesCommandReads {
  readRules(): ReturnType<Agent['policy']['getRules']> | null;
  readDefaultDecision: Agent['policy']['getDefaultDecision'];
  readNonInteractive: Agent['policy']['isNonInteractive'];
}

/** Hook listing and toggles behind /hooks; `list` is null when unavailable. */
export interface HooksCommandReads {
  readonly list: Agent['hooks']['listHooks'] | null;
  readonly enable: Agent['hooks']['enable'];
  readonly disable: Agent['hooks']['disable'];
  readonly setDisabled: Agent['hooks']['setDisabledHooks'];
}

/** Task reads behind /tasks; `list` is null when the manager is absent. */
export interface TasksCommandReads {
  readonly list: Agent['tasks']['list'] | null;
  readonly listRunning: Agent['tasks']['listRunning'];
  readonly get: Agent['tasks']['get'];
  readonly cancel: Agent['tasks']['cancel'];
}

/** Tool reads behind /tools; `list` is null when the registry is absent. */
export interface ToolsCommandReads {
  readonly list: Agent['tools']['list'] | null;
  readonly readSetting: Agent['getEphemeralSetting'];
  readonly writeSetting: Agent['setEphemeralSetting'];
  readonly refreshSchema: () => Promise<void>;
}

/** Directory-context writes behind /directory. */
export interface DirectoryCommandWrites {
  readonly addDirectoryContext: DirectoryCommandOperations['addDirectoryContext'];
  readonly recordDirectoriesChanged: DirectoryCommandOperations['recordDirectoriesChanged'];
}

/** Image generation behind /image. */
export interface ImageCommandReads {
  readonly runImageOperation: ImageCommandOperations['runImageOperation'];
}

/** Conversation and IDE reads behind /bug. */
export interface BugCommandReads {
  readonly getConversationHistory: BugCommandOperations['getConversationHistory'];
  readonly readIdeName: () => string;
}

/**
 * Every input the workspace command owners need, one narrow port per command
 * family. All ports are required: a missing family is a composition mistake,
 * not a runtime state.
 */
export interface WorkspaceCommandDeps {
  readonly workspace: WorkspaceCommandRuntime;
  readonly writes: WorkspaceCommandWrites;
  readonly policies: PoliciesCommandReads;
  readonly hooks: HooksCommandReads;
  readonly tasks: TasksCommandReads;
  readonly tools: ToolsCommandReads;
  readonly directory: DirectoryCommandWrites;
  readonly image: ImageCommandReads;
  readonly bug: BugCommandReads;
}

export function createWorkspaceCommandOwners(deps: WorkspaceCommandDeps) {
  const { workspace, writes, policies, hooks, tasks, tools, directory, image } =
    deps;
  const policy = bindPoliciesCommand(
    policies.readRules,
    policies.readDefaultDecision,
    policies.readNonInteractive,
  );
  return {
    memoryCommand: createMemoryCommand(
      bindMemoryCommand(
        workspace.memory,
        writes.addItem,
        writes.setMemoryFileCount,
      ),
    ),
    bugCommand: createBugCommand(
      bindBugCommand(
        workspace.bug,
        deps.bug.getConversationHistory,
        writes.addItem,
        deps.bug.readIdeName,
      ),
    ),
    policiesCommand: createPoliciesCommand(policy),
    hooksCommand: registerHooks(hooks, writes.addItem),
    taskCommand: createRegisteredTaskCommand(tasks, writes.addItem),
    toolsCommand: createRegisteredToolsCommand(tools, writes.addItem),
    directoryCommand: createDirectoryCommand(
      bindDirectoryCommand(
        workspace.directory,
        directory.addDirectoryContext,
        directory.recordDirectoriesChanged,
        writes.addItem,
        writes.setMemoryFileCount,
      ),
    ),
    imageCommand: createImageCommand({
      workspaceRoot: workspace.getTargetDir(),
      runImageOperation: image.runImageOperation,
      addItem: writes.addItem,
    }),
  };
}

function createRegisteredTaskCommand(
  tasks: TasksCommandReads,
  addItem: UseHistoryManagerReturn['addItem'],
) {
  return createTaskCommand(
    tasks.list === null
      ? null
      : {
          list: tasks.list,
          listRunning: tasks.listRunning,
          get: tasks.get,
          cancel: tasks.cancel,
        },
    addItem,
  );
}

function createRegisteredToolsCommand(
  tools: ToolsCommandReads,
  addItem: UseHistoryManagerReturn['addItem'],
) {
  return createToolsCommand(
    tools.list === null
      ? null
      : {
          listTools: tools.list,
          readSetting: tools.readSetting,
          writeSetting: tools.writeSetting,
          refreshToolSchema: tools.refreshSchema,
        },
    addItem,
  );
}

function registerHooks(
  hooks: HooksCommandReads,
  addItem: UseHistoryManagerReturn['addItem'],
) {
  return createHooksCommand(
    {
      listHooks: () => hooks.list?.() ?? [],
      isConfigured: hooks.list !== null,
      isAvailable: hooks.list !== null,
      enable: hooks.enable,
      disable: hooks.disable,
      setDisabledHooks: hooks.setDisabled,
    },
    addItem,
  );
}
