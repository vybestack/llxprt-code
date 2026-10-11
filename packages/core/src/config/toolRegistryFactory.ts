import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import type { GitHubReportOperations } from '@vybestack/llxprt-code-tools';
import type {
  TaskExecutionPolicy,
  SubagentRunPolicy,
} from '../session/session-settings-policies.js';
import type { SessionHookOwner } from '../hooks/session-hook-owner.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ToolGovernance } from '@vybestack/llxprt-code-tools';
import type { ToolExecutionPolicy } from '@vybestack/llxprt-code-tools';
import type { RegistryPolicy } from '@vybestack/llxprt-code-tools';
/**
 * Tool registry factory — extracted from Config.createToolRegistry().
 *
 * Creates and populates a ToolRegistry with all core tools,
 * applying coreTools/excludeTools governance.
 */
import type { WorkspaceTrustControlPort } from '../services/workspace-trust-ports.js';

import type { InstructionReadOperations } from '../services/workspace-memory-owner.js';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type {
  WorkspacePathOperations,
  WorkspaceTextOperations,
  WorkspaceScanOperations,
  WorkspaceIgnoreOperations,
} from '../services/workspace-filesystem-owner.js';

import { ToolRegistry } from '@vybestack/llxprt-code-tools';
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
  ExaWebSearchTool,
  GithubTool,
  CodeSearchTool,
  DirectWebFetchTool,
  MemoryTool,
  ShellTool,
  GenerateImageTool,
} from '@vybestack/llxprt-code-tools';
import { resolveImageDimensionBudget } from '@vybestack/llxprt-code-tools/utils/imageDimensionBudget.js';

import { CoreToolHostAdapter } from '../tools-adapters/CoreToolHostAdapter.js';
import { CoreIdeServiceAdapter } from '../tools-adapters/CoreIdeServiceAdapter.js';
import { CoreToolKeyStorageAdapter } from '../tools-adapters/CoreToolKeyStorageAdapter.js';
import { CoreStorageServiceAdapter } from '../tools-adapters/CoreStorageServiceAdapter.js';
import { CoreMessageBusAdapter } from '../tools-adapters/CoreMessageBusAdapter.js';
import { CoreShellToolHostAdapter } from '../tools-adapters/CoreShellToolHostAdapter.js';
import { SubagentCatalog } from '../tools-adapters/subagentCatalog.js';
import { CoreAsyncTaskServiceAdapter } from '../tools-adapters/CoreAsyncTaskServiceAdapter.js';
import { CoreToolRegistryHostAdapter } from '../tools-adapters/CoreToolRegistryHostAdapter.js';
import { CoreTodoServiceAdapter } from '../tools-adapters/CoreTodoServiceAdapter.js';
import type { ImageOperationRunner } from '../services/image/imageCapability.js';
import { ImageOperationError } from '../services/image/imageOperation.js';
import type {
  ProfileDefinitionReads,
  SubagentDefinitionReads,
} from '../services/workspace-definition-owner.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type {
  ILspService,
  AnyDeclarativeTool,
} from '@vybestack/llxprt-code-tools';
import type { WorkspaceTrustReadPort } from '../services/workspace-trust-reader.js';
import type { WorkspaceIdePort } from '../services/workspace-ide-owner.js';
import type { Config } from './config.js';

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
  readonly hookOwner?: SessionHookOwner;
  readonly workspaceTrust?: WorkspaceTrustControlPort;
  createChildSettings?: () => SettingsService;
  readonly telemetry?: RootTelemetry;
  readTaskPolicy?: () => TaskExecutionPolicy;
  readRunPolicy?: () => SubagentRunPolicy;
  readGovernance?: () => ToolGovernance;
  instructions?: InstructionReadOperations;
  readonly toolSelection?: ToolSelection;
  workspacePaths?: WorkspacePathOperations;
  readMcpInstructions?: () => string | undefined;
  profileManager: ProfileDefinitionReads | undefined;
  subagentManager: SubagentDefinitionReads | undefined;
  /**
   * Required session/runtime MessageBus threaded into the SubagentOrchestrator so
   * child execution shares the parent approval routing.
   */
  messageBus: MessageBus;
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
  /**
   * @plan PLAN-20260610-ISSUE1592.P01
   * @requirement REQ-INV-003
   * Returns the injected TaskToolRegistration, or undefined to use core-local default.
   */
}

function getTaskToolMissingReason(
  profileManager: ProfileDefinitionReads | undefined,
  subagentManager: SubagentDefinitionReads | undefined,
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
  host: ToolRegistryHost,
  allPotentialTools: ToolRecord[],
): RegisterCoreToolFn {
  const effectiveCoreTools = effectiveRegistryCoreTools(host.getCoreTools());
  const excludeTools = host.getExcludeTools();
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
  profileManager: ProfileDefinitionReads | undefined,
  subagentManager: SubagentDefinitionReads | undefined,
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

function registerMemoryTool(
  registerCoreTool: RegisterCoreToolFn,
  config: Config,
  readExecution: () => ToolExecutionPolicy,
  messageBusAdapter: CoreMessageBusAdapter,
): void {
  registerCoreTool(MemoryTool, {
    contextFilename: config.getMemorySettings().filenames[0],
    storageService: new CoreStorageServiceAdapter(
      config.globalConfigRoot,
      config.globalDataRoot,
    ),
    canSaveCore: () => readExecution()['model.canSaveCore'] === true,
    getWorkingDir: () => config.getWorkingDir(),
    messageBus: messageBusAdapter,
  });
}

function registerStandardTools(
  registerCoreTool: RegisterCoreToolFn,
  config: Config,
  host: ToolRegistryHost,
  messageBus: MessageBus,
  paths: WorkspacePathOperations,
  toolHostAdapter: CoreToolHostAdapter,
  readExecution: () => ToolExecutionPolicy,
  summarizeOutput?: (
    content: string,
    signal: AbortSignal,
    tokenBudget?: number,
  ) => Promise<string>,
  lspDiagnostics?: ILspService,
  ide?: WorkspaceIdePort,
  githubReports?: GitHubReportOperations,
  imageOperation?: ImageOperationRunner,
): void {
  const ideServiceAdapter = new CoreIdeServiceAdapter(
    ide ?? { getClient: () => undefined },
  );
  const toolKeyStorageAdapter = new CoreToolKeyStorageAdapter();
  const messageBusAdapter = new CoreMessageBusAdapter(messageBus);
  const todoServiceAdapter = new CoreTodoServiceAdapter(
    () => config.globalDataRoot,
  );

  // Editing tools that need both IDE diff and LSP diagnostic adapters share
  // the same registration shape; collapsed here to keep this function within
  // the max-lines-per-function limit.
  const registerIdeLspTool = (ToolClass: ToolConstructor): void =>
    registerCoreTool(
      ToolClass,
      toolHostAdapter,
      ideServiceAdapter,
      lspDiagnostics,
    );

  registerCoreTool(LSTool, toolHostAdapter);
  registerCoreTool(ReadFileTool, toolHostAdapter);

  if (host.getUseRipgrep()) {
    registerCoreTool(RipGrepTool, toolHostAdapter);
  } else {
    registerCoreTool(GrepTool, toolHostAdapter);
  }

  registerCoreTool(GlobTool, toolHostAdapter);
  registerIdeLspTool(EditTool);
  registerIdeLspTool(ASTEditTool);
  registerCoreTool(WriteFileTool, toolHostAdapter, ideServiceAdapter);
  registerCoreTool(ReadManyFilesTool, toolHostAdapter);
  registerCoreTool(ReadLineRangeTool, toolHostAdapter);
  registerCoreTool(ASTReadFileTool, toolHostAdapter);
  // @plan PLAN-20260211-ASTGREP.P05
  registerCoreTool(AstGrepTool, toolHostAdapter);
  registerCoreTool(StructuralAnalysisTool, toolHostAdapter);
  registerIdeLspTool(DeleteLineRangeTool);
  registerIdeLspTool(InsertAtLineTool);
  registerIdeLspTool(ApplyPatchTool);
  registerCoreTool(
    ShellTool,
    new CoreShellToolHostAdapter(config, paths, readExecution, summarizeOutput),
    messageBusAdapter,
  );
  registerMemoryTool(
    registerCoreTool,
    config,
    readExecution,
    messageBusAdapter,
  );
  registerCoreTool(ExaWebSearchTool, { keyStorage: toolKeyStorageAdapter });
  // Registered only when the CLI layer supplied a broker transport, so a
  // host without the wiring does not advertise a tool it cannot serve.
  // @plan PLAN-20260731-GHBROKER.P15
  // @requirement REQ-003, REQ-008
  if (githubReports !== undefined) {
    registerCoreTool(GithubTool, githubReports, messageBusAdapter);
  }
  registerCoreTool(TodoWrite, todoServiceAdapter, toolHostAdapter);
  registerCoreTool(TodoRead, todoServiceAdapter);
  registerCoreTool(TodoPause, todoServiceAdapter, toolHostAdapter);
  registerCoreTool(CodeSearchTool, {
    keyStorage: toolKeyStorageAdapter,
    readTokenLimit: () => readExecution()['tool-output-max-tokens'],
  });
  registerCoreTool(DirectWebFetchTool, toolHostAdapter);

  registerImageTool(registerCoreTool, readExecution, imageOperation);

  void CoreIdeServiceAdapter;
}

function registerImageTool(
  registerCoreTool: RegisterCoreToolFn,
  readExecution: () => ToolExecutionPolicy,
  imageOperation: ImageOperationRunner | undefined,
): void {
  registerCoreTool(GenerateImageTool, {
    runImage: (input: {
      readonly prompt: string;
      readonly output_path: string;
      readonly input_paths?: readonly string[];
      readonly signal?: AbortSignal;
    }) => {
      if (imageOperation === undefined)
        throw new ImageOperationError(
          'No image-capable backend is registered for the current setup.',
          'capability',
        );
      return imageOperation({
        prompt: input.prompt,
        outputPath: input.output_path,
        inputPaths: input.input_paths,
        signal: input.signal,
      });
    },
    getImageDimensionBudget: () =>
      resolveImageDimensionBudget({ ...readExecution() }),
  });
}

function registerAgentTools(
  registerCoreTool: RegisterCoreToolFn,
  config: Config,
  profileManager: ProfileDefinitionReads,
  subagentManager: SubagentDefinitionReads,
  host: ToolRegistryHost,
  allPotentialTools: ToolRecord[],
  registry: ToolRegistry,
  effectiveCoreTools: string[] | undefined,
  messageBus: MessageBus,
  paths: WorkspacePathOperations,
  registration: TaskToolRegistration | undefined,
  readMcpInstructions: (() => string | undefined) | undefined,
): void {
  // @plan PLAN-20260610-ISSUE1592.P03
  // @requirement REQ-INV-003
  // Resolve registration from the composition root. If absent, core records a
  // disabled diagnostic entry without importing the agents-owned TaskTool class.

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
      workspacePaths: paths,
      readMcpInstructions,
      profileManager,
      subagentManager,
      messageBus,
    };

    registerTaskTool(
      registry,
      effectiveCoreTools,
      host.getExcludeTools(),
      allPotentialTools,
      registration,
      config,
      taskToolArgs,
    );
  }

  registerCoreTool(ListSubagentsTool, new SubagentCatalog(subagentManager));

  const checkAsyncTasksArgs = new CoreAsyncTaskServiceAdapter();
  registerCoreTool(CheckAsyncTasksTool, checkAsyncTasksArgs);
}

/**
 * Carries a task-tool registration that arrived AFTER the tool registry was
 * built into the LIVE registry (issue #3222).
 *
 * The registration is consumed only at registry construction, so a Config
 * that was initialized before a registration was installed (for example the
 * fromConfig adoption path, whose ensureInitialized is a no-op for
 * already-initialized Configs) built its registry without the task tool.
 * This registers the missing tool against the EXISTING registry under the
 * same governance rules as build time — it never overrides an existing task
 * tool, smuggles the tool past coreTools/excludeTools exclusions, or touches
 * any other registry contents — and replaces the stale
 * missing-registration diagnostic record so the settings surface reflects the
 * reconciled truth.
 *
 * @plan PLAN-20260610-ISSUE1592.P01
 * @requirement REQ-INV-003
 *
 * @returns true when this call registered the task tool.
 */
/**
 * Creates and populates a ToolRegistry with all core tools.
 *
 * Applies coreTools allow-list and excludeTools deny-list governance.
 * Returns the registry and the list of all potential tools (for settings UI).
 */
type ToolOutputSummarizer = (
  content: string,
  signal: AbortSignal,
  tokenBudget?: number,
) => Promise<string>;

export async function createToolRegistry(
  host: ToolRegistryHost,
  config: Config,
  messageBus: MessageBus,
  readTaskSchemaPolicy: () => RegistryPolicy,
  readExecution: () => ToolExecutionPolicy,
  paths: WorkspacePathOperations,
  files: WorkspaceTextOperations,
  ignore: WorkspaceIgnoreOperations,
  scans: WorkspaceScanOperations,
  summarizeOutput?: ToolOutputSummarizer,
  lspDiagnostics?: ILspService,
  registration?: TaskToolRegistration,
  readMcpInstructions?: () => string | undefined,
  discover = true,
  profileManager?: ProfileDefinitionReads,
  subagentManager?: SubagentDefinitionReads,
  ide?: WorkspaceIdePort,
  trust?: WorkspaceTrustReadPort,
  githubReports?: GitHubReportOperations,
  imageOperation?: ImageOperationRunner,
  telemetry?: RootTelemetry,
): Promise<{ registry: ToolRegistry; allPotentialTools: ToolRecord[] }> {
  const selected = requireRegistryAssembly(
    profileManager,
    subagentManager,
    trust,
  );
  const registry = new ToolRegistry(
    new CoreToolRegistryHostAdapter(config, selected[2]),
    new CoreMessageBusAdapter(messageBus),
    readTaskSchemaPolicy,
  );
  const allPotentialTools: ToolRecord[] = [];

  const registerCoreTool = buildRegisterCoreTool(
    registry,
    host,
    allPotentialTools,
  );

  registerStandardTools(
    registerCoreTool,
    config,
    host,
    messageBus,
    paths,
    new CoreToolHostAdapter(
      config,
      paths,
      files,
      ignore,
      scans,
      readExecution,
      selected[2],
      telemetry,
    ),
    readExecution,
    summarizeOutput,
    lspDiagnostics,
    ide,
    githubReports,
    imageOperation,
  );

  registerAgentTools(
    registerCoreTool,
    config,
    selected[0],
    selected[1],
    host,
    allPotentialTools,
    registry,
    effectiveRegistryCoreTools(host.getCoreTools()),
    messageBus,
    paths,
    registration,
    readMcpInstructions,
  );

  if (discover) await registry.discoverAllTools();
  registry.sortTools();
  return { registry, allPotentialTools };
}

function effectiveRegistryCoreTools(
  baseCoreTools: string[] | undefined,
): string[] | undefined {
  const effectiveCoreTools =
    baseCoreTools && baseCoreTools.length > 0 ? [...baseCoreTools] : undefined;

  // @plan PLAN-20260610-ISSUE1592.P01
  // @requirement REQ-INV-003
  // Use constants instead of TaskTool class references
  ensureCoreToolIncluded(effectiveCoreTools, TASK_TOOL_CLASS_NAME);
  ensureCoreToolIncluded(effectiveCoreTools, TASK_TOOL_NAME);
  ensureCoreToolIncluded(effectiveCoreTools, 'ListSubagentsTool');
  ensureCoreToolIncluded(effectiveCoreTools, ListSubagentsTool.Name);

  return effectiveCoreTools;
}

function requireRegistryAssembly(
  profiles: ProfileDefinitionReads | undefined,
  subagents: SubagentDefinitionReads | undefined,
  trust: WorkspaceTrustReadPort | undefined,
): readonly [
  ProfileDefinitionReads,
  SubagentDefinitionReads,
  WorkspaceTrustReadPort,
] {
  if (profiles === undefined || subagents === undefined)
    throw new Error(
      'Tool construction requires explicit workspace definition readers',
    );
  if (trust === undefined)
    throw new Error('Tool construction requires explicit workspace trust');
  return [profiles, subagents, trust];
}
