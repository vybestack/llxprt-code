/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import os from 'node:os';
import { ToolRegistry } from '../tools/tool-registry.js';
import { LSTool } from '../tools/ls.js';
import { ReadFileTool } from '../tools/read-file.js';
import { GrepTool } from '../tools/grep.js';
import { RipGrepTool } from '../tools/ripGrep.js';
import { GlobTool } from '../tools/glob.js';
import { EditTool } from '../tools/edit.js';
import { ASTEditTool } from '../tools/ast-edit.js';
import { ASTReadFileTool } from '../tools/ast-edit.js';
// @plan PLAN-20260211-ASTGREP.P05
import { AstGrepTool } from '../tools/ast-grep.js';
import { StructuralAnalysisTool } from '../tools/structural-analysis.js';
import { WriteFileTool } from '../tools/write-file.js';
import { GoogleWebFetchTool } from '../tools/google-web-fetch.js';
import { ReadManyFilesTool } from '../tools/read-many-files.js';
import { ReadLineRangeTool } from '../tools/read_line_range.js';
import { DeleteLineRangeTool } from '../tools/delete_line_range.js';
import { InsertAtLineTool } from '../tools/insert_at_line.js';
import { ApplyPatchTool } from '../tools/apply-patch.js';
import { ShellTool } from '../tools/shell.js';
import { MemoryTool } from '../tools/memoryTool.js';
import { GoogleWebSearchTool } from '../tools/google-web-search.js';
import { ExaWebSearchTool } from '../tools/exa-web-search.js';
import { TodoWrite } from '../tools/todo-write.js';
import { TodoRead } from '../tools/todo-read.js';
import { TodoPause } from '../tools/todo-pause.js';
import { CodeSearchTool } from '../tools/codesearch.js';
import { DirectWebFetchTool } from '../tools/direct-web-fetch.js';
import { TaskTool } from '../tools/task.js';
import { ListSubagentsTool } from '../tools/list-subagents.js';
// @plan PLAN-20260130-ASYNCTASK.P14
import { CheckAsyncTasksTool } from '../tools/check-async-tasks.js';
import { ProfileManager } from './profileManager.js';
import { SubagentManager } from './subagentManager.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { Config } from './config.js';

export interface PotentialToolRecord {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolClass: any;
  toolName: string;
  displayName: string;
  isRegistered: boolean;
  reason?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[];
}

export interface ToolRegistryFactoryResult {
  registry: ToolRegistry;
  potentialTools: PotentialToolRecord[];
  profileManager: ProfileManager;
  subagentManager: SubagentManager | undefined;
}

export async function createToolRegistryFromConfig(
  config: Config,
  messageBus: MessageBus,
): Promise<ToolRegistryFactoryResult> {
  const registry = new ToolRegistry(config, messageBus);
  const potentialTools: PotentialToolRecord[] = [];

  const baseCoreTools = config.getCoreTools();
  const effectiveCoreTools =
    baseCoreTools && baseCoreTools.length > 0 ? [...baseCoreTools] : undefined;

  const matchesToolIdentifier = (value: string, target: string): boolean =>
    value === target || value.startsWith(`${target}(`);

  const ensureCoreToolIncluded = (identifier: string) => {
    if (!effectiveCoreTools) {
      return;
    }
    if (
      !effectiveCoreTools.some((tool) =>
        matchesToolIdentifier(tool, identifier),
      )
    ) {
      effectiveCoreTools.push(identifier);
    }
  };

  ensureCoreToolIncluded('TaskTool');
  ensureCoreToolIncluded(TaskTool.Name);
  ensureCoreToolIncluded('ListSubagentsTool');
  ensureCoreToolIncluded(ListSubagentsTool.Name);

  // helper to create & register core tools that are enabled
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registerCoreTool = (ToolClass: any, ...args: unknown[]) => {
    const className = ToolClass.name;
    const toolName = ToolClass.Name || className;
    const coreTools = effectiveCoreTools;
    const excludeTools = config.getExcludeTools() || [];

    let isEnabled = true; // Enabled by default if coreTools is not set.
    let reason: string | undefined;

    if (coreTools) {
      isEnabled = coreTools.some(
        (tool) =>
          tool === className ||
          tool === toolName ||
          tool.startsWith(`${className}(`) ||
          tool.startsWith(`${toolName}(`),
      );
    }

    const isExcluded = excludeTools.some(
      (tool) => tool === className || tool === toolName,
    );

    if (isExcluded) {
      isEnabled = false;
      reason = 'excluded by excludeTools setting';
    }

    // Record tool attempt for settings UI
    const toolRecord = {
      toolClass: ToolClass,
      toolName: className,
      displayName: toolName,
      isRegistered: false,
      reason,
      args,
    };

    if (isEnabled) {
      registry.registerTool(new ToolClass(...args));
      toolRecord.isRegistered = true;
      toolRecord.reason = undefined;
    } else if (!reason) {
      reason = 'not included in coreTools configuration';
      toolRecord.reason = reason;
    }

    potentialTools.push(toolRecord);
  };

  registerCoreTool(LSTool, config);
  registerCoreTool(ReadFileTool, config);

  if (config.getUseRipgrep()) {
    registerCoreTool(RipGrepTool, config);
  } else {
    registerCoreTool(GrepTool, config);
  }

  registerCoreTool(GlobTool, config);
  registerCoreTool(EditTool, config);
  registerCoreTool(ASTEditTool, config);
  registerCoreTool(WriteFileTool, config);
  registerCoreTool(GoogleWebFetchTool, config);
  registerCoreTool(ReadManyFilesTool, config);
  registerCoreTool(ReadLineRangeTool, config);
  registerCoreTool(ASTReadFileTool, config);
  // @plan PLAN-20260211-ASTGREP.P05
  registerCoreTool(AstGrepTool, config);
  registerCoreTool(StructuralAnalysisTool, config);
  registerCoreTool(DeleteLineRangeTool, config);
  registerCoreTool(InsertAtLineTool, config);
  registerCoreTool(ApplyPatchTool, config);
  registerCoreTool(ShellTool, config);
  registerCoreTool(MemoryTool, config);
  registerCoreTool(GoogleWebSearchTool, config);
  registerCoreTool(ExaWebSearchTool, config);
  registerCoreTool(TodoWrite);
  registerCoreTool(TodoRead);
  registerCoreTool(TodoPause);
  registerCoreTool(CodeSearchTool, config);
  registerCoreTool(DirectWebFetchTool, config);

  let profileManager = config.getProfileManager();
  if (!profileManager) {
    const profilesDir = path.join(os.homedir(), '.llxprt', 'profiles');
    profileManager = new ProfileManager(profilesDir);
    config.setProfileManager(profileManager);
  }

  let subagentManager = config.getSubagentManager();
  if (!subagentManager && profileManager) {
    const subagentsDir = path.join(os.homedir(), '.llxprt', 'subagents');
    subagentManager = new SubagentManager(subagentsDir, profileManager);
    config.setSubagentManager(subagentManager);
  }

  // Handle TaskTool with dependency checking
  const taskToolArgs = {
    profileManager,
    subagentManager,
    schedulerFactoryProvider: () =>
      config.getInteractiveSubagentSchedulerFactory(),
    getAsyncTaskManager: () => config.getAsyncTaskManager(),
  };

  if (profileManager && subagentManager) {
    registerCoreTool(TaskTool, config, taskToolArgs);
  } else {
    // Record TaskTool as unregistered due to missing dependencies
    const taskToolRecord = {
      toolClass: TaskTool,
      toolName: 'TaskTool',
      displayName: TaskTool.Name || 'TaskTool',
      isRegistered: false,
      reason:
        !profileManager && !subagentManager
          ? 'requires profile manager and subagent manager'
          : !profileManager
            ? 'requires profile manager'
            : 'requires subagent manager',
      args: [config, taskToolArgs],
    };
    potentialTools.push(taskToolRecord);
  }

  // Handle ListSubagentsTool with dependency checking
  const listSubagentsArgs = {
    getSubagentManager: () => config.getSubagentManager(),
  };

  if (subagentManager) {
    registerCoreTool(ListSubagentsTool, config, listSubagentsArgs);
  } else {
    // Record ListSubagentsTool as unregistered due to missing subagent manager
    const listSubagentsRecord = {
      toolClass: ListSubagentsTool,
      toolName: 'ListSubagentsTool',
      displayName: ListSubagentsTool.Name || 'ListSubagentsTool',
      isRegistered: false,
      reason: 'requires subagent manager',
      args: [config, listSubagentsArgs],
    };
    potentialTools.push(listSubagentsRecord);
  }

  // @plan PLAN-20260130-ASYNCTASK.P14
  // Register CheckAsyncTasksTool
  const checkAsyncTasksArgs = {
    getAsyncTaskManager: () => config.getAsyncTaskManager(),
  };
  registerCoreTool(CheckAsyncTasksTool, checkAsyncTasksArgs);

  await registry.discoverAllTools();
  registry.sortTools();
  return { registry, potentialTools, profileManager, subagentManager };
}
