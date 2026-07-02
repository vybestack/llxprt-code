/**
 * Tool registry factory — extracted from Config.createToolRegistry().
 *
 * Creates and populates a ToolRegistry with all core tools,
 * applying coreTools/excludeTools governance.
 */

import path from 'node:path';

import { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  DeleteLineRangeTool,
  GlobTool,
  GrepTool,
  InsertAtLineTool,
  LSTool,
  ReadFileTool,
  ReadLineRangeTool,
  ReadManyFilesTool,
  RipGrepTool,
  WriteFileTool,
  GoogleWebFetchTool,
  AstGrepTool,
  StructuralAnalysisTool,
  ASTEditTool,
  ASTReadFileTool,
  EditTool,
  ApplyPatchTool,
  TodoWrite,
  TodoRead,
  TodoPause,
  ListSubagentsTool,
  CheckAsyncTasksTool,
  GoogleWebSearchTool,
  ExaWebSearchTool,
  CodeSearchTool,
  DirectWebFetchTool,
  MemoryTool,
  ShellTool,
} from '@vybestack/llxprt-code-tools';

import { CoreToolHostAdapter } from '../tools-adapters/CoreToolHostAdapter.js';
import { CoreIdeServiceAdapter } from '../tools-adapters/CoreIdeServiceAdapter.js';
import { CoreLspServiceAdapter } from '../tools-adapters/CoreLspServiceAdapter.js';
import { CoreToolKeyStorageAdapter } from '../tools-adapters/CoreToolKeyStorageAdapter.js';
import { CoreSettingsServiceAdapter } from '../tools-adapters/CoreSettingsServiceAdapter.js';
import { CoreWebSearchServiceAdapter } from '../tools-adapters/CoreWebSearchServiceAdapter.js';
import { CoreStorageServiceAdapter } from '../tools-adapters/CoreStorageServiceAdapter.js';
import { CoreMessageBusAdapter } from '../tools-adapters/CoreMessageBusAdapter.js';
import { CoreShellToolHostAdapter } from '../tools-adapters/CoreShellToolHostAdapter.js';
import { CoreSubagentServiceAdapter } from '../tools-adapters/CoreSubagentServiceAdapter.js';
import { CoreAsyncTaskServiceAdapter } from '../tools-adapters/CoreAsyncTaskServiceAdapter.js';
import { CoreToolRegistryHostAdapter } from '../tools-adapters/CoreToolRegistryHostAdapter.js';
import { CoreTodoServiceAdapter } from '../tools-adapters/CoreTodoServiceAdapter.js';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { SubagentManager } from './subagentManager.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { SubagentSchedulerFactory } from '../core/subagentTypes.js';
import type { AsyncTaskManager } from '../services/asyncTaskManager.js';
import type { AnyDeclarativeTool } from '@vybestack/llxprt-code-tools';
import type { Config } from './config.js';
import type { ConfigBaseCore } from './configBaseCore.js';

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
  readonly toolClass: ToolConstructor;
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
  /**
   * Session/runtime MessageBus threaded into the SubagentOrchestrator so
   * non-interactive subagent tool execution can satisfy
   * Config.getOrCreateScheduler's explicit MessageBus dependency (Issue #2312).
   */
  messageBus: MessageBus | undefined;
}

/** Tool record for settings UI */
export interface ToolRecord {
  toolClass: ToolConstructor | undefined;
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

/** Minimal constructor shape for declarative tools. */
type ToolConstructor = new (...args: never[]) => AnyDeclarativeTool;

type RegisterCoreToolFn = (
  ToolClass: ToolConstructor,
  ...args: unknown[]
) => void;

function buildRegisterCoreTool(
  registry: ToolRegistry,
  effectiveCoreTools: string[] | undefined,
  excludeTools: string[] | undefined,
  allPotentialTools: ToolRecord[],
): RegisterCoreToolFn {
  return (ToolClass: ToolConstructor, ...args: unknown[]) => {
    const className = (ToolClass as { name: string }).name;
    const rawName = (ToolClass as unknown as { Name?: unknown }).Name;
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
      registry.registerTool(new ToolClass(...(args as never[])));
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

function pushMissingTaskToolRegistrationRecord(
  allPotentialTools: ToolRecord[],
  effectiveCoreTools: string[] | undefined,
  excludeTools: string[] | undefined,
  profileManager: ProfileManager | undefined,
  subagentManager: SubagentManager | undefined,
): void {
  const isEnabled =
    effectiveCoreTools === undefined ||
    effectiveCoreTools.some((tool) =>
      matchesToolIdentifier(tool, TASK_TOOL_CLASS_NAME),
    ) ||
    effectiveCoreTools.some((tool) =>
      matchesToolIdentifier(tool, TASK_TOOL_NAME),
    );
  const isExcluded = (excludeTools ?? []).some(
    (tool) =>
      matchesToolIdentifier(tool, TASK_TOOL_CLASS_NAME) ||
      matchesToolIdentifier(tool, TASK_TOOL_NAME),
  );

  if (!isEnabled || isExcluded) {
    allPotentialTools.push({
      toolClass: undefined,
      toolName: TASK_TOOL_CLASS_NAME,
      displayName: TASK_TOOL_NAME,
      isRegistered: false,
      reason: isExcluded
        ? 'excluded by excludeTools setting'
        : 'not included in coreTools configuration',
      args: [],
    });
    return;
  }

  allPotentialTools.push({
    toolClass: undefined,
    toolName: TASK_TOOL_CLASS_NAME,
    displayName: TASK_TOOL_NAME,
    isRegistered: false,
    reason:
      profileManager === undefined || subagentManager === undefined
        ? getTaskToolMissingReason(profileManager, subagentManager)
        : 'TaskTool registration was not provided by the composition root',
    args: [],
  });
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
  config: Config,
  host: ToolRegistryHost,
  messageBus: MessageBus,
): void {
  const toolHostAdapter = new CoreToolHostAdapter(config);
  const ideServiceAdapter = new CoreIdeServiceAdapter(config);
  const lspServiceAdapter = new CoreLspServiceAdapter(config);
  const toolKeyStorageAdapter = new CoreToolKeyStorageAdapter();
  const settingsServiceAdapter = new CoreSettingsServiceAdapter(config);
  const webSearchServiceAdapter = new CoreWebSearchServiceAdapter(config);
  const storageServiceAdapter = new CoreStorageServiceAdapter();
  const messageBusAdapter = new CoreMessageBusAdapter(messageBus);
  const todoServiceAdapter = new CoreTodoServiceAdapter();

  registerCoreTool(LSTool, toolHostAdapter);
  registerCoreTool(ReadFileTool, toolHostAdapter);

  if (host.getUseRipgrep()) {
    registerCoreTool(RipGrepTool, toolHostAdapter);
  } else {
    registerCoreTool(GrepTool, toolHostAdapter);
  }

  registerCoreTool(GlobTool, toolHostAdapter);
  registerCoreTool(
    EditTool,
    toolHostAdapter,
    ideServiceAdapter,
    lspServiceAdapter,
  );
  registerCoreTool(ASTEditTool, toolHostAdapter, lspServiceAdapter);
  registerCoreTool(WriteFileTool, toolHostAdapter);
  registerCoreTool(GoogleWebFetchTool, toolHostAdapter);
  registerCoreTool(ReadManyFilesTool, toolHostAdapter);
  registerCoreTool(ReadLineRangeTool, toolHostAdapter);
  registerCoreTool(ASTReadFileTool, toolHostAdapter);
  // @plan PLAN-20260211-ASTGREP.P05
  registerCoreTool(AstGrepTool, toolHostAdapter);
  registerCoreTool(StructuralAnalysisTool, toolHostAdapter);
  registerCoreTool(
    DeleteLineRangeTool,
    toolHostAdapter,
    ideServiceAdapter,
    lspServiceAdapter,
  );
  registerCoreTool(
    InsertAtLineTool,
    toolHostAdapter,
    ideServiceAdapter,
    lspServiceAdapter,
  );
  registerCoreTool(
    ApplyPatchTool,
    toolHostAdapter,
    ideServiceAdapter,
    lspServiceAdapter,
  );
  registerCoreTool(
    ShellTool,
    new CoreShellToolHostAdapter(config),
    messageBusAdapter,
  );
  registerCoreTool(MemoryTool, {
    storageService: storageServiceAdapter,
    settingsService: settingsServiceAdapter,
    getWorkingDir: () => config.getWorkingDir(),
    messageBus: messageBusAdapter,
  });
  registerCoreTool(GoogleWebSearchTool, webSearchServiceAdapter);
  registerCoreTool(ExaWebSearchTool, { keyStorage: toolKeyStorageAdapter });
  registerCoreTool(TodoWrite, todoServiceAdapter, toolHostAdapter);
  registerCoreTool(TodoRead, todoServiceAdapter);
  registerCoreTool(TodoPause, todoServiceAdapter, toolHostAdapter);
  registerCoreTool(CodeSearchTool, {
    keyStorage: toolKeyStorageAdapter,
    settingsService: settingsServiceAdapter,
  });
  registerCoreTool(DirectWebFetchTool, toolHostAdapter);

  void CoreIdeServiceAdapter;
  void CoreLspServiceAdapter;
}

function resolveManagers(host: ToolRegistryHost): {
  profileManager: ProfileManager;
  subagentManager: SubagentManager;
} {
  let profileManager = host.getProfileManager();
  if (!profileManager) {
    const profilesDir = path.join(Storage.getGlobalConfigDir(), 'profiles');
    profileManager = new ProfileManager(profilesDir);
    host.setProfileManager(profileManager);
  }

  let subagentManager = host.getSubagentManager();
  if (subagentManager === undefined) {
    const subagentsDir = path.join(Storage.getGlobalConfigDir(), 'subagents');
    subagentManager = new SubagentManager(subagentsDir, profileManager);
    host.setSubagentManager(subagentManager);
  }

  return { profileManager, subagentManager };
}

function registerAgentTools(
  registerCoreTool: RegisterCoreToolFn,
  config: Config,
  profileManager: ProfileManager | undefined,
  subagentManager: SubagentManager | undefined,
  host: ToolRegistryHost,
  allPotentialTools: ToolRecord[],
  registry: ToolRegistry,
  effectiveCoreTools: string[] | undefined,
  messageBus: MessageBus,
): void {
  // @plan PLAN-20260610-ISSUE1592.P03
  // @requirement REQ-INV-003
  // Resolve registration from the composition root. If absent, core records a
  // disabled diagnostic entry without importing the agents-owned TaskTool class.
  const registration = host.getTaskToolRegistration();

  if (registration === undefined) {
    pushMissingTaskToolRegistrationRecord(
      allPotentialTools,
      effectiveCoreTools,
      host.getExcludeTools(),
      profileManager,
      subagentManager,
    );
  } else {
    const taskToolArgs = {
      profileManager,
      subagentManager,
      schedulerFactoryProvider: () =>
        host.getInteractiveSubagentSchedulerFactory(),
      getAsyncTaskManager: () => host.getAsyncTaskManager(),
      messageBus,
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
      // Missing-manager path: preserved exactly from today's behavior when the
      // composition root provides the agents-owned TaskTool registration.
      const isExcluded = (host.getExcludeTools() ?? []).some(
        (tool) =>
          matchesToolIdentifier(tool, TASK_TOOL_CLASS_NAME) ||
          matchesToolIdentifier(tool, TASK_TOOL_NAME),
      );
      const taskToolRecord: ToolRecord = {
        toolClass: registration.toolClass,
        toolName: TASK_TOOL_CLASS_NAME,
        displayName: registration.staticName,
        isRegistered: false,
        reason: isExcluded
          ? 'excluded by excludeTools setting'
          : getTaskToolMissingReason(profileManager, subagentManager),
        args: registration.buildArgs(config, taskToolArgs),
      };
      allPotentialTools.push(taskToolRecord);
    }
  }

  const listSubagentsArgs = new CoreSubagentServiceAdapter(() =>
    host.getSubagentManager(),
  );

  registerCoreTool(ListSubagentsTool, listSubagentsArgs);

  // @plan PLAN-20260130-ASYNCTASK.P14
  const checkAsyncTasksArgs = new CoreAsyncTaskServiceAdapter(() =>
    host.getAsyncTaskManager(),
  );
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
  config: ConfigBaseCore,
  messageBus: MessageBus,
): Promise<{ registry: ToolRegistry; allPotentialTools: ToolRecord[] }> {
  const registry = new ToolRegistry(
    new CoreToolRegistryHostAdapter(config as Config),
    new CoreMessageBusAdapter(messageBus),
  );
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

  registerStandardTools(registerCoreTool, config as Config, host, messageBus);

  const { profileManager, subagentManager } = resolveManagers(host);

  registerAgentTools(
    registerCoreTool,
    config as Config,
    profileManager,
    subagentManager,
    host,
    allPotentialTools,
    registry,
    effectiveCoreTools,
    messageBus,
  );

  await registry.discoverAllTools();
  registry.sortTools();
  return { registry, allPotentialTools };
}
