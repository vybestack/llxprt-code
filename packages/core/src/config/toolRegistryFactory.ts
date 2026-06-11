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
// @plan PLAN-20260610-ISSUE1592.P01
// @requirement REQ-INV-003
// TaskTool is NOT imported directly here anymore.
// The defaultTaskToolRegistration module is the ONLY core-config file importing ../tools/task.js.
// It is DELETED in P03 when composition roots wire the registration from agents.
import { defaultTaskToolRegistration } from './defaultTaskToolRegistration.js';
import { ListSubagentsTool } from '../tools/list-subagents.js';
import { CheckAsyncTasksTool } from '../tools/check-async-tasks.js';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { SubagentManager } from './subagentManager.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { SubagentSchedulerFactory } from '../core/subagentScheduler.js';
import type { AsyncTaskManager } from '../services/asyncTaskManager.js';
import type { AnyDeclarativeTool } from '../tools/tools.js';

/**
 * @plan PLAN-20260610-ISSUE1592.P01
 * @requirement REQ-INV-003
 *
 * TaskTool registration descriptor — a seam that decouples toolRegistryFactory
 * from the concrete TaskTool class. The descriptor preserves ToolRecord metadata
 * semantics: className -> toolName, staticName -> displayName.
 *
 * CRITICAL semantics mapping (do NOT swap):
 *   ToolRecord.toolName    = className   ('TaskTool')
 *   ToolRecord.displayName = staticName  ('task' via TaskTool.Name)
 */

/** Core-owned constants for TaskTool identity (used even when class is absent) */
export const TASK_TOOL_CLASS_NAME = 'TaskTool';
export const TASK_TOOL_NAME = 'task';

/**
 * Descriptor for TaskTool registration. The seam between toolRegistryFactory
 * and the concrete TaskTool class.
 */
export interface TaskToolRegistration {
  /** Concrete class constructor for ToolRecord.toolClass */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly toolClass: any;
  /** ToolClass.name ('TaskTool') — becomes ToolRecord.toolName; allow-list/exclude matching */
  readonly className: string;
  /** static ToolClass.Name ('task') — becomes ToolRecord.displayName; also matched by allow-list */
  readonly staticName: string;
  /** Constructor args builder, stored in ToolRecord.args */
  buildArgs(config: unknown, taskToolArgs: TaskToolArgs): unknown[];
  /** Create a tool instance */
  create(config: unknown, args: TaskToolArgs): AnyDeclarativeTool;
}

/** TaskTool dependencies argument shape */
export interface TaskToolArgs {
  profileManager: ProfileManager | undefined;
  subagentManager: SubagentManager | undefined;
  schedulerFactoryProvider: () => SubagentSchedulerFactory | undefined;
  getAsyncTaskManager: () => AsyncTaskManager | undefined;
}

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
  /**
   * @plan PLAN-20260610-ISSUE1592.P01
   * @requirement REQ-INV-003
   * Returns the injected TaskToolRegistration, or undefined to use core-local default.
   */
  getTaskToolRegistration(): TaskToolRegistration | undefined;
}

function getTaskToolMissingReason(
  profileManager: ProfileManager | undefined,
  subagentManager: SubagentManager | undefined,
): string {
  if (profileManager === undefined && subagentManager === undefined) {
    return 'requires profile manager and subagent manager';
  }

  if (profileManager === undefined) {
    return 'requires profile manager';
  }
  return 'requires subagent manager';
}

const matchesToolIdentifier = (value: string, target: string): boolean =>
  value === target || value.startsWith(`${target}(`);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RegisterCoreToolFn = (ToolClass: any, ...args: unknown[]) => void;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildRegisterCoreTool(
  registry: ToolRegistry,
  effectiveCoreTools: string[] | undefined,
  excludeTools: string[] | undefined,
  allPotentialTools: ToolRecord[],
): RegisterCoreToolFn {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ToolClass: any, ...args: unknown[]) => {
    const className = ToolClass.name;
    const rawName = ToolClass.Name;
    const toolName =
      typeof rawName === 'string' && rawName !== '' ? rawName : className;
    const coreTools = effectiveCoreTools;
    const excludeList = excludeTools ?? [];

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

    const isExcluded = excludeList.some(
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
}

function ensureCoreToolIncluded(
  effectiveCoreTools: string[] | undefined,
  identifier: string,
): void {
  if (!effectiveCoreTools) {
    return;
  }
  if (
    !effectiveCoreTools.some((tool) => matchesToolIdentifier(tool, identifier))
  ) {
    effectiveCoreTools.push(identifier);
  }
}

function registerTaskTool(
  registry: ToolRegistry,
  effectiveCoreTools: string[] | undefined,
  excludeTools: string[] | undefined,
  allPotentialTools: ToolRecord[],
  registration: TaskToolRegistration,
  config: unknown,
  taskToolArgs: TaskToolArgs,
): void {
  const className = registration.className;
  const toolName = registration.staticName || className;
  const args = registration.buildArgs(config, taskToolArgs);
  let isEnabled = true;
  let reason: string | undefined;

  if (effectiveCoreTools) {
    isEnabled = effectiveCoreTools.some(
      (tool) =>
        tool === className ||
        tool === toolName ||
        tool.startsWith(`${className}(`) ||
        tool.startsWith(`${toolName}(`),
    );
  }

  const isExcluded = (excludeTools ?? []).some(
    (tool) => tool === className || tool === toolName,
  );
  if (isExcluded) {
    isEnabled = false;
    reason = 'excluded by excludeTools setting';
  }

  const toolRecord: ToolRecord = {
    toolClass: registration.toolClass,
    toolName: className,
    displayName: toolName,
    isRegistered: false,
    reason,
    args,
  };

  if (isEnabled) {
    registry.registerTool(registration.create(config, taskToolArgs));
    toolRecord.isRegistered = true;
    toolRecord.reason = undefined;
  } else if (!reason) {
    toolRecord.reason = 'not included in coreTools configuration';
  }

  allPotentialTools.push(toolRecord);
}

function registerStandardTools(
  registerCoreTool: RegisterCoreToolFn,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any,
  host: ToolRegistryHost,
): void {
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
}

function resolveManagers(host: ToolRegistryHost): {
  profileManager: ProfileManager | undefined;
  subagentManager: SubagentManager | undefined;
} {
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

  return { profileManager, subagentManager };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function registerAgentTools(
  registerCoreTool: RegisterCoreToolFn,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  config: any,
  profileManager: ProfileManager | undefined,
  subagentManager: SubagentManager | undefined,
  host: ToolRegistryHost,
  allPotentialTools: ToolRecord[],
  registry: ToolRegistry,
  effectiveCoreTools: string[] | undefined,
): void {
  // @plan PLAN-20260610-ISSUE1592.P01
  // @requirement REQ-INV-003
  // Resolve registration: injected > core-local default > absent
  const registration =
    host.getTaskToolRegistration() ?? defaultTaskToolRegistration;

  const taskToolArgs = {
    profileManager,
    subagentManager,
    schedulerFactoryProvider: () =>
      host.getInteractiveSubagentSchedulerFactory(),
    getAsyncTaskManager: () => host.getAsyncTaskManager(),
  };

  if (profileManager !== undefined && subagentManager !== undefined) {
    registerTaskTool(
      registry,
      effectiveCoreTools,
      host.getExcludeTools(),
      allPotentialTools,
      registration,
      config,
      taskToolArgs,
    );
  } else {
    // Missing-manager path: preserved exactly from today's behavior
    const taskToolRecord: ToolRecord = {
      toolClass: registration.toolClass,
      toolName: TASK_TOOL_CLASS_NAME,
      displayName: registration.staticName,
      isRegistered: false,
      reason: getTaskToolMissingReason(profileManager, subagentManager),
      args: registration.buildArgs(config, taskToolArgs),
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

  // @plan PLAN-20260610-ISSUE1592.P01
  // @requirement REQ-INV-003
  // Use constants instead of TaskTool class references
  ensureCoreToolIncluded(effectiveCoreTools, TASK_TOOL_CLASS_NAME);
  ensureCoreToolIncluded(effectiveCoreTools, TASK_TOOL_NAME);
  ensureCoreToolIncluded(effectiveCoreTools, 'ListSubagentsTool');
  ensureCoreToolIncluded(effectiveCoreTools, ListSubagentsTool.Name);

  const registerCoreTool = buildRegisterCoreTool(
    registry,
    effectiveCoreTools,
    host.getExcludeTools(),
    allPotentialTools,
  );

  registerStandardTools(registerCoreTool, config, host);

  const { profileManager, subagentManager } = resolveManagers(host);

  registerAgentTools(
    registerCoreTool,
    config,
    profileManager,
    subagentManager,
    host,
    allPotentialTools,
    registry,
    effectiveCoreTools,
  );

  await registry.discoverAllTools();
  registry.sortTools();
  return { registry, allPotentialTools };
}
