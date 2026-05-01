/**
 * Tool registry factory — extracted from Config.createToolRegistry().
 *
 * Creates and populates a ToolRegistry with all core tools,
 * applying coreTools/excludeTools governance.
 */

import path from 'node:path';
import os from 'node:os';

import { ToolRegistry } from '../tools/tool-registry.js';
import { LSTool } from '../tools/ls.js';
import { ReadFileTool } from '../tools/read-file.js';
import { GrepTool } from '../tools/grep.js';
import { RipGrepTool } from '../tools/ripGrep.js';
import { GlobTool } from '../tools/glob.js';
import { EditTool } from '../tools/edit.js';
import { ShellTool } from '../tools/shell.js';
import { ASTEditTool } from '../tools/ast-edit.js';
import { ASTReadFileTool } from '../tools/ast-edit.js';
import { AstGrepTool } from '../tools/ast-grep.js';
import { StructuralAnalysisTool } from '../tools/structural-analysis.js';
import { WriteFileTool } from '../tools/write-file.js';
import { GoogleWebFetchTool } from '../tools/google-web-fetch.js';
import { ReadManyFilesTool } from '../tools/read-many-files.js';
import { ReadLineRangeTool } from '../tools/read_line_range.js';
import { DeleteLineRangeTool } from '../tools/delete_line_range.js';
import { InsertAtLineTool } from '../tools/insert_at_line.js';
import { ApplyPatchTool } from '../tools/apply-patch.js';
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
import { CheckAsyncTasksTool } from '../tools/check-async-tasks.js';
import { ProfileManager } from './profileManager.js';
import { SubagentManager } from './subagentManager.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { SubagentSchedulerFactory } from '../core/subagentScheduler.js';
import type { AsyncTaskManager } from '../services/asyncTaskManager.js';

/** Tool record for settings UI */
export interface ToolRecord {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolClass: any;
  toolName: string;
  displayName: string;
  isRegistered: boolean;
  reason?: string;
  args: unknown[];
}

/** Narrow interface for tool registry creation — avoids circular Config import */
export interface ToolRegistryHost {
  getCoreTools(): string[] | undefined;
  getExcludeTools(): string[] | undefined;
  getUseRipgrep(): boolean;
  getProfileManager(): ProfileManager | undefined;
  setProfileManager(pm: ProfileManager): void;
  getSubagentManager(): SubagentManager | undefined;
  setSubagentManager(sm: SubagentManager): void;
  getInteractiveSubagentSchedulerFactory():
    | SubagentSchedulerFactory
    | undefined;
  getAsyncTaskManager(): AsyncTaskManager | undefined;
}

/**
 * Creates and populates a ToolRegistry with all core tools.
 *
 * Applies coreTools allow-list and excludeTools deny-list governance.
 * Returns the registry and the list of all potential tools (for settings UI).
 */
export async function createToolRegistry(
  host: ToolRegistryHost,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any,
  messageBus: MessageBus,
): Promise<{ registry: ToolRegistry; allPotentialTools: ToolRecord[] }> {
  const registry = new ToolRegistry(config, messageBus);
  const allPotentialTools: ToolRecord[] = [];

  const baseCoreTools = host.getCoreTools();
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const registerCoreTool = (ToolClass: any, ...args: unknown[]) => {
    const className = ToolClass.name;
    const rawName = ToolClass.Name;
    const toolName =
      typeof rawName === 'string' && rawName !== '' ? rawName : className;
    const coreTools = effectiveCoreTools;
    const excludeTools = host.getExcludeTools() ?? [];

    let isEnabled = true;
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

    const toolRecord: ToolRecord = {
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

    allPotentialTools.push(toolRecord);
  };

  registerCoreTool(LSTool, config);
  registerCoreTool(ReadFileTool, config);

  if (host.getUseRipgrep()) {
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

  let profileManager = host.getProfileManager();
  if (!profileManager) {
    const profilesDir = path.join(os.homedir(), '.llxprt', 'profiles');
    profileManager = new ProfileManager(profilesDir);
    host.setProfileManager(profileManager);
  }

  let subagentManager = host.getSubagentManager();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Tool registry inputs cross plugin/runtime boundaries despite declared types.
  if (subagentManager === undefined && profileManager !== undefined) {
    const subagentsDir = path.join(os.homedir(), '.llxprt', 'subagents');
    subagentManager = new SubagentManager(subagentsDir, profileManager);
    host.setSubagentManager(subagentManager);
  }

  const taskToolArgs = {
    profileManager,
    subagentManager,
    schedulerFactoryProvider: () =>
      host.getInteractiveSubagentSchedulerFactory(),
    getAsyncTaskManager: () => host.getAsyncTaskManager(),
  };

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Tool registry inputs cross plugin/runtime boundaries despite declared types.
  if (profileManager !== undefined && subagentManager !== undefined) {
    registerCoreTool(TaskTool, config, taskToolArgs);
  } else {
    const taskToolRecord: ToolRecord = {
      toolClass: TaskTool,
      toolName: 'TaskTool',
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Tool registry inputs cross plugin/runtime boundaries; Name is static but fallback preserves defensive semantics.
      displayName: TaskTool.Name || 'TaskTool',
      isRegistered: false,
      reason:
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Tool registry inputs cross plugin/runtime boundaries despite declared types.
        profileManager === undefined && subagentManager === undefined
          ? 'requires profile manager and subagent manager'
          : // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Tool registry inputs cross plugin/runtime boundaries despite declared types.
            profileManager === undefined
            ? 'requires profile manager'
            : 'requires subagent manager',
      args: [config, taskToolArgs],
    };
    allPotentialTools.push(taskToolRecord);
  }

  const listSubagentsArgs = {
    getSubagentManager: () => host.getSubagentManager(),
  };

  if (subagentManager !== undefined) {
    registerCoreTool(ListSubagentsTool, config, listSubagentsArgs);
  } else {
    const listSubagentsRecord: ToolRecord = {
      toolClass: ListSubagentsTool,
      toolName: 'ListSubagentsTool',
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Tool registry inputs cross plugin/runtime boundaries; Name is static but fallback preserves defensive semantics.
      displayName: ListSubagentsTool.Name || 'ListSubagentsTool',
      isRegistered: false,
      reason: 'requires subagent manager',
      args: [config, listSubagentsArgs],
    };
    allPotentialTools.push(listSubagentsRecord);
  }

  // @plan PLAN-20260130-ASYNCTASK.P14
  const checkAsyncTasksArgs = {
    getAsyncTaskManager: () => host.getAsyncTaskManager(),
  };
  registerCoreTool(CheckAsyncTasksTool, checkAsyncTasksArgs);

  await registry.discoverAllTools();
  registry.sortTools();
  return { registry, allPotentialTools };
}
