/**
 * Config constructor logic — extracted to keep Config class under 800 lines.
 *
 * applyConfigParams() applies ConfigParameters to Config fields,
 * initializes dependent services (telemetry, proxy, policy engine),
 * and logs the configuration.
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import * as path from 'node:path';
import process from 'node:process';

import {
  type ConfigParameters,
  ApprovalMode,
  normalizeShellReplacement,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
  DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES,
  type AccessibilitySettings,
  type BugCommandSettings,
  type ChatCompressionSettings,
  type SummarizeToolOutputSettings,
  type ComplexityAnalyzerSettings,
  type OutputSettings,
  type IntrospectionAgentSettings,
  type TelemetrySettings,
  type MCPServerConfig,
  type SandboxConfig,
  type ActiveExtension,
  type ShellReplacementMode,
} from './configTypes.js';
import { DEFAULT_FILE_FILTERING_OPTIONS } from './constants.js';
import { parseLspConfig, type LspState } from './lspIntegration.js';
import { WorkspaceContext } from '../utils/workspaceContext.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import { FileExclusions } from '../utils/ignorePatterns.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { setGlobalProxy } from '../utils/fetch.js';
import { coreEvents } from '../utils/events.js';
import {
  SimpleExtensionLoader,
  type ExtensionLoader,
} from '../utils/extensionLoader.js';
import { SkillManager } from '../skills/skillManager.js';
import { setLlxprtMdFilename } from '@vybestack/llxprt-code-tools';
import type { GitHubBrokerClient } from '@vybestack/llxprt-code-tools';
import { debugLogger } from '../utils/debugLogger.js';
import { initializeTelemetry } from '../telemetry/index.js';
import { OutputFormat } from '../utils/output-format.js';
import { createAgentRuntimeStateFromConfig } from '../runtime/runtimeStateFactory.js';
import {
  StandardFileSystemService,
  type FileSystemService,
} from '../services/fileSystemService.js';
import { createRuntimeSettingsService } from '../runtime/settingsRuntimeAdapter.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { logCliConfiguration, StartSessionEvent } from '../telemetry/index.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import type { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import type { EnvironmentSanitizationConfig } from '../services/environmentSanitization.js';
import type { HookDefinition, HookEventName } from '../hooks/types.js';
import type { RuntimeProviderManager } from '../runtime/contracts/RuntimeProviderManager.js';
import type { EventEmitter } from 'node:events';
import type { Config } from './config.js';
import type { AgentClientFactory } from '../core/clientContract.js';
import type { ToolSchedulerFactory } from '../core/toolSchedulerContract.js';
import type { TaskToolRegistration } from './toolRegistryFactory.js';
import type { PostSkillDiscoveryToolRegistrar } from './configTypes.js';

/**
 * Typed target interface for applyConfigParams — lists every field
 * that the function assigns plus getProxy() which it calls.
 *
 * All fields are public so the interface can be satisfied by Config,
 * whose base class declares them as protected.
 */
export interface ConfigConstructorTarget {
  // Settings service
  settingsService: SettingsService;

  // Core identity and workspace
  sessionId: string;
  embeddingModel: string | undefined;
  fileSystemService: FileSystemService;
  sandbox: SandboxConfig | undefined;
  targetDir: string;
  configuredIncludeDirectories: readonly string[];
  workspaceContext: WorkspaceContext;
  debugMode: boolean;
  outputFormat: OutputFormat;
  question: string | undefined;
  quiet: boolean;

  // Tool governance
  coreTools: string[] | undefined;
  allowedTools: string[] | undefined;
  excludeTools: string[] | undefined;
  toolDiscoveryCommand: string | undefined;
  toolCallCommand: string | undefined;
  mcpServerCommand: string | undefined;
  mcpServers: Record<string, MCPServerConfig> | undefined;
  allowedMcpServers: string[];
  blockedMcpServers: Array<{ name: string; extensionName: string }>;

  // LSP
  _lspState: LspState;

  // Memory and context
  userMemory: string;
  llxprtMdFileCount: number;
  llxprtMdFilePaths: string[];
  approvalMode: ApprovalMode;
  showMemoryUsage: boolean;
  accessibility: AccessibilitySettings;

  // Telemetry
  telemetrySettings: TelemetrySettings;
  usageStatisticsEnabled: boolean;

  // File filtering
  fileFiltering: {
    respectGitIgnore: boolean;
    respectLlxprtIgnore: boolean;
    enableRecursiveFileSearch: boolean;
    disableFuzzySearch: boolean;
  };

  // Feature flags and runtime settings
  checkpointing: boolean;
  dumpOnError: boolean;
  proxy: string | undefined;
  cwd: string;
  fileDiscoveryService: FileDiscoveryService | null;
  bugCommand: BugCommandSettings | undefined;
  model: string;
  originalModel: string;
  extensionContextFilePaths: string[];
  maxSessionTurns: number;
  experimentalZedIntegration: boolean;
  listExtensions: boolean;
  _activeExtensions: ActiveExtension[];
  providerManager: RuntimeProviderManager | undefined;
  provider: string | undefined;
  _extensionLoader: ExtensionLoader;
  noBrowser: boolean;
  summarizeToolOutput: Record<string, SummarizeToolOutputSettings> | undefined;
  folderTrust: boolean;
  ideMode: boolean;
  complexityAnalyzerSettings: ComplexityAnalyzerSettings;
  loadMemoryFromIncludeDirectories: boolean;
  chatCompression: ChatCompressionSettings | undefined;
  interactive: boolean;
  shellReplacement: ShellReplacementMode;
  trustedFolder: boolean | undefined;
  useRipgrep: boolean;
  githubBrokerClient: GitHubBrokerClient | undefined;
  shouldUseNodePtyShell: boolean;
  allowPtyThemeOverride: boolean;
  ptyScrollbackLimit: number;
  ptyTerminalWidth: number | undefined;
  ptyTerminalHeight: number | undefined;
  skipNextSpeakerCheck: boolean;
  truncateToolOutputThreshold: number;
  truncateToolOutputLines: number;
  enableToolOutputTruncation: boolean;
  continueOnFailedApiCall: boolean;
  imagePayloadBudgetBytes: number;
  enableShellOutputEfficiency: boolean;
  continueSession: boolean | string;
  extensionManagement: boolean;
  enableExtensionReloading: boolean;
  storage: Storage;
  fileExclusions: FileExclusions;
  enablePromptCompletion: boolean;
  eventEmitter: EventEmitter | undefined;

  // Policy engine and runtime state
  policyEngine: PolicyEngine;
  runtimeState: AgentRuntimeState;
  disableYoloMode: boolean;
  enableHooks: boolean;
  jitContextEnabled: boolean | undefined;
  hooks: { [K in HookEventName]?: HookDefinition[] } | undefined;
  projectHooks:
    | ({ [K in HookEventName]?: HookDefinition[] } & { disabled?: string[] })
    | undefined;
  disabledHooks: string[];
  skillManager: SkillManager;
  skillsSupport: boolean;
  disabledSkills: string[];
  enableHooksUI: boolean;
  adminSkillsEnabled: boolean;
  sanitizationConfig: EnvironmentSanitizationConfig | undefined;
  _onReload:
    | (() => Promise<{
        disabledSkills?: string[];
        adminSkillsEnabled?: boolean;
      }>)
    | undefined;
  _onReloadMcpServers:
    | (() => Promise<{
        mcpServers: Record<string, MCPServerConfig>;
        blockedMcpServers: Array<{ name: string; extensionName: string }>;
        settingsMcpServers: Record<string, MCPServerConfig>;
      }>)
    | undefined;
  outputSettings: OutputSettings;
  introspectionAgentSettings: IntrospectionAgentSettings;
  useWriteTodos: boolean;

  /**
   * @plan PLAN-20260610-ISSUE1592.P01
   * @requirement REQ-INV-001
   */
  agentClientFactory: AgentClientFactory | undefined;
  /**
   * @plan PLAN-20260610-ISSUE1592.P01
   * @requirement REQ-INV-002
   */
  toolSchedulerFactory: ToolSchedulerFactory | undefined;
  /**
   * @plan PLAN-20260610-ISSUE1592.P01
   * @requirement REQ-INV-003
   */
  taskToolRegistration: TaskToolRegistration | undefined;
  postSkillDiscoveryToolRegistrar: PostSkillDiscoveryToolRegistrar | undefined;

  // Called at end of applyConfigParams
  getProxy(): string | undefined;
}

function applySettingsService(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  // The settings service is supplied explicitly by the composition boundary
  // (or a fresh isolated one is created). Constructing a Config never adopts
  // ambient global runtime state and never mutates the active runtime context
  // as a side effect — activating a runtime context is the composition
  // boundary's job (setCliRuntimeContext / activateSettingsRuntimeContext),
  // not the constructor's (issue #2300).
  config.settingsService =
    params.settingsService ?? createRuntimeSettingsService();
}

function applyCoreIdentity(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  config.sessionId = params.sessionId;
  config.embeddingModel = params.embeddingModel;
  config.fileSystemService = new StandardFileSystemService();
  config.sandbox = params.sandbox;
  config.targetDir = path.resolve(params.targetDir);
  config.configuredIncludeDirectories = [...(params.includeDirectories ?? [])];
  config.workspaceContext = new WorkspaceContext(
    config.targetDir,
    params.includeDirectories ?? [],
  );
  config.debugMode = params.debugMode;
  config.outputFormat = params.outputFormat ?? OutputFormat.TEXT;
  config.question = params.question;
  config.quiet = params.quiet ?? false;
}

function applyToolGovernance(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  config.coreTools = params.coreTools;
  config.allowedTools = params.allowedTools;
  config.excludeTools = params.excludeTools;
  config.toolDiscoveryCommand = params.toolDiscoveryCommand;
  config.toolCallCommand = params.toolCallCommand;
  config.mcpServerCommand = params.mcpServerCommand;
  config.mcpServers = params.mcpServers;
  config.allowedMcpServers = params.allowedMcpServers ?? [];
  config.blockedMcpServers = params.blockedMcpServers ?? [];
  config._lspState.lspConfig = parseLspConfig(params.lsp);
}

function applyTelemetryAndMemory(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  applyMemorySettings(config, params);
  applyTelemetrySettings(config, params);
  applyFileFilteringSettings(config, params);
}

function applyMemorySettings(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  config.userMemory = params.userMemory ?? '';
  config.llxprtMdFileCount = params.llxprtMdFileCount ?? 0;
  config.llxprtMdFilePaths = params.llxprtMdFilePaths ?? [];
  config.approvalMode = params.approvalMode ?? ApprovalMode.DEFAULT;
  config.showMemoryUsage = params.showMemoryUsage ?? false;
  config.accessibility = params.accessibility ?? {};
}

function applyTelemetrySettings(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  // Spread first to preserve all fields (e.g. conversationLogPath,
  // customRedactionPatterns, retention settings), then override core fields
  // with explicit defaults.
  config.telemetrySettings = resolveTelemetrySettings(params.telemetry);
  config.usageStatisticsEnabled = params.usageStatisticsEnabled ?? true;
}

/**
 * Returns a shallow copy of `settings` with the nested perf sub-object
 * defensively cloned, so mutating the result (or its perf) cannot reach the
 * source. P09 copy policy: isolation by cloning on every ingress and egress —
 * never by freezing. Used by resolveTelemetrySettings (constructor ingress),
 * Config.updateTelemetrySettings (update ingress), and
 * Config.getTelemetrySettings (egress).
 */
export function withClonedPerf(settings: TelemetrySettings): TelemetrySettings {
  const { perf, ...rest } = settings;
  return { ...rest, ...(perf ? { perf: { ...perf } } : {}) };
}

export function mergeTelemetrySettings(
  current: TelemetrySettings,
  update: Partial<TelemetrySettings>,
): TelemetrySettings {
  return withClonedPerf({ ...current, ...update });
}

/**
 * Defaults for the outfile-bound telemetry controls (#3315). Single source of
 * truth for resolveTelemetrySettings; applied per-key with ?? so explicit
 * undefined from callers (e.g. the CLI builder) still materializes the
 * default.
 */
export const TELEMETRY_OUTFILE_BOUND_DEFAULTS: Readonly<{
  logApiBodies: boolean;
  logApiBodyMaxChars: number;
  outfileMaxBytes: number;
  outfileMaxFiles: number;
}> = Object.freeze({
  logApiBodies: false,
  logApiBodyMaxChars: 4000,
  outfileMaxBytes: 104857600,
  outfileMaxFiles: 10,
});

export function resolveTelemetrySettings(
  telemetry: TelemetrySettings | undefined,
): TelemetrySettings {
  const {
    perf,
    enabled,
    logPrompts,
    logApiBodies,
    logApiBodyMaxChars,
    outfileMaxBytes,
    outfileMaxFiles,
    outfile,
    logConversations,
    logResponses,
    redactSensitiveData,
    redactFilePaths,
    redactUrls,
    redactEmails,
    redactPersonalInfo,
    ...rest
  } = telemetry ?? {};
  // Per-key ?? (not a defaults-first spread): callers like the CLI builder
  // pass explicit undefined for unset keys, and a spread of defaults would be
  // clobbered by those. undefined must always materialize the default.
  return withClonedPerf({
    ...rest,
    enabled: enabled ?? false,
    logPrompts: logPrompts ?? true,
    logApiBodies: logApiBodies ?? TELEMETRY_OUTFILE_BOUND_DEFAULTS.logApiBodies,
    logApiBodyMaxChars:
      logApiBodyMaxChars ?? TELEMETRY_OUTFILE_BOUND_DEFAULTS.logApiBodyMaxChars,
    outfileMaxBytes:
      outfileMaxBytes ?? TELEMETRY_OUTFILE_BOUND_DEFAULTS.outfileMaxBytes,
    outfileMaxFiles:
      outfileMaxFiles ?? TELEMETRY_OUTFILE_BOUND_DEFAULTS.outfileMaxFiles,
    outfile,
    logConversations: logConversations ?? false,
    logResponses: logResponses ?? false,
    redactSensitiveData: redactSensitiveData ?? true,
    redactFilePaths: redactFilePaths ?? false,
    redactUrls: redactUrls ?? false,
    redactEmails: redactEmails ?? false,
    redactPersonalInfo: redactPersonalInfo ?? false,
    ...(perf ? { perf } : {}),
  });
}

/**
 * Pure resolver for perf telemetry settings (D2).
 *
 * Returns the effective perf state from a TelemetrySettings object.
 * Both fields default to false. When `enabled` is false, memory is
 * forced to false regardless of its configured value (master gates memory).
 *
 * Does not mutate the input. Returns a fresh object so callers cannot
 * affect subsequent resolutions by mutating the result.
 */
export function resolvePerfSettings(settings: TelemetrySettings | undefined): {
  enabled: boolean;
  memory: boolean;
} {
  const enabled = settings?.perf?.enabled ?? false;
  const memory = settings?.perf?.memory ?? false;
  if (!enabled) {
    return { enabled: false, memory: false };
  }
  return { enabled: true, memory };
}

function applyFileFilteringSettings(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  config.fileFiltering = {
    respectGitIgnore:
      params.fileFiltering?.respectGitIgnore ??
      DEFAULT_FILE_FILTERING_OPTIONS.respectGitIgnore,
    respectLlxprtIgnore:
      params.fileFiltering?.respectLlxprtIgnore ??
      DEFAULT_FILE_FILTERING_OPTIONS.respectLlxprtIgnore,
    enableRecursiveFileSearch:
      params.fileFiltering?.enableRecursiveFileSearch ?? true,
    disableFuzzySearch: params.fileFiltering?.disableFuzzySearch ?? false,
  };
}

function applyRuntimeFlags(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  applyBasicRuntimeFlags(config, params);
  applyExtensionFlags(config, params);
  applyShellFlags(config, params);
  applyOutputFlags(config, params);
  applySessionFlags(config, params);
}

function applyBasicRuntimeFlags(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  config.checkpointing = params.checkpointing ?? false;
  config.dumpOnError = params.dumpOnError ?? false;
  config.proxy = params.proxy;
  config.cwd = params.cwd;
  config.fileDiscoveryService = params.fileDiscoveryService ?? null;
  config.bugCommand = params.bugCommand;
  config.model = params.model;
  config.originalModel = params.model;
  config.extensionContextFilePaths = params.extensionContextFilePaths ?? [];
  config.maxSessionTurns = params.maxSessionTurns ?? -1;
  config.experimentalZedIntegration =
    params.experimentalZedIntegration ?? false;
  config.noBrowser = params.noBrowser ?? false;
  config.summarizeToolOutput = params.summarizeToolOutput;
  config.folderTrust = params.folderTrust ?? false;
  config.ideMode = params.ideMode ?? false;
  config.complexityAnalyzerSettings = params.complexityAnalyzer ?? {
    complexityThreshold: 0.5,
    minTasksForSuggestion: 3,
    suggestionCooldownMs: 300000,
  };
  config.loadMemoryFromIncludeDirectories =
    params.loadMemoryFromIncludeDirectories ?? false;
  config.chatCompression = params.chatCompression;
  config.interactive = params.interactive ?? false;
  config.shellReplacement = normalizeShellReplacement(params.shellReplacement);
  config.trustedFolder = params.trustedFolder;
  config.useRipgrep = params.useRipgrep ?? false;
  // @plan PLAN-20260731-GHBROKER.P15
  config.githubBrokerClient = params.githubBrokerClient;
}

function applyExtensionFlags(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  config.listExtensions = params.listExtensions ?? false;
  config._activeExtensions = params.activeExtensions ?? [];
  config.providerManager = params.providerManager;
  config.provider = params.provider;
  config._extensionLoader =
    params.extensionLoader ??
    new SimpleExtensionLoader(params.extensions ?? []);
  config.extensionManagement = params.extensionManagement ?? false;
  config.enableExtensionReloading = params.enableExtensionReloading ?? false;
  config.enablePromptCompletion = params.enablePromptCompletion ?? false;
  config.eventEmitter = params.eventEmitter;
}

function applyShellFlags(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  config.shouldUseNodePtyShell = params.shouldUseNodePtyShell ?? false;
  config.allowPtyThemeOverride = params.allowPtyThemeOverride ?? false;
  config.ptyScrollbackLimit = params.ptyScrollbackLimit ?? 600000;
  config.ptyTerminalWidth = params.ptyTerminalWidth;
  config.ptyTerminalHeight = params.ptyTerminalHeight;
  config.enableShellOutputEfficiency =
    params.enableShellOutputEfficiency ?? true;
}

function applyOutputFlags(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  config.skipNextSpeakerCheck = params.skipNextSpeakerCheck ?? false;
  config.truncateToolOutputThreshold =
    params.truncateToolOutputThreshold ??
    DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD;
  config.truncateToolOutputLines =
    params.truncateToolOutputLines ?? DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES;
  config.enableToolOutputTruncation = params.enableToolOutputTruncation ?? true;
}

function applySessionFlags(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  config.continueOnFailedApiCall = params.continueOnFailedApiCall ?? true;
  const imagePayloadBudgetBytes = params.imagePayloadBudgetBytes;
  config.imagePayloadBudgetBytes =
    typeof imagePayloadBudgetBytes === 'number' &&
    Number.isSafeInteger(imagePayloadBudgetBytes) &&
    imagePayloadBudgetBytes >= 0
      ? imagePayloadBudgetBytes
      : DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES;
  config.continueSession = params.continueSession ?? false;
  config.storage = new Storage(config.targetDir);
  config.fileExclusions = new FileExclusions(config as unknown as Config);
}

function applyPolicyAndLifecycle(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  config.policyEngine = new PolicyEngine(params.policyEngineConfig);
  config.runtimeState = createAgentRuntimeStateFromConfig(
    config as unknown as Config,
  );
  config.disableYoloMode = params.disableYoloMode ?? false;
  config.enableHooks = params.enableHooks ?? false;
  config.jitContextEnabled = params.jitContextEnabled ?? true;
  config.hooks = params.hooks;
  config.projectHooks = params.projectHooks;
  config.disabledHooks = params.disabledHooks ?? [];
  config.skillManager = new SkillManager();
  config.skillsSupport = params.skillsSupport ?? false;
  config.disabledSkills = params.disabledSkills ?? [];
  config.enableHooksUI = params.enableHooksUI ?? true;
  config.adminSkillsEnabled = params.adminSkillsEnabled ?? true;
  config.skillManager.setAdminSettings(config.adminSkillsEnabled);
  config.sanitizationConfig = params.sanitizationConfig;
  config._onReload = params.onReload;
  config._onReloadMcpServers = params.onReloadMcpServers;
  config.outputSettings = params.outputSettings ?? {
    format: OutputFormat.TEXT,
  };
  config.introspectionAgentSettings = params.introspectionAgentSettings ?? {
    enabled: false,
  };
  config.useWriteTodos = params.useWriteTodos ?? true;

  // @plan PLAN-20260610-ISSUE1592.P01
  // @requirement REQ-INV-001, REQ-INV-002, REQ-INV-003
  config.agentClientFactory = params.agentClientFactory;
  config.toolSchedulerFactory = params.toolSchedulerFactory;
  config.taskToolRegistration = params.taskToolRegistration;
  config.postSkillDiscoveryToolRegistrar =
    params.postSkillDiscoveryToolRegistrar;

  if (params.contextFileName !== undefined && params.contextFileName !== '') {
    setLlxprtMdFilename(params.contextFileName);
  }

  // Telemetry initialization (intentional cast — avoids circular dep with Config)
  const isTestEnvironment = process.env.NODE_ENV === 'test';
  if (process.env.VERBOSE === 'true' && isTestEnvironment === false) {
    debugLogger.log(
      `[CONFIG] Telemetry settings:`,
      JSON.stringify(config.telemetrySettings),
    );
  }
  if (config.telemetrySettings.enabled === true) {
    if (process.env.VERBOSE === 'true' && isTestEnvironment === false) {
      debugLogger.log(`[CONFIG] Initializing telemetry`);
    }
    initializeTelemetry(config as unknown as Config);
  } else if (process.env.VERBOSE === 'true' && isTestEnvironment === false) {
    debugLogger.log(`[CONFIG] Telemetry disabled`);
  }

  const proxy = config.getProxy();
  if (proxy) {
    try {
      setGlobalProxy(proxy);
    } catch (error) {
      coreEvents.emitFeedback(
        'error',
        'Invalid proxy configuration detected. Check debug drawer for more details (F12)',
        error,
      );
    }
  }

  logCliConfiguration(
    config as unknown as Config,
    new StartSessionEvent(config as unknown as Config),
  );
}

/**
 * Applies ConfigParameters to a Config instance's fields and
 * initializes dependent subsystems (telemetry, proxy, policy engine).
 *
 * This function is the extracted body of Config.constructor().
 * It mutates the config instance directly via field assignment.
 */
export function applyConfigParams(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  applySettingsService(config, params);
  applyCoreIdentity(config, params);
  applyToolGovernance(config, params);
  applyTelemetryAndMemory(config, params);
  applyRuntimeFlags(config, params);
  applyPolicyAndLifecycle(config, params);
}
