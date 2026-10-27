import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import type {
  GitHubReportOperations,
  RegistryPolicy,
  ToolExecutionPolicy,
} from '@vybestack/llxprt-code-tools';
import type { NetworkFetch } from '../utils/fetch.js';
/**
 * Tool registry factory — extracted from Config.createToolRegistry().
 *
 * Creates and populates a ToolRegistry with all core tools,
 * applying coreTools/excludeTools governance.
 */

import type {
  WorkspaceIgnoreOperations,
  WorkspacePathOperations,
  WorkspaceScanOperations,
  WorkspaceTextOperations,
} from '../services/workspace-filesystem-owner.js';

import {
  ASTEditTool,
  ASTReadFileTool,
  ApplyPatchTool,
  AstGrepTool,
  CheckAsyncTasksTool,
  CodeSearchTool,
  DeleteLineRangeTool,
  DirectWebFetchTool,
  EditTool,
  ExaWebSearchTool,
  GenerateImageTool,
  GithubTool,
  GlobTool,
  GrepTool,
  InsertAtLineTool,
  LSTool,
  ListSubagentsTool,
  MemoryTool,
  ReadFileTool,
  ReadLineRangeTool,
  ReadManyFilesTool,
  RipGrepTool,
  ShellTool,
  StructuralAnalysisTool,
  TodoPause,
  TodoRead,
  TodoWrite,
  ToolRegistry,
  WriteFileTool,
} from '@vybestack/llxprt-code-tools';
import { resolveImageDimensionBudget } from '@vybestack/llxprt-code-tools/utils/imageDimensionBudget.js';

import type {
  AnyDeclarativeTool,
  ILspService,
} from '@vybestack/llxprt-code-tools';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { ImageOperationRunner } from '../services/image/imageCapability.js';
import { ImageOperationError } from '../services/image/imageOperation.js';
import type {
  ProfileDefinitionReads,
  SubagentDefinitionReads,
} from '../services/workspace-definition-owner.js';
import type { WorkspaceIdePort } from '../services/workspace-ide-owner.js';
import type { WorkspaceTrustReadPort } from '../services/workspace-trust-reader.js';
import { CoreAsyncTaskServiceAdapter } from '../tools-adapters/CoreAsyncTaskServiceAdapter.js';
import { CoreIdeServiceAdapter } from '../tools-adapters/CoreIdeServiceAdapter.js';
import { CoreMessageBusAdapter } from '../tools-adapters/CoreMessageBusAdapter.js';
import { CoreShellToolHostAdapter } from '../tools-adapters/CoreShellToolHostAdapter.js';
import { CoreStorageServiceAdapter } from '../tools-adapters/CoreStorageServiceAdapter.js';
import { CoreTodoServiceAdapter } from '../tools-adapters/CoreTodoServiceAdapter.js';
import { CoreToolHostAdapter } from '../tools-adapters/CoreToolHostAdapter.js';
import { CoreToolKeyStorageAdapter } from '../tools-adapters/CoreToolKeyStorageAdapter.js';
import { CoreToolRegistryHostAdapter } from '../tools-adapters/CoreToolRegistryHostAdapter.js';
import { SubagentCatalog } from '../tools-adapters/subagentCatalog.js';
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
  buildArgs(): unknown[];
  /** Create a tool instance already bound to its session. */
  create(): AnyDeclarativeTool;
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

/** Workspace filesystem, trust and definition readers tool construction needs. */
export interface ToolRegistryWorkspace {
  readonly paths: WorkspacePathOperations;
  readonly files: WorkspaceTextOperations;
  readonly ignore: WorkspaceIgnoreOperations;
  readonly scans: WorkspaceScanOperations;
  readonly trust: WorkspaceTrustReadPort;
}

/** Profile and subagent definition readers tool construction needs. */
export interface ToolRegistryDefinitions {
  readonly profiles: ProfileDefinitionReads;
  readonly subagents: SubagentDefinitionReads;
}

/**
 * Everything one registry construction needs.
 *
 * Required keys are the ones construction cannot proceed without; the
 * optional keys describe capabilities a host may legitimately not have (no
 * IDE, no image backend, no GitHub broker), or defaults.
 */
export interface ToolRegistryCreation {
  readonly config: Config;
  readonly host: ToolRegistryHost;
  readonly messageBus: MessageBus;
  readonly readTaskSchemaPolicy: () => RegistryPolicy;
  readonly readExecution: () => ToolExecutionPolicy;
  readonly workspace: ToolRegistryWorkspace;
  readonly definitions: ToolRegistryDefinitions;
  /** Absent registration records a disabled task-tool diagnostic; never throws. */
  readonly registration: TaskToolRegistration | undefined;
  readonly lspDiagnostics?: ILspService;
  readonly ide?: WorkspaceIdePort;
  readonly summarizeOutput?: ToolOutputSummarizer;
  readonly githubReports?: GitHubReportOperations;
  readonly imageOperation?: ImageOperationRunner;
  readonly telemetry?: RootTelemetry;
  readonly discover?: boolean;
  readonly requestFetch: NetworkFetch;
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
): void {
  const className = registration.className;
  const toolName = registration.staticName || className;
  const args = registration.buildArgs();
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
    registry.registerTool(registration.create());
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

/** Shell and memory tools share the file-backed workspace and execution policy. */
interface ShellAndMemoryRegistration {
  readonly config: Config;
  readonly paths: WorkspacePathOperations;
  readonly readExecution: () => ToolExecutionPolicy;
  readonly summarizeOutput?: ToolOutputSummarizer;
  readonly messageBusAdapter: CoreMessageBusAdapter;
}

function registerShellAndMemoryTools(
  registerCoreTool: RegisterCoreToolFn,
  input: ShellAndMemoryRegistration,
): void {
  const { config, paths, readExecution, summarizeOutput, messageBusAdapter } =
    input;
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
}

/** Inputs that shape every standard (non-agent) tool registration. */
interface StandardToolRegistration {
  readonly config: Config;
  readonly host: ToolRegistryHost;
  readonly messageBus: MessageBus;
  readonly workspace: ToolRegistryWorkspace;
  readonly toolHostAdapter: CoreToolHostAdapter;
  readonly readExecution: () => ToolExecutionPolicy;
  readonly summarizeOutput?: ToolOutputSummarizer;
  readonly lspDiagnostics?: ILspService;
  readonly ide?: WorkspaceIdePort;
  readonly githubReports?: GitHubReportOperations;
  readonly imageOperation?: ImageOperationRunner;
  readonly requestFetch: NetworkFetch;
}

function registerStandardTools(
  registerCoreTool: RegisterCoreToolFn,
  input: StandardToolRegistration,
): void {
  const {
    config,
    host,
    messageBus,
    workspace,
    toolHostAdapter,
    readExecution,
    summarizeOutput,
    lspDiagnostics,
    ide,
    githubReports,
    imageOperation,
    requestFetch,
  } = input;
  const ideServiceAdapter = new CoreIdeServiceAdapter(
    ide?.openDiff.bind(ide),
    ide?.readConnection.bind(ide),
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
  registerShellAndMemoryTools(registerCoreTool, {
    config,
    paths: workspace.paths,
    readExecution,
    summarizeOutput,
    messageBusAdapter,
  });

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
  registerNetworkTools(
    registerCoreTool,
    toolKeyStorageAdapter,
    toolHostAdapter,
    readExecution,
    requestFetch,
  );

  registerImageTool(registerCoreTool, readExecution, imageOperation);
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

/** Inputs that shape the agent-owned tool registrations. */
interface AgentToolRegistration {
  readonly host: ToolRegistryHost;
  readonly allPotentialTools: ToolRecord[];
  readonly registry: ToolRegistry;
  readonly effectiveCoreTools: string[] | undefined;
  readonly definitions: ToolRegistryDefinitions;
  /** Absent registration records a disabled task-tool diagnostic; never throws. */
  readonly registration: TaskToolRegistration | undefined;
}

function registerAgentTools(
  registerCoreTool: RegisterCoreToolFn,
  input: AgentToolRegistration,
): void {
  const {
    host,
    allPotentialTools,
    registry,
    effectiveCoreTools,
    definitions,
    registration,
  } = input;
  // @plan PLAN-20260610-ISSUE1592.P03
  // @requirement REQ-INV-003
  // Resolve registration from the composition root. If absent, core records a
  // disabled diagnostic entry without importing the agents-owned TaskTool class.

  if (registration === undefined) {
    pushMissingTaskToolRegistrationRecord(
      allPotentialTools,
      effectiveCoreTools,
      host.getExcludeTools(),
      definitions.profiles,
      definitions.subagents,
    );
  } else {
    registerTaskTool(
      registry,
      effectiveCoreTools,
      host.getExcludeTools(),
      allPotentialTools,
      registration,
    );
  }

  registerCoreTool(
    ListSubagentsTool,
    new SubagentCatalog(definitions.subagents),
  );

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
export type ToolOutputSummarizer = (
  content: string,
  signal: AbortSignal,
  tokenBudget?: number,
) => Promise<string>;

export async function createToolRegistry(
  input: ToolRegistryCreation,
): Promise<{ registry: ToolRegistry; allPotentialTools: ToolRecord[] }> {
  const { config, host, messageBus, readTaskSchemaPolicy, readExecution } =
    input;
  const { workspace, definitions } = input;
  const discover = input.discover ?? true;
  const requestFetch = input.requestFetch;
  const registry = new ToolRegistry(
    new CoreToolRegistryHostAdapter(config, workspace.trust),
    new CoreMessageBusAdapter(messageBus),
    readTaskSchemaPolicy,
  );
  const allPotentialTools: ToolRecord[] = [];

  const registerCoreTool = buildRegisterCoreTool(
    registry,
    host,
    allPotentialTools,
  );

  registerStandardTools(registerCoreTool, {
    config,
    host,
    messageBus,
    workspace,
    toolHostAdapter: new CoreToolHostAdapter(
      config,
      workspace.paths,
      workspace.files,
      workspace.ignore,
      workspace.scans,
      readExecution,
      workspace.trust,
      input.telemetry,
    ),
    readExecution,
    lspDiagnostics: input.lspDiagnostics,
    ide: input.ide,
    summarizeOutput: input.summarizeOutput,
    githubReports: input.githubReports,
    imageOperation: input.imageOperation,
    requestFetch,
  });

  registerAgentTools(registerCoreTool, {
    host,
    allPotentialTools,
    registry,
    effectiveCoreTools: effectiveRegistryCoreTools(host.getCoreTools()),
    definitions,
    registration: input.registration,
  });

  return finishToolRegistry(registry, allPotentialTools, discover);
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

function registerNetworkTools(
  registerCoreTool: RegisterCoreToolFn,
  toolKeyStorageAdapter: CoreToolKeyStorageAdapter,
  toolHostAdapter: CoreToolHostAdapter,
  readExecution: () => ToolExecutionPolicy,
  requestFetch: NetworkFetch,
): void {
  registerCoreTool(ExaWebSearchTool, {
    keyStorage: toolKeyStorageAdapter,
    fetch: requestFetch,
  });
  registerCoreTool(CodeSearchTool, {
    keyStorage: toolKeyStorageAdapter,
    fetch: requestFetch,
    readTokenLimit: () => readExecution()['tool-output-max-tokens'],
  });
  registerCoreTool(DirectWebFetchTool, toolHostAdapter, requestFetch);
}

async function finishToolRegistry(
  registry: ToolRegistry,
  allPotentialTools: ToolRecord[],
  discover: boolean,
): Promise<{ registry: ToolRegistry; allPotentialTools: ToolRecord[] }> {
  if (discover) await registry.discoverAllTools();
  registry.sortTools();
  return { registry, allPotentialTools };
}
