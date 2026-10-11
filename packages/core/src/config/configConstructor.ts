/**
 * Config constructor logic — extracted to keep Config class under 800 lines.
 *
 * applyConfigParams() applies ConfigParameters to Config fields,
 * initializes dependent services (telemetry, proxy, policy engine),
 * and logs the configuration.
 */

import type { MemorySettings } from './configTypes.js';

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import * as path from 'node:path';

import {
  type ConfigParameters,
  type LlxprtExtension,
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
import {
  DEFAULT_FILE_FILTERING_OPTIONS,
  DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
} from './constants.js';
import { parseLspConfig } from './lspIntegration.js';
import type { LspConfig } from '@vybestack/llxprt-code-ide-integration';
import { Storage } from '@vybestack/llxprt-code-settings';
import type { PolicyEngineConfig } from '../policy/types.js';
import { setGlobalProxy } from '../utils/fetch.js';
import { coreEvents } from '../utils/events.js';
import { DEFAULT_CONTEXT_FILENAME } from '@vybestack/llxprt-code-tools';

import { OutputFormat } from '../utils/output-format.js';
import type { EnvironmentSanitizationConfig } from '../services/environmentSanitization.js';
import type { HookDefinition, HookEventName } from '../hooks/types.js';

/**
 * Typed target interface for applyConfigParams — lists every field
 * that the function assigns plus getProxy() which it calls.
 *
 * All fields are public so the interface can be satisfied by Config,
 * whose base class declares them as protected.
 */
export interface ConfigConstructorTarget {
  initialSettings: Readonly<Record<string, unknown>>;
  provider: string | undefined;

  // Core identity and workspace
  sessionId: string;
  embeddingModel: string | undefined;
  sandbox: SandboxConfig | undefined;
  targetDir: string;
  configuredIncludeDirectories: readonly string[];
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
  lspConfig: LspConfig | undefined;

  // Memory and context
  memorySettings: MemorySettings;
  providedInstructions: string;
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
  bugCommand: BugCommandSettings | undefined;
  model: string;
  originalModel: string;
  extensionContextFilePaths: string[];
  maxSessionTurns: number;
  experimentalZedIntegration: boolean;
  listExtensions: boolean;
  _activeExtensions: ActiveExtension[];
  extensions: LlxprtExtension[];
  noBrowser: boolean;
  summarizeToolOutput: Record<string, SummarizeToolOutputSettings> | undefined;
  folderTrust: boolean;
  ideMode: boolean;
  complexityAnalyzerSettings: ComplexityAnalyzerSettings;
  loadMemoryFromIncludeDirectories: boolean;
  chatCompression: ChatCompressionSettings | undefined;
  interactive: boolean;
  shellReplacement: ShellReplacementMode;
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
  imagePayloadBudgetBytes: number;
  enableShellOutputEfficiency: boolean;
  continueSession: boolean | string;
  extensionManagement: boolean;
  enableExtensionReloading: boolean;
  storageRoot: string;
  globalConfigRoot: string;
  globalDataRoot: string;
  globalLogRoot: string;
  globalAgentsRoot: string;
  projectTempDir: string;
  projectHistoryDir: string;
  projectChatsDir: string;
  projectCheckpointsDir: string;
  historyFilePath: string;
  projectCommandsDir: string;
  projectSkillsDir: string;
  projectAgentSkillsDir: string;
  userCommandsDir: string;
  userSkillsDir: string;
  userAgentSkillsDir: string;
  customExcludes: readonly string[];
  enablePromptCompletion: boolean;

  // Policy engine and runtime state
  policyEngineConfig: PolicyEngineConfig;
  disableYoloMode: boolean;
  enableHooks: boolean;
  jitContextEnabled: boolean | undefined;
  hooks: { [K in HookEventName]?: HookDefinition[] } | undefined;
  projectHooks:
    | ({ [K in HookEventName]?: HookDefinition[] } & { disabled?: string[] })
    | undefined;
  disabledHooks: string[];
  skillsSupport: boolean;
  disabledSkills: string[];
  enableHooksUI: boolean;
  adminSkillsEnabled: boolean;
  sanitizationConfig: EnvironmentSanitizationConfig | undefined;
  outputSettings: OutputSettings;
  introspectionAgentSettings: IntrospectionAgentSettings;
  useWriteTodos: boolean;

  // Called at end of applyConfigParams
  getProxy(): string | undefined;
}

function freezeInitialSettings(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  for (const child of Object.values(value)) freezeInitialSettings(child);
  Object.freeze(value);
}

function applyInitialSettings(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  const initial = structuredClone(params.initialSettings ?? {});
  freezeInitialSettings(initial);
  config.initialSettings = initial;
  config.provider = params.provider;
}

function applyCoreIdentity(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  config.sessionId = params.sessionId;
  config.embeddingModel = params.embeddingModel;
  config.sandbox = params.sandbox;
  config.targetDir = path.resolve(params.targetDir);
  config.configuredIncludeDirectories = [...(params.includeDirectories ?? [])];
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
  config.lspConfig = parseLspConfig(params.lsp);
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
  config.providedInstructions = params.userMemory ?? '';
  const declaredFilenames =
    params.memorySettings?.filenames ??
    (Array.isArray(params.contextFileName)
      ? params.contextFileName
      : [params.contextFileName ?? DEFAULT_CONTEXT_FILENAME]);
  const filenames = declaredFilenames
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  config.memorySettings = {
    importFormat: 'tree',
    maxDirectories: 200,
    ...params.memorySettings,
    filenames: filenames.length > 0 ? filenames : [DEFAULT_CONTEXT_FILENAME],
    filtering: {
      ...DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
      ...params.memorySettings?.filtering,
    },
  };
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
  config.bugCommand = params.bugCommand;
  // #2534 Domain C2: the constructor-seeded model feeds the store seeding in
  // applyExtensionFlags when a provider is supplied, and the per-instance
  // terminal fallback for providerless Configs (see ConfigBaseCore.model).
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
  config.useRipgrep = params.useRipgrep ?? false;
  // @plan PLAN-20260731-GHBROKER.P15
}

function applyExtensionFlags(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  config.listExtensions = params.listExtensions ?? false;
  config._activeExtensions = params.activeExtensions ?? [];
  config.extensions = [...(params.extensions ?? [])];
  config.extensionManagement = params.extensionManagement ?? false;
  config.enableExtensionReloading = params.enableExtensionReloading ?? false;
  config.enablePromptCompletion = params.enablePromptCompletion ?? false;
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
  config.storageRoot = path.resolve(params.storageRoot ?? config.targetDir);
  config.globalConfigRoot = Storage.getGlobalConfigDir();
  config.globalDataRoot = Storage.getGlobalDataDir();
  config.globalLogRoot = Storage.getGlobalLogDir();
  config.globalAgentsRoot = Storage.getGlobalAgentsDir();
  const projectKey = Storage.getProjectHistoryKey(config.storageRoot);
  const projectConfigRoot = path.join(config.storageRoot, '.llxprt');
  config.projectTempDir = path.join(config.globalLogRoot, 'tmp', projectKey);
  config.projectHistoryDir = path.join(
    config.globalDataRoot,
    'history',
    projectKey,
  );
  config.projectChatsDir = path.join(config.projectTempDir, 'chats');
  config.projectCheckpointsDir = path.join(
    config.projectTempDir,
    'checkpoints',
  );
  config.historyFilePath = path.join(config.projectTempDir, 'shell_history');
  config.projectCommandsDir = path.join(projectConfigRoot, 'commands');
  config.projectSkillsDir = path.join(projectConfigRoot, 'skills');
  config.projectAgentSkillsDir = path.join(
    config.storageRoot,
    '.agents',
    'skills',
  );
  config.userCommandsDir = path.join(config.globalConfigRoot, 'commands');
  config.userSkillsDir = path.join(config.globalConfigRoot, 'skills');
  config.userAgentSkillsDir = path.join(config.globalAgentsRoot, 'skills');
  config.customExcludes = Object.freeze([]);
}

function applyPolicyAndLifecycle(
  config: ConfigConstructorTarget,
  params: ConfigParameters,
): void {
  config.policyEngineConfig = {
    ...params.policyEngineConfig,
    rules: params.policyEngineConfig?.rules?.map((rule) => ({
      ...rule,
      modes: rule.modes?.slice(),
      argsPattern: rule.argsPattern
        ? new RegExp(rule.argsPattern.source, rule.argsPattern.flags)
        : undefined,
    })),
  };
  config.disableYoloMode = params.disableYoloMode ?? false;
  config.enableHooks = params.enableHooks ?? false;
  config.jitContextEnabled = params.jitContextEnabled ?? true;
  config.hooks = params.hooks;
  config.projectHooks = params.projectHooks;
  config.disabledHooks = params.disabledHooks ?? [];
  config.skillsSupport = params.skillsSupport ?? false;
  config.disabledSkills = params.disabledSkills ?? [];
  config.enableHooksUI = params.enableHooksUI ?? true;
  config.adminSkillsEnabled = params.adminSkillsEnabled ?? true;
  config.sanitizationConfig = params.sanitizationConfig;
  config.outputSettings = params.outputSettings ?? {
    format: OutputFormat.TEXT,
  };
  config.introspectionAgentSettings = params.introspectionAgentSettings ?? {
    enabled: false,
  };
  config.useWriteTodos = params.useWriteTodos ?? true;

  // @plan PLAN-20260610-ISSUE1592.P01
  // @requirement REQ-INV-001, REQ-INV-002, REQ-INV-003

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
  applyInitialSettings(config, params);
  applyCoreIdentity(config, params);
  applyToolGovernance(config, params);
  applyTelemetryAndMemory(config, params);
  applyRuntimeFlags(config, params);
  applyPolicyAndLifecycle(config, params);
}
