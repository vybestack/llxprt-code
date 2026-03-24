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
} from './configTypes.js';
import { DEFAULT_FILE_FILTERING_OPTIONS } from './constants.js';
import { parseLspConfig } from './lspIntegration.js';
import { WorkspaceContext } from '../utils/workspaceContext.js';
import { Storage } from './storage.js';
import { FileExclusions } from '../utils/ignorePatterns.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import { setGlobalProxy } from '../utils/fetch.js';
import { coreEvents } from '../utils/events.js';
import { SimpleExtensionLoader } from '../utils/extensionLoader.js';
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
import { StandardFileSystemService } from '../services/fileSystemService.js';
import { registerSettingsService } from '../settings/settingsServiceInstance.js';
import { SettingsService } from '../settings/SettingsService.js';
import { peekActiveProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import { logCliConfiguration, StartSessionEvent } from '../telemetry/index.js';

/**
 * Applies ConfigParameters to a Config instance's fields and
 * initializes dependent subsystems (telemetry, proxy, policy engine).
 *
 * This function is the extracted body of Config.constructor().
 * It mutates the config instance directly via field assignment.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyConfigParams(config: any, params: ConfigParameters): void {
  // Settings service resolution
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

  // Core identity and workspace
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

  // Tool governance
  config.coreTools = params.coreTools;
  config.allowedTools = params.allowedTools;
  config.excludeTools = params.excludeTools;
  config.toolDiscoveryCommand = params.toolDiscoveryCommand;
  config.toolCallCommand = params.toolCallCommand;
  config.mcpServerCommand = params.mcpServerCommand;
  config.mcpServers = params.mcpServers;
  config.allowedMcpServers = params.allowedMcpServers ?? [];
  config.blockedMcpServers = params.blockedMcpServers ?? [];

  // LSP
  config._lspState.lspConfig = parseLspConfig(params.lsp);

  // Memory and context
  config.userMemory = params.userMemory ?? '';
  config.llxprtMdFileCount = params.llxprtMdFileCount ?? 0;
  config.llxprtMdFilePaths = params.llxprtMdFilePaths ?? [];
  config.approvalMode = params.approvalMode ?? ApprovalMode.DEFAULT;
  config.showMemoryUsage = params.showMemoryUsage ?? false;
  config.accessibility = params.accessibility ?? {};

  // Telemetry configuration
  config.telemetrySettings = {
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

  // File filtering
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

  // Feature flags and runtime settings
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
  config.fileExclusions = new FileExclusions(config);
  config.enablePromptCompletion = params.enablePromptCompletion ?? false;
  config.eventEmitter = params.eventEmitter;

  // Policy engine and runtime state
  config.policyEngine = new PolicyEngine(params.policyEngineConfig);
  config.runtimeState = createAgentRuntimeStateFromConfig(config);
  config.disableYoloMode = params.disableYoloMode ?? false;
  config.enableHooks = params.enableHooks ?? false;
  config.jitContextEnabled = params.jitContextEnabled ?? true;
  config.hooks = params.hooks;
  config.projectHooks = params.projectHooks;
  config.skillManager = new SkillManager();
  config.skillsSupport = params.skillsSupport ?? false;
  config.disabledSkills = params.disabledSkills ?? [];
  config.sanitizationConfig = params.sanitizationConfig;
  config._onReload = params.onReload;
  config.outputSettings = params.outputSettings ?? {
    format: OutputFormat.TEXT,
  };
  config.codebaseInvestigatorSettings = params.codebaseInvestigatorSettings ?? {
    enabled: false,
  };
  config.introspectionAgentSettings = params.introspectionAgentSettings ?? {
    enabled: false,
  };
  config.useWriteTodos = params.useWriteTodos ?? true;

  if (params.contextFileName) {
    setLlxprtMdFilename(params.contextFileName);
  }

  // Telemetry initialization
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
    initializeTelemetry(config);
  } else if (process.env.VERBOSE === 'true' && !isTestEnvironment) {
    debugLogger.log(`[CONFIG] Telemetry disabled`);
  }

  // Proxy setup
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

  logCliConfiguration(config, new StartSessionEvent(config));
}
