/**
 * Config constructor logic — extracted to keep Config class under 800 lines.
 *
 * applyConfigParams() applies ConfigParameters to Config fields,
 * initializes dependent services (telemetry, proxy, policy engine),
 * and logs the configuration.
 */

import * as path from 'node:path';
import process from 'node:process';

import {
  type ConfigParameters,
  ApprovalMode,
  normalizeShellReplacement,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
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
import { Storage } from './storage.js';
import { FileExclusions } from '../utils/ignorePatterns.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { setGlobalProxy } from '../utils/fetch.js';
import { coreEvents } from '../utils/events.js';
import {
  SimpleExtensionLoader,
  type ExtensionLoader,
} from '../utils/extensionLoader.js';
import { SkillManager } from '../skills/skillManager.js';
import { setLlxprtMdFilename } from '../tools/memoryTool.js';
import { debugLogger } from '../utils/debugLogger.js';
import {
  initializeTelemetry,
  DEFAULT_TELEMETRY_TARGET,
  DEFAULT_OTLP_ENDPOINT,
} from '../telemetry/index.js';
import { OutputFormat } from '../utils/output-format.js';
import { createAgentRuntimeStateFromConfig } from '../runtime/runtimeStateFactory.js';
import {
  StandardFileSystemService,
  type FileSystemService,
} from '../services/fileSystemService.js';
import { registerSettingsService } from '../settings/settingsServiceInstance.js';
import { SettingsService } from '../settings/SettingsService.js';
import { peekActiveProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import { logCliConfiguration, StartSessionEvent } from '../telemetry/index.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import type { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import type { EnvironmentSanitizationConfig } from '../services/environmentSanitization.js';
import type { HookDefinition, HookEventName } from '../hooks/types.js';
import type { IProviderManager as ProviderManager } from '../providers/IProviderManager.js';
import type { EventEmitter } from 'node:events';
import type { Config } from './config.js';

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
  workspaceContext: WorkspaceContext;
  debugMode: boolean;
  outputFormat: OutputFormat;
  question: string | undefined;

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
  providerManager: ProviderManager | undefined;
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
  outputSettings: OutputSettings;
  introspectionAgentSettings: IntrospectionAgentSettings;
  useWriteTodos: boolean;

  // Called at end of applyConfigParams
  getProxy(): string | undefined;
}

function applySettingsService(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  const providedSettingsService = params.settingsService;
  if (providedSettingsService) {
    registerSettingsService(providedSettingsService);
  }

  const existingContext = peekActiveProviderRuntimeContext();
  if (providedSettingsService) {
    config.settingsService = providedSettingsService;
  } else if (existingContext?.settingsService) {
    config.settingsService = existingContext.settingsService;
  } else {
    config.settingsService = new SettingsService();
  }
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
  config.workspaceContext = new WorkspaceContext(
    config.targetDir,
    params.includeDirectories ?? [],
  );
  config.debugMode = params.debugMode;
  config.outputFormat = params.outputFormat ?? OutputFormat.TEXT;
  config.question = params.question;
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
  config.userMemory = params.userMemory ?? '';
  config.llxprtMdFileCount = params.llxprtMdFileCount ?? 0;
  config.llxprtMdFilePaths = params.llxprtMdFilePaths ?? [];
  config.approvalMode = params.approvalMode ?? ApprovalMode.DEFAULT;
  config.showMemoryUsage = params.showMemoryUsage ?? false;
  config.accessibility = params.accessibility ?? {};

  // Spread first to preserve all fields (e.g. conversationLogPath,
  // customRedactionPatterns, retention settings), then override core fields
  // with explicit defaults.
  config.telemetrySettings = {
    ...(params.telemetry ?? {}),
    enabled: params.telemetry?.enabled ?? false,
    target: params.telemetry?.target ?? DEFAULT_TELEMETRY_TARGET,
    otlpEndpoint: params.telemetry?.otlpEndpoint ?? DEFAULT_OTLP_ENDPOINT,
    logPrompts: params.telemetry?.logPrompts ?? true,
    outfile: params.telemetry?.outfile,
    logConversations: params.telemetry?.logConversations ?? false,
    logResponses: params.telemetry?.logResponses ?? false,
    redactSensitiveData: params.telemetry?.redactSensitiveData ?? true,
    redactFilePaths: params.telemetry?.redactFilePaths ?? false,
    redactUrls: params.telemetry?.redactUrls ?? false,
    redactEmails: params.telemetry?.redactEmails ?? false,
    redactPersonalInfo: params.telemetry?.redactPersonalInfo ?? false,
  };
  config.usageStatisticsEnabled = params.usageStatisticsEnabled ?? true;

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
  config.checkpointing = params.checkpointing ?? false;
  config.dumpOnError = params.dumpOnError ?? false;
  config.proxy = params.proxy;
  config.cwd = params.cwd ?? process.cwd();
  config.fileDiscoveryService = params.fileDiscoveryService ?? null;
  config.bugCommand = params.bugCommand;
  config.model = params.model;
  config.originalModel = params.model;
  config.extensionContextFilePaths = params.extensionContextFilePaths ?? [];
  config.maxSessionTurns = params.maxSessionTurns ?? -1;
  config.experimentalZedIntegration =
    params.experimentalZedIntegration ?? false;
  config.listExtensions = params.listExtensions ?? false;
  config._activeExtensions = params.activeExtensions ?? [];
  config.providerManager = params.providerManager;
  config.provider = params.provider;
  config._extensionLoader =
    params.extensionLoader ??
    new SimpleExtensionLoader(params.extensions ?? []);
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
  config.shouldUseNodePtyShell = params.shouldUseNodePtyShell ?? false;
  config.allowPtyThemeOverride = params.allowPtyThemeOverride ?? false;
  config.ptyScrollbackLimit = params.ptyScrollbackLimit ?? 600000;
  config.ptyTerminalWidth = params.ptyTerminalWidth;
  config.ptyTerminalHeight = params.ptyTerminalHeight;
  config.skipNextSpeakerCheck = params.skipNextSpeakerCheck ?? false;
  config.truncateToolOutputThreshold =
    params.truncateToolOutputThreshold ??
    DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD;
  config.truncateToolOutputLines =
    params.truncateToolOutputLines ?? DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES;
  config.enableToolOutputTruncation = params.enableToolOutputTruncation ?? true;
  config.continueOnFailedApiCall = params.continueOnFailedApiCall ?? true;
  config.enableShellOutputEfficiency =
    params.enableShellOutputEfficiency ?? true;
  config.continueSession = params.continueSession ?? false;
  config.extensionManagement = params.extensionManagement ?? false;
  config.enableExtensionReloading = params.enableExtensionReloading ?? false;
  config.storage = new Storage(config.targetDir);
  config.fileExclusions = new FileExclusions(config as unknown as Config);
  config.enablePromptCompletion = params.enablePromptCompletion ?? false;
  config.eventEmitter = params.eventEmitter;
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
  config.outputSettings = params.outputSettings ?? {
    format: OutputFormat.TEXT,
  };
  config.introspectionAgentSettings = params.introspectionAgentSettings ?? {
    enabled: false,
  };
  config.useWriteTodos = params.useWriteTodos ?? true;

  if (params.contextFileName) {
    setLlxprtMdFilename(params.contextFileName);
  }

  // Telemetry initialization (intentional cast — avoids circular dep with Config)
  const isTestEnvironment =
    process.env.NODE_ENV === 'test' || process.env.VITEST;
  if (process.env.VERBOSE === 'true' && !isTestEnvironment) {
    debugLogger.log(
      `[CONFIG] Telemetry settings:`,
      JSON.stringify(config.telemetrySettings),
    );
  }
  if (config.telemetrySettings.enabled) {
    if (process.env.VERBOSE === 'true' && !isTestEnvironment) {
      debugLogger.log(`[CONFIG] Initializing telemetry`);
    }
    initializeTelemetry(config as unknown as Config);
  } else if (process.env.VERBOSE === 'true' && !isTestEnvironment) {
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
