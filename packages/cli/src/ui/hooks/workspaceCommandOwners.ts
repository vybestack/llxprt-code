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
  readonly memory: MemoryCommandRuntime | null;
  readonly bug: BugCommandRuntime | null;
  readonly directory: DirectoryCommandRuntime | null;
  getTargetDir(): string;
}

export function createWorkspaceCommandOwners(
  runtime: WorkspaceCommandRuntime,
  listTools: Agent['tools']['list'] | null,
  readSetting: Agent['getEphemeralSetting'],
  writeSetting: Agent['setEphemeralSetting'],
  addItem: UseHistoryManagerReturn['addItem'],
  setMemoryFileCount: (count: number) => void,
  refreshToolSchema: () => Promise<void>,
  readPolicyRules: () => ReturnType<Agent['policy']['getRules']> | null,
  readDefaultDecision: Agent['policy']['getDefaultDecision'],
  readNonInteractive: Agent['policy']['isNonInteractive'],
  listHooks: Agent['hooks']['listHooks'] | null,
  enableHook: Agent['hooks']['enable'],
  disableHook: Agent['hooks']['disable'],
  setDisabledHooks: Agent['hooks']['setDisabledHooks'],
  listTasks: Agent['tasks']['list'] | null,
  listRunningTasks: Agent['tasks']['listRunning'],
  getTask: Agent['tasks']['get'],
  cancelTask: Agent['tasks']['cancel'],
  addDirectoryContext: DirectoryCommandOperations['addDirectoryContext'],
  recordDirectoriesChanged: DirectoryCommandOperations['recordDirectoriesChanged'],
  runImageOperation: ImageCommandOperations['runImageOperation'],
  getConversationHistory: BugCommandOperations['getConversationHistory'],
  readIdeName: () => string,
) {
  const policy = bindPoliciesCommand(
    readPolicyRules,
    readDefaultDecision,
    readNonInteractive,
  );
  return {
    memoryCommand: createMemoryCommand(
      bindMemoryCommand(runtime.memory, addItem, setMemoryFileCount),
    ),
    bugCommand: createBugCommand(
      bindBugCommand(runtime.bug, getConversationHistory, addItem, readIdeName),
    ),
    policiesCommand: createPoliciesCommand(policy),
    hooksCommand: registerHooks(
      listHooks !== null,
      listHooks,
      enableHook,
      disableHook,
      setDisabledHooks,
      addItem,
    ),
    taskCommand: createRegisteredTaskCommand(
      listTasks,
      listRunningTasks,
      getTask,
      cancelTask,
      addItem,
    ),
    toolsCommand: createRegisteredToolsCommand(
      listTools,
      readSetting,
      writeSetting,
      refreshToolSchema,
      addItem,
    ),
    directoryCommand: createDirectoryCommand(
      bindDirectoryCommand(
        runtime.directory,
        addDirectoryContext,
        recordDirectoriesChanged,
        addItem,
        setMemoryFileCount,
      ),
    ),
    imageCommand: createImageCommand({
      workspaceRoot: runtime.getTargetDir(),
      runImageOperation,
      addItem,
    }),
  };
}

function createRegisteredTaskCommand(
  list: Agent['tasks']['list'] | null,
  listRunning: Agent['tasks']['listRunning'],
  get: Agent['tasks']['get'],
  cancel: Agent['tasks']['cancel'],
  addItem: UseHistoryManagerReturn['addItem'],
) {
  return createTaskCommand(
    list === null ? null : { list, listRunning, get, cancel },
    addItem,
  );
}

function createRegisteredToolsCommand(
  listTools: Agent['tools']['list'] | null,
  readSetting: Agent['getEphemeralSetting'],
  writeSetting: Agent['setEphemeralSetting'],
  refreshToolSchema: () => Promise<void>,
  addItem: UseHistoryManagerReturn['addItem'],
) {
  return createToolsCommand(
    listTools === null
      ? null
      : { listTools, readSetting, writeSetting, refreshToolSchema },
    addItem,
  );
}

function registerHooks(
  isConfigured: boolean,
  listHooks: Agent['hooks']['listHooks'] | null,
  enable: Agent['hooks']['enable'],
  disable: Agent['hooks']['disable'],
  setDisabledHooks: Agent['hooks']['setDisabledHooks'],
  addItem: UseHistoryManagerReturn['addItem'],
) {
  return createHooksCommand(
    {
      listHooks: () => listHooks?.() ?? [],
      isConfigured,
      isAvailable: listHooks !== null,
      enable,
      disable,
      setDisabledHooks,
    },
    addItem,
  );
}
