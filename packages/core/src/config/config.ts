/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import process from 'node:process';
import {
  type ContentGeneratorConfig,
  createContentGeneratorConfig,
} from '../core/contentGenerator.js';
import { PromptRegistry } from '../prompts/prompt-registry.js';
import { ResourceRegistry } from '../resources/resource-registry.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import { debugLogger } from '../utils/debugLogger.js';

import {
  setLlxprtMdFilename,
  LLXPRT_CONFIG_DIR as LLXPRT_DIR,
} from '../tools/memoryTool.js';
import { ActivateSkillTool } from '../tools/activate-skill.js';
import type { SubagentSchedulerFactory } from '../core/subagentScheduler.js';

import { GeminiClient } from '../core/client.js';
import { createAgentRuntimeStateFromConfig } from '../runtime/runtimeStateFactory.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import type { HookDefinition, HookEventName } from '../hooks/types.js';
import { HookSystem } from '../hooks/hookSystem.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import { GitService } from '../services/gitService.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { ContextManager } from '../services/contextManager.js';
import type { SessionRecordingService } from '../recording/SessionRecordingService.js';
// @plan PLAN-20260130-ASYNCTASK.P09
import { AsyncTaskManager } from '../services/asyncTaskManager.js';
// @plan PLAN-20260130-ASYNCTASK.P22
import { AsyncTaskReminderService } from '../services/asyncTaskReminderService.js';
import { AsyncTaskAutoTrigger } from '../services/asyncTaskAutoTrigger.js';
// @plan PLAN-20260130-ASYNCTASK.P14

import {
  loadServerHierarchicalMemory,
  loadJitSubdirectoryMemory,
} from '../utils/memoryDiscovery.js';
import { OutputFormat } from '../utils/output-format.js';
import {
  // TELEMETRY: Re-enabled for local file logging only
  initializeTelemetry,
  DEFAULT_TELEMETRY_TARGET,
  DEFAULT_OTLP_ENDPOINT,
  TelemetryTarget,
  logCliConfiguration,
  StartSessionEvent,
} from '../telemetry/index.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from './models.js';
import type { IProviderManager as ProviderManager } from '../providers/IProviderManager.js';

import { shouldAttemptBrowserLaunch } from '../utils/browser.js';
import { type MCPOAuthConfig } from '../mcp/oauth-provider.js';
import { IdeClient } from '../ide/ide-client.js';
import { ideContext } from '../ide/ideContext.js';
import type { Content } from '@google/genai';
import { registerSettingsService } from '../settings/settingsServiceInstance.js';
import { SettingsService } from '../settings/SettingsService.js';
import { peekActiveProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import {
  type FileSystemService,
  StandardFileSystemService,
} from '../services/fileSystemService.js';
import { ProfileManager } from './profileManager.js';
import { SubagentManager } from './subagentManager.js';
import {
  initializeLsp,
  shutdownLspService as shutdownLsp,
} from './lspIntegration.js';
import { resolveConstructionTimeEnv } from './envResolver.js';
import type {
  WorkspacePathsConfig,
  FileFilteringConfig,
  ShellExecutionHostConfig,
  SandboxAwarenessConfig,
  DebugOutputConfig,
  SettingsReadConfig,
  SettingsMutationConfig,
  MemoryContextConfig,
  ToolOutputConfig,
} from './configInterfaces.js';
import {
  buildTelemetrySettings,
  normalizeFileFilteringSettings,
  parseLspConfig,
  normalizeShellReplacement,
} from './configBuilders.js';
import { createToolRegistryFromConfig } from './toolRegistryFactory.js';
import {
  getOrCreateScheduler as _getOrCreateScheduler,
  disposeScheduler as _disposeScheduler,
  type SchedulerCallbacks,
  type SchedulerOptions,
} from './schedulerSingleton.js';

// Re-export OAuth config type
export type { MCPOAuthConfig, AnyToolInvocation, SkillDefinition };
import type { AnyToolInvocation } from '../tools/tools.js';
import { WorkspaceContext } from '../utils/workspaceContext.js';
import { Storage } from './storage.js';
import { FileExclusions } from '../utils/ignorePatterns.js';
import type { EventEmitter } from 'node:events';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { PolicyEngine } from '../policy/policy-engine.js';

import { setGlobalProxy } from '../utils/fetch.js';
import { coreEvents, CoreEvent } from '../utils/events.js';
import {
  type ExtensionLoader,
  SimpleExtensionLoader,
} from '../utils/extensionLoader.js';
import { McpClientManager } from '../tools/mcp-client-manager.js';
import { SkillManager, type SkillDefinition } from '../skills/skillManager.js';
import type { EnvironmentSanitizationConfig } from '../services/environmentSanitization.js';

import type { ShellExecutionConfig } from '../services/shellExecutionService.js';

// Types, interfaces, enums, and MCPServerConfig class imported from configTypes.ts
import {
  ApprovalMode,
  MCPServerConfig,
  type ShellReplacementMode,
  type RedactionConfig,
  type AccessibilitySettings,
  type BugCommandSettings,
  type ChatCompressionSettings,
  type SummarizeToolOutputSettings,
  type ComplexityAnalyzerSettings,
  type OutputSettings,
  type CodebaseInvestigatorSettings,
  type IntrospectionAgentSettings,
  type TelemetrySettings,
  type GeminiCLIExtension,
  type SandboxConfig,
  type ActiveExtension,
  type BucketFailoverHandler,
  type ConfigParameters,
} from './configTypes.js';

// Re-export all types from configTypes for backward compatibility
export {
  ApprovalMode,
  AuthProviderType,
  MCPServerConfig,
  type RedactionConfig,
  type AccessibilitySettings,
  type BugCommandSettings,
  type ChatCompressionSettings,
  type SummarizeToolOutputSettings,
  type ComplexityAnalyzerSettings,
  type OutputSettings,
  type CodebaseInvestigatorSettings,
  type IntrospectionAgentSettings,
  type TelemetrySettings,
  type GeminiCLIExtension,
  type ExtensionInstallMetadata,
  type SandboxConfig,
  type ActiveExtension,
  type FailoverContext,
  type BucketFailoverHandler,
  type ConfigParameters,
} from './configTypes.js';

import type { FileFilteringOptions } from './constants.js';
import {
  DEFAULT_FILE_FILTERING_OPTIONS,
  DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
} from './constants.js';

export type { FileFilteringOptions };
export {
  DEFAULT_FILE_FILTERING_OPTIONS,
  DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
};

// Re-export from configBuilders/configTypes for backward compatibility
export { normalizeShellReplacement } from './configBuilders.js';
export type { ShellReplacementMode } from './configTypes.js';

export const DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD = 4_000_000;
export const DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES = 1000;

export class Config
  implements
    WorkspacePathsConfig,
    FileFilteringConfig,
    ShellExecutionHostConfig,
    SandboxAwarenessConfig,
    DebugOutputConfig,
    SettingsReadConfig,
    SettingsMutationConfig,
    MemoryContextConfig,
    ToolOutputConfig
{
  private toolRegistry!: ToolRegistry;
  private mcpClientManager?: McpClientManager;
  private allowedMcpServers: string[];
  private blockedMcpServers: Array<{ name: string; extensionName: string }>;
  private promptRegistry!: PromptRegistry;
  private resourceRegistry!: ResourceRegistry;
  private readonly sessionId: string;
  private adoptedSessionId: string | undefined;
  private readonly settingsService: SettingsService;
  private fileSystemService: FileSystemService;
  private contentGeneratorConfig!: ContentGeneratorConfig;
  private readonly embeddingModel: string | undefined;
  private readonly sandbox: SandboxConfig | undefined;
  private readonly targetDir: string;
  private workspaceContext: WorkspaceContext;
  private readonly debugMode: boolean;
  private readonly outputFormat: OutputFormat;
  private readonly question: string | undefined;

  /**
   * @plan PLAN-20250212-LSP.P33
   * @requirement REQ-CFG-010, REQ-CFG-015, REQ-CFG-070
   */
  private lspConfig?: import('../lsp/types.js').LspConfig;
  private lspServiceClient?: import('../lsp/lsp-service-client.js').LspServiceClient;
  private lspMcpClient?: import('@modelcontextprotocol/sdk/client/index.js').Client;
  private lspMcpTransport?: import('@modelcontextprotocol/sdk/shared/transport.js').Transport;

  private readonly coreTools: string[] | undefined;
  private readonly allowedTools: string[] | undefined;
  private readonly excludeTools: string[] | undefined;
  private readonly toolDiscoveryCommand: string | undefined;
  private readonly toolCallCommand: string | undefined;
  private readonly mcpServerCommand: string | undefined;
  private mcpServers: Record<string, MCPServerConfig> | undefined;
  private userMemory: string;
  private llxprtMdFileCount: number;
  private llxprtMdFilePaths: string[];
  private approvalMode: ApprovalMode;
  private readonly jitContextEnabled?: boolean;
  private contextManager?: ContextManager;
  private terminalBackground: string | undefined = undefined;
  private readonly showMemoryUsage: boolean;
  private readonly accessibility: AccessibilitySettings;
  private telemetrySettings: TelemetrySettings;
  private readonly usageStatisticsEnabled: boolean;
  private geminiClient!: GeminiClient;
  private runtimeState!: AgentRuntimeState;
  private readonly fileFiltering: {
    respectGitIgnore: boolean;
    respectLlxprtIgnore: boolean;
    enableRecursiveFileSearch: boolean;
    disableFuzzySearch: boolean;
  };
  private alwaysAllowedCommands: Set<string> = new Set();
  private fileDiscoveryService: FileDiscoveryService | null = null;
  private gitService: GitService | undefined = undefined;
  private sessionRecordingService: SessionRecordingService | undefined =
    undefined;
  // @plan PLAN-20260130-ASYNCTASK.P09
  private asyncTaskManager: AsyncTaskManager | undefined = undefined;
  // @plan PLAN-20260130-ASYNCTASK.P22
  private asyncTaskReminderService?: AsyncTaskReminderService;
  private asyncTaskAutoTrigger?: AsyncTaskAutoTrigger;
  private readonly checkpointing: boolean;
  private readonly dumpOnError: boolean;
  private readonly proxy: string | undefined;
  private readonly cwd: string;
  private readonly bugCommand: BugCommandSettings | undefined;
  private model: string;
  private readonly originalModel: string;
  private readonly extensionContextFilePaths: string[];
  private readonly noBrowser: boolean;
  private readonly folderTrust: boolean;
  private ideMode: boolean;
  private ideClient!: IdeClient;
  private inFallbackMode = false;
  private _modelSwitchedDuringSession: boolean = false;
  private readonly maxSessionTurns: number;
  private readonly _activeExtensions: ActiveExtension[];
  private readonly listExtensions: boolean;
  private readonly _extensionLoader: ExtensionLoader;
  private readonly enableExtensionReloading: boolean;
  private providerManager?: ProviderManager;
  private profileManager?: ProfileManager;
  private subagentManager?: SubagentManager;
  private subagentSchedulerFactory?: SubagentSchedulerFactory;
  private bucketFailoverHandler?: BucketFailoverHandler;

  // Track all potential tools for settings UI
  private allPotentialTools: Array<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toolClass: any;
    toolName: string;
    displayName: string;
    isRegistered: boolean;
    reason?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: any[];
  }> = [];

  setProviderManager(providerManager: ProviderManager) {
    this.providerManager = providerManager;
  }

  getProviderManager(): ProviderManager | undefined {
    return this.providerManager;
  }
  setProfileManager(manager: ProfileManager | undefined): void {
    this.profileManager = manager;
  }

  getProfileManager(): ProfileManager | undefined {
    return this.profileManager;
  }

  setSubagentManager(manager: SubagentManager | undefined): void {
    this.subagentManager = manager;
  }

  getSubagentManager(): SubagentManager | undefined {
    return this.subagentManager;
  }

  /**
   * Set the bucket failover handler for rate limit/quota error handling
   * @plan PLAN-20251213issue490
   */
  setBucketFailoverHandler(handler: BucketFailoverHandler | undefined): void {
    this.bucketFailoverHandler = handler;
  }

  /**
   * Get the bucket failover handler
   * @plan PLAN-20251213issue490
   */
  getBucketFailoverHandler(): BucketFailoverHandler | undefined {
    return this.bucketFailoverHandler;
  }

  /**
   * Set the session recording service for hooks to access transcript path
   * @plan PLAN-20250219-GMERGE022.B2
   * @requirement R1
   */
  setSessionRecordingService(
    service: SessionRecordingService | undefined,
  ): void {
    this.sessionRecordingService = service;
  }

  /**
   * Get the session recording service
   * @plan PLAN-20250219-GMERGE022.B2
   * @requirement R1
   */
  getSessionRecordingService(): SessionRecordingService | undefined {
    return this.sessionRecordingService;
  }

  setInteractiveSubagentSchedulerFactory(
    factory: SubagentSchedulerFactory | undefined,
  ): void {
    this.subagentSchedulerFactory = factory;
  }

  getInteractiveSubagentSchedulerFactory():
    | SubagentSchedulerFactory
    | undefined {
    return this.subagentSchedulerFactory;
  }
  private provider?: string;
  private readonly summarizeToolOutput:
    | Record<string, SummarizeToolOutputSettings>
    | undefined;
  private readonly experimentalZedIntegration: boolean = false;
  private readonly complexityAnalyzerSettings: ComplexityAnalyzerSettings;
  private readonly loadMemoryFromIncludeDirectories: boolean = false;
  private readonly chatCompression: ChatCompressionSettings | undefined;
  private readonly interactive: boolean;
  private readonly trustedFolder: boolean | undefined;
  private readonly useRipgrep: boolean;
  private readonly shouldUseNodePtyShell: boolean;
  private readonly allowPtyThemeOverride: boolean;
  private readonly ptyScrollbackLimit: number;
  private ptyTerminalWidth?: number;
  private ptyTerminalHeight?: number;
  private readonly skipNextSpeakerCheck: boolean;
  private readonly extensionManagement: boolean;
  private readonly enablePromptCompletion: boolean = false;
  private readonly shellReplacement: 'allowlist' | 'all' | 'none' = 'allowlist';
  readonly storage: Storage;
  private readonly fileExclusions: FileExclusions;
  private readonly eventEmitter?: EventEmitter;
  private readonly policyEngine: PolicyEngine;

  truncateToolOutputThreshold: number;
  truncateToolOutputLines: number;
  enableToolOutputTruncation: boolean;
  private readonly continueOnFailedApiCall: boolean;
  private readonly enableShellOutputEfficiency: boolean;
  private readonly continueSession: boolean | string;
  private readonly disableYoloMode: boolean;
  private readonly enableHooks: boolean;
  private readonly hooks:
    | { [K in HookEventName]?: HookDefinition[] }
    | undefined;
  private disabledHooks: string[] = [];
  private readonly projectHooks:
    | ({ [K in HookEventName]?: HookDefinition[] } & { disabled?: string[] })
    | undefined;
  private skillManager!: SkillManager;
  private readonly skillsSupport: boolean;
  private disabledSkills: string[];
  private readonly sanitizationConfig?: EnvironmentSanitizationConfig;
  private readonly _onReload:
    | (() => Promise<{ disabledSkills?: string[] }>)
    | undefined;
  private readonly outputSettings: OutputSettings;
  private readonly codebaseInvestigatorSettings: CodebaseInvestigatorSettings;
  private readonly introspectionAgentSettings: IntrospectionAgentSettings;
  private readonly useWriteTodos: boolean;

  /**
   * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P03
   * @requirement:HOOK-001,HOOK-002
   * Lazily-created HookSystem instance, only when enableHooks=true
   */
  private hookSystem: HookSystem | undefined;
  private initialized = false;

  constructor(params: ConfigParameters) {
    const providedSettingsService = params.settingsService;
    if (providedSettingsService) {
      registerSettingsService(providedSettingsService);
    }

    const existingContext = peekActiveProviderRuntimeContext();
    if (providedSettingsService) {
      this.settingsService = providedSettingsService;
    } else if (existingContext?.settingsService) {
      this.settingsService = existingContext.settingsService;
    } else {
      this.settingsService = new SettingsService();
    }

    this.sessionId = params.sessionId;
    // Embedding models not currently configured for llxprt-code
    this.embeddingModel = params.embeddingModel;
    this.fileSystemService = new StandardFileSystemService();
    this.sandbox = params.sandbox;
    this.targetDir = path.resolve(params.targetDir);
    this.workspaceContext = new WorkspaceContext(
      this.targetDir,
      params.includeDirectories ?? [],
    );
    this.debugMode = params.debugMode;
    this.outputFormat = params.outputFormat ?? OutputFormat.TEXT;
    this.question = params.question;

    this.coreTools = params.coreTools;
    this.allowedTools = params.allowedTools;
    this.excludeTools = params.excludeTools;
    this.toolDiscoveryCommand = params.toolDiscoveryCommand;
    this.toolCallCommand = params.toolCallCommand;
    this.mcpServerCommand = params.mcpServerCommand;
    this.mcpServers = params.mcpServers;
    this.allowedMcpServers = params.allowedMcpServers ?? [];
    this.blockedMcpServers = params.blockedMcpServers ?? [];

    /**
     * @plan PLAN-20250212-LSP.P33
     * @requirement REQ-CFG-010, REQ-CFG-015, REQ-CFG-020
     */
    this.lspConfig = parseLspConfig(params.lsp);

    this.userMemory = params.userMemory ?? '';
    this.llxprtMdFileCount = params.llxprtMdFileCount ?? 0;
    this.llxprtMdFilePaths = params.llxprtMdFilePaths ?? [];
    this.approvalMode = params.approvalMode ?? ApprovalMode.DEFAULT;
    this.showMemoryUsage = params.showMemoryUsage ?? false;
    this.accessibility = params.accessibility ?? {};
    this.telemetrySettings = buildTelemetrySettings(params.telemetry);
    this.usageStatisticsEnabled = params.usageStatisticsEnabled ?? true;

    this.fileFiltering = normalizeFileFilteringSettings(params.fileFiltering);
    this.checkpointing = params.checkpointing ?? false;
    this.dumpOnError = params.dumpOnError ?? false;
    this.proxy = params.proxy;
    this.cwd = params.cwd ?? process.cwd();
    this.fileDiscoveryService = params.fileDiscoveryService ?? null;
    this.bugCommand = params.bugCommand;
    this.model = params.model;
    this.originalModel = params.model;
    this.extensionContextFilePaths = params.extensionContextFilePaths ?? [];
    this.maxSessionTurns = params.maxSessionTurns ?? -1;
    this.experimentalZedIntegration =
      params.experimentalZedIntegration ?? false;
    this.listExtensions = params.listExtensions ?? false;
    this._activeExtensions = params.activeExtensions ?? [];
    this.providerManager = params.providerManager;
    this.provider = params.provider;
    this._extensionLoader =
      params.extensionLoader ??
      new SimpleExtensionLoader(params.extensions ?? []);
    this.noBrowser = params.noBrowser ?? false;
    this.summarizeToolOutput = params.summarizeToolOutput;
    this.folderTrust = params.folderTrust ?? false;
    this.ideMode = params.ideMode ?? false;
    this.complexityAnalyzerSettings = params.complexityAnalyzer ?? {
      complexityThreshold: 0.5,
      minTasksForSuggestion: 3,
      suggestionCooldownMs: 300000, // 5 minutes
    };
    this.loadMemoryFromIncludeDirectories =
      params.loadMemoryFromIncludeDirectories ?? false;
    this.chatCompression = params.chatCompression;
    this.interactive = params.interactive ?? false;
    this.shellReplacement = normalizeShellReplacement(params.shellReplacement);
    this.trustedFolder = params.trustedFolder;
    this.useRipgrep = params.useRipgrep ?? false;
    this.shouldUseNodePtyShell = params.shouldUseNodePtyShell ?? false;
    this.allowPtyThemeOverride = params.allowPtyThemeOverride ?? false;
    this.ptyScrollbackLimit = params.ptyScrollbackLimit ?? 600000;
    this.ptyTerminalWidth = params.ptyTerminalWidth;
    this.ptyTerminalHeight = params.ptyTerminalHeight;
    this.skipNextSpeakerCheck = params.skipNextSpeakerCheck ?? false;
    this.truncateToolOutputThreshold =
      params.truncateToolOutputThreshold ??
      DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD;
    this.truncateToolOutputLines =
      params.truncateToolOutputLines ?? DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES;
    this.enableToolOutputTruncation = params.enableToolOutputTruncation ?? true;
    this.continueOnFailedApiCall = params.continueOnFailedApiCall ?? true;
    this.enableShellOutputEfficiency =
      params.enableShellOutputEfficiency ?? true;
    this.continueSession = params.continueSession ?? false;
    this.extensionManagement = params.extensionManagement ?? false;
    this.enableExtensionReloading = params.enableExtensionReloading ?? false;
    this.storage = new Storage(this.targetDir);
    this.fileExclusions = new FileExclusions(this);
    this.enablePromptCompletion = params.enablePromptCompletion ?? false;
    this.eventEmitter = params.eventEmitter;

    /**
     * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
     * @requirement REQ-D01-002
     * @requirement REQ-D01-003
     * @pseudocode lines 122-133
     */
    this.policyEngine = new PolicyEngine(params.policyEngineConfig);
    this.runtimeState = createAgentRuntimeStateFromConfig(this);
    this.disableYoloMode = params.disableYoloMode ?? false;
    this.enableHooks = params.enableHooks ?? false;
    this.jitContextEnabled = params.jitContextEnabled ?? true;
    this.hooks = params.hooks;
    this.projectHooks = params.projectHooks;
    this.skillManager = new SkillManager();
    this.skillsSupport = params.skillsSupport ?? false;
    this.disabledSkills = params.disabledSkills ?? [];
    this.sanitizationConfig = params.sanitizationConfig;
    this._onReload = params.onReload;
    this.outputSettings = params.outputSettings ?? {
      format: OutputFormat.TEXT,
    };
    this.codebaseInvestigatorSettings = params.codebaseInvestigatorSettings ?? {
      enabled: false,
    };
    this.introspectionAgentSettings = params.introspectionAgentSettings ?? {
      enabled: false,
    };
    this.useWriteTodos = params.useWriteTodos ?? true;

    if (params.contextFileName) {
      setLlxprtMdFilename(params.contextFileName);
    }

    // TELEMETRY: Re-enabled for local file logging only - no network endpoints allowed
    const constructionEnv = resolveConstructionTimeEnv();
    if (constructionEnv.verbose) {
      debugLogger.log(
        `[CONFIG] Telemetry settings:`,
        JSON.stringify(this.telemetrySettings),
      );
    }
    if (this.telemetrySettings.enabled) {
      if (constructionEnv.verbose) {
        debugLogger.log(`[CONFIG] Initializing telemetry`);
      }
      initializeTelemetry(this);
    } else if (constructionEnv.verbose) {
      debugLogger.log(`[CONFIG] Telemetry disabled`);
    }

    // Set up proxy with error handling
    const proxy = this.getProxy();
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

    logCliConfiguration(this, new StartSessionEvent(this));
  }

  /**
   * Must only be called once, throws if called again.
   */
  async initialize(dependencies?: { messageBus?: MessageBus }): Promise<void> {
    if (this.initialized) {
      throw Error('Config was already initialized');
    }
    const initializationMessageBus = dependencies?.messageBus;
    if (!initializationMessageBus) {
      throw new Error(
        'Config.initialize requires an explicit session/runtime MessageBus dependency.',
      );
    }
    this.initialized = true;
    this.ideClient = await IdeClient.getInstance();
    // Initialize centralized FileDiscoveryService
    this.getFileService();
    if (this.getCheckpointingEnabled()) {
      await this.getGitService();
    }
    this.promptRegistry = new PromptRegistry();
    this.resourceRegistry = new ResourceRegistry();
    this.toolRegistry = await this.createToolRegistry(initializationMessageBus);
    this.mcpClientManager = new McpClientManager(
      this.toolRegistry,
      this,
      this.eventEmitter,
    );
    await Promise.all([
      this.mcpClientManager.startConfiguredMcpServers(),
      this.getExtensionLoader().start(this),
    ]);

    /**
     * @plan PLAN-20250212-LSP.P33
     * @requirement REQ-CFG-010, REQ-CFG-015, REQ-CFG-020, REQ-NAV-055
     * Initialize LSP service client if enabled
     */
    if (this.lspConfig !== undefined) {
      const lspState = await initializeLsp(
        this.lspConfig,
        this.targetDir,
        this.toolRegistry,
        this,
      );
      this.lspServiceClient = lspState.lspServiceClient;
      this.lspMcpClient = lspState.lspMcpClient;
      this.lspMcpTransport = lspState.lspMcpTransport;
    }

    // Discover skills if enabled
    if (this.skillsSupport) {
      await this.getSkillManager().discoverSkills(
        this.storage,
        this.getExtensions(),
      );
      this.getSkillManager().setDisabledSkills(this.disabledSkills);

      // Re-register ActivateSkillTool to update its schema with the discovered enabled skill enums
      if (this.getSkillManager().getSkills().length > 0) {
        this.getToolRegistry().registerTool(
          new ActivateSkillTool(this, initializationMessageBus),
        );
      }
    }

    // Create GeminiClient instance immediately without authentication
    // This ensures geminiClient is available for providers on startup
    this.geminiClient = new GeminiClient(this, this.runtimeState);

    if (this.getJitContextEnabled()) {
      this.contextManager = new ContextManager(this);
      await this.contextManager.refresh();
    }

    // Reserved for future model switching tracking
    void this._modelSwitchedDuringSession;
  }

  initializeContentGeneratorConfig: () => Promise<void> = async () => {
    const logger = new DebugLogger(
      'llxprt:config:initializeContentGeneratorConfig',
    );

    // Save the current conversation history AND HistoryService before creating a new client
    const previousGeminiClient = this.geminiClient;
    let existingHistory: Content[] = [];
    let existingHistoryService: HistoryService | null = null;

    if (previousGeminiClient && previousGeminiClient.isInitialized()) {
      existingHistory = await previousGeminiClient.getHistory();
      existingHistoryService = previousGeminiClient.getHistoryService();
      logger.debug('Retrieved existing state', {
        historyLength: existingHistory.length,
        hasHistoryService: !!existingHistoryService,
      });
    }

    // Create new content generator config
    const newContentGeneratorConfig = createContentGeneratorConfig(this);

    // Add provider manager to the config if available (llxprt multi-provider support)
    if (this.providerManager) {
      newContentGeneratorConfig.providerManager = this.providerManager;
    }

    const updatedRuntimeState = createAgentRuntimeStateFromConfig(this, {
      runtimeId: this.runtimeState.runtimeId,
      overrides: {
        model: newContentGeneratorConfig.model,
        proxyUrl: newContentGeneratorConfig.proxy ?? this.runtimeState.proxyUrl,
      },
    });
    this.runtimeState = updatedRuntimeState;

    // Create new client in local variable first
    const newGeminiClient = new GeminiClient(this, this.runtimeState);

    // CRITICAL: Store both the history AND the HistoryService instance
    // This preserves both the API conversation context and the UI's conversation display
    if (existingHistoryService) {
      logger.debug('Storing existing HistoryService for reuse', {
        historyLength: existingHistory.length,
      });
      newGeminiClient.storeHistoryServiceForReuse(existingHistoryService);
    }

    if (existingHistory.length > 0) {
      // Vertex and Genai have incompatible encryption and sending history with
      // throughtSignature from Genai to Vertex will fail, we need to strip them
      const fromGenaiToVertex =
        this.contentGeneratorConfig?.vertexai === false &&
        newContentGeneratorConfig.vertexai === true;

      logger.debug('Storing history for later use', {
        historyLength: existingHistory.length,
        fromGenaiToVertex,
        willStripThoughts: fromGenaiToVertex,
      });

      // Use storeHistoryForLaterUse to ensure history is preserved through initialization
      const historyToStore = fromGenaiToVertex
        ? existingHistory.map((content) => {
            const newContent = { ...content };
            if (newContent.parts) {
              newContent.parts = newContent.parts.map((part) => {
                if (
                  part &&
                  typeof part === 'object' &&
                  'thoughtSignature' in part
                ) {
                  const newPart = { ...part };
                  delete (newPart as { thoughtSignature?: string })
                    .thoughtSignature;
                  return newPart;
                }
                return part;
              });
            }
            return newContent;
          })
        : existingHistory;

      newGeminiClient.storeHistoryForLaterUse(historyToStore);
      logger.debug('History stored in new client', {
        storedHistoryLength: historyToStore.length,
      });
    }

    // Now initialize with the new config
    await newGeminiClient.initialize(newContentGeneratorConfig);
    logger.debug('New client initialized');

    // Only assign to instance properties after successful initialization
    this.contentGeneratorConfig = newContentGeneratorConfig;
    if (
      previousGeminiClient &&
      typeof previousGeminiClient.dispose === 'function'
    ) {
      try {
        previousGeminiClient.dispose();
      } catch (error) {
        logger.warn(
          () =>
            `Failed to dispose previous GeminiClient: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
      }
    }
    this.geminiClient = newGeminiClient;

    // Verify history was preserved
    const newHistory = await this.geminiClient.getHistory();
    const newHistoryService = this.geminiClient.getHistoryService();
    logger.debug('State verification after refreshAuth', {
      originalHistoryLength: existingHistory.length,
      newHistoryLength: newHistory.length,
      historyPreserved: newHistory.length > 0,
      historyServicePreserved: existingHistoryService === newHistoryService,
    });

    // Reset the session flag since we're explicitly changing auth and using default model
    this.inFallbackMode = false;
  };

  async refreshAuth(authMethod?: string) {
    const logger = new DebugLogger('llxprt:config:refreshAuth');
    logger.debug(
      () => `refreshAuth invoked (authMethod=${authMethod ?? 'default'})`,
    );
    await this.initializeContentGeneratorConfig();
  }

  getSessionId(): string {
    return this.adoptedSessionId ?? this.sessionId;
  }

  /**
   * @fix FIX-1336-SESSION-ADOPTION
   * Adopt a restored session's ID for use by TodoStore and other session-scoped services.
   * This allows --continue to properly restore todos from the previous session.
   */
  adoptSessionId(sessionId: string): void {
    const logger = new DebugLogger('llxprt:config:session');
    logger.debug(
      `adoptSessionId: adopting ${sessionId} (was ${this.sessionId})`,
    );
    this.adoptedSessionId = sessionId;
  }

  isContinueSession(): boolean {
    return !!this.continueSession;
  }

  shouldLoadMemoryFromIncludeDirectories(): boolean {
    return this.loadMemoryFromIncludeDirectories;
  }

  setTerminalBackground(terminalBackground: string | undefined): void {
    this.terminalBackground = terminalBackground;
  }

  getTerminalBackground(): string | undefined {
    return this.terminalBackground;
  }

  getContentGeneratorConfig(): ContentGeneratorConfig | undefined {
    return this.contentGeneratorConfig;
  }

  getModel(): string {
    // Delegate to SettingsService as source of truth
    const settingsService = this.getSettingsService();
    if (settingsService) {
      const activeProvider = settingsService.get('activeProvider') as string;
      if (activeProvider) {
        const providerSettings =
          settingsService.getProviderSettings(activeProvider);
        if (providerSettings.model) {
          return providerSettings.model as string;
        }
      }
    }
    // Fallback to legacy
    return this.contentGeneratorConfig?.model || this.model;
  }

  setModel(newModel: string): void {
    // Update SettingsService as source of truth
    const settingsService = this.getSettingsService();
    if (settingsService) {
      const activeProvider = settingsService.get('activeProvider') as string;
      if (activeProvider) {
        settingsService.setProviderSetting(activeProvider, 'model', newModel);
      }
    }
    // Keep legacy updates for backward compatibility
    if (this.contentGeneratorConfig) {
      this.contentGeneratorConfig.model = newModel;
    }
    // Also update the base model so it persists across refreshAuth
    if (this.model !== newModel || this.inFallbackMode) {
      this.model = newModel;
      coreEvents.emitModelChanged(newModel);
    }
    this.setFallbackMode(false);
  }

  isInFallbackMode(): boolean {
    return this.inFallbackMode;
  }

  resetModelToDefault(): void {
    if (this.contentGeneratorConfig) {
      this.contentGeneratorConfig.model = this.originalModel; // Reset to the original default model
      this.inFallbackMode = false;
    }
    this.model = this.originalModel;
  }

  setFallbackMode(active: boolean): void {
    this.inFallbackMode = active;
  }

  getMaxSessionTurns(): number {
    return this.maxSessionTurns;
  }

  getEmbeddingModel(): string | undefined {
    return this.embeddingModel;
  }

  getSandbox(): SandboxConfig | undefined {
    return this.sandbox;
  }

  isRestrictiveSandbox(): boolean {
    const sandboxConfig = this.getSandbox();
    const seatbeltProfile = process.env.SEATBELT_PROFILE;
    return (
      !!sandboxConfig &&
      sandboxConfig.command === 'sandbox-exec' &&
      !!seatbeltProfile &&
      seatbeltProfile.startsWith('restrictive-')
    );
  }

  getTargetDir(): string {
    return this.targetDir;
  }

  getProjectRoot(): string {
    return this.targetDir;
  }

  getWorkspaceContext(): WorkspaceContext {
    return this.workspaceContext;
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  getPromptRegistry(): PromptRegistry {
    return this.promptRegistry;
  }

  getResourceRegistry(): ResourceRegistry {
    return this.resourceRegistry;
  }

  getSkillManager(): SkillManager {
    return this.skillManager;
  }

  async reloadSkills(): Promise<void> {
    if (this._onReload) {
      const result = await this._onReload();
      if (result.disabledSkills) {
        this.disabledSkills = result.disabledSkills;
      }
    }
    await this.skillManager.discoverSkills(this.storage, this.getExtensions());
    this.skillManager.setDisabledSkills(this.disabledSkills);
  }

  getDebugMode(): boolean {
    return this.debugMode;
  }

  getOutputFormat(): OutputFormat {
    return this.outputFormat;
  }
  getQuestion(): string | undefined {
    return this.question;
  }

  getCoreTools(): string[] | undefined {
    return this.coreTools;
  }

  getAllowedTools(): string[] | undefined {
    return this.allowedTools;
  }

  /**
   * All the excluded tools from static configuration, loaded extensions, or
   * other sources.
   *
   * May change over time.
   */
  getExcludeTools(): string[] | undefined {
    const excludeToolsSet = new Set([...(this.excludeTools ?? [])]);
    for (const extension of this.getExtensionLoader().getExtensions()) {
      if (!extension.isActive) {
        continue;
      }
      for (const tool of extension.excludeTools || []) {
        excludeToolsSet.add(tool);
      }
    }
    return [...excludeToolsSet];
  }

  getToolDiscoveryCommand(): string | undefined {
    return this.toolDiscoveryCommand;
  }

  getToolCallCommand(): string | undefined {
    return this.toolCallCommand;
  }

  getMcpServerCommand(): string | undefined {
    return this.mcpServerCommand;
  }

  /**
   * The user configured MCP servers (via gemini settings files).
   *
   * Does NOT include mcp servers configured by extensions.
   */
  getMcpServers(): Record<string, MCPServerConfig> | undefined {
    return this.mcpServers;
  }

  getMcpClientManager(): McpClientManager | undefined {
    return this.mcpClientManager;
  }

  getAllowedMcpServers(): string[] | undefined {
    return this.allowedMcpServers;
  }

  getBlockedMcpServers():
    | Array<{ name: string; extensionName: string }>
    | undefined {
    return this.blockedMcpServers;
  }

  setMcpServers(mcpServers: Record<string, MCPServerConfig>): void {
    this.mcpServers = mcpServers;
  }

  getUserMemory(): string {
    if (this.getJitContextEnabled() && this.contextManager) {
      return [
        this.contextManager.getGlobalMemory(),
        this.contextManager.getEnvironmentMemory(),
      ]
        .filter(Boolean)
        .join('\n\n');
    }
    return this.userMemory;
  }

  getGlobalMemory(): string {
    if (this.getJitContextEnabled() && this.contextManager) {
      return this.contextManager.getGlobalMemory();
    }
    return this.userMemory;
  }

  getEnvironmentMemory(): string {
    if (this.getJitContextEnabled() && this.contextManager) {
      return this.contextManager.getEnvironmentMemory();
    }
    return '';
  }

  getCoreMemory(): string | undefined {
    if (this.getJitContextEnabled() && this.contextManager) {
      return this.contextManager.getCoreMemory();
    }
    return undefined;
  }

  setCoreMemory(_content: string): void {}

  setUserMemory(newUserMemory: string): void {
    this.userMemory = newUserMemory;
  }

  updateSystemInstructionIfInitialized(): void | Promise<void> {}

  getContinueSessionRef(): string | null {
    if (typeof this.continueSession === 'string') {
      return this.continueSession;
    }
    return this.continueSession ? '__CONTINUE_LATEST__' : null;
  }

  getLlxprtMdFileCount(): number {
    if (this.getJitContextEnabled() && this.contextManager) {
      return this.contextManager.getContextFileCount();
    }
    return this.llxprtMdFileCount;
  }

  getCoreMemoryFileCount(): number {
    if (this.getJitContextEnabled() && this.contextManager) {
      return this.contextManager.getCoreMemoryFileCount();
    }
    return 0;
  }

  setLlxprtMdFileCount(count: number): void {
    this.llxprtMdFileCount = count;
  }

  getLlxprtMdFilePaths(): string[] {
    if (this.getJitContextEnabled() && this.contextManager) {
      return Array.from(this.contextManager.getLoadedPaths());
    }
    return this.llxprtMdFilePaths;
  }

  setLlxprtMdFilePaths(paths: string[]): void {
    this.llxprtMdFilePaths = paths;
  }

  getApprovalMode(): ApprovalMode {
    return this.approvalMode;
  }

  setApprovalMode(mode: ApprovalMode): void {
    if (!this.isTrustedFolder() && mode !== ApprovalMode.DEFAULT) {
      throw new Error(
        'Cannot enable privileged approval modes in an untrusted folder.',
      );
    }

    this.approvalMode = mode;
  }

  isJitContextEnabled(): boolean {
    return !!this.jitContextEnabled;
  }

  getContextManager(): ContextManager | undefined {
    return this.contextManager;
  }

  getAccessibility(): AccessibilitySettings {
    return this.accessibility;
  }

  getPolicyEngine(): PolicyEngine {
    return this.policyEngine;
  }

  getShowMemoryUsage(): boolean {
    return this.showMemoryUsage;
  }

  getDisableYoloMode(): boolean {
    return this.disableYoloMode;
  }

  getTelemetryEnabled(): boolean {
    return this.telemetrySettings.enabled ?? false;
  }

  getTelemetryLogPromptsEnabled(): boolean {
    return this.telemetrySettings.logPrompts ?? true;
  }

  getTelemetryOtlpEndpoint(): string {
    return this.telemetrySettings.otlpEndpoint ?? DEFAULT_OTLP_ENDPOINT;
  }

  getTelemetryTarget(): TelemetryTarget {
    return this.telemetrySettings.target ?? DEFAULT_TELEMETRY_TARGET;
  }

  getTelemetryOutfile(): string | undefined {
    return this.telemetrySettings.outfile;
  }

  // Conversation logging configuration methods
  getConversationLoggingEnabled(): boolean {
    // Check CLI flags first when conversation logging flags are introduced.
    // Today this reads environment variables and the settings file.

    // Check environment variables
    const envVar = process.env.LLXPRT_LOG_CONVERSATIONS;
    if (envVar !== undefined) {
      return envVar.toLowerCase() === 'true';
    }

    // Check settings file
    return this.telemetrySettings.logConversations ?? false;
  }

  getResponseLoggingEnabled(): boolean {
    return this.telemetrySettings.logResponses ?? false;
  }

  getConversationLogPath(): string {
    // Check environment variable first
    const envPath = process.env.LLXPRT_CONVERSATION_LOG_PATH;
    if (envPath) {
      return this.expandPath(envPath);
    }

    // Check settings file
    if (this.telemetrySettings.conversationLogPath) {
      return this.expandPath(this.telemetrySettings.conversationLogPath);
    }

    // Default path
    return this.expandPath('~/.llxprt/conversations/');
  }

  getMaxConversationHistory(): number {
    return this.telemetrySettings.maxConversationHistory ?? 50;
  }

  getConversationRetentionDays(): number {
    return this.telemetrySettings.retentionDays ?? 30;
  }

  getMaxLogFiles(): number {
    return this.telemetrySettings.maxLogFiles ?? 10;
  }

  getMaxLogSizeMB(): number {
    return this.telemetrySettings.maxLogSizeMB ?? 100;
  }

  // Privacy configuration methods
  getRedactionConfig(): RedactionConfig {
    return {
      redactApiKeys: this.telemetrySettings.redactSensitiveData ?? true,
      redactCredentials: this.telemetrySettings.redactSensitiveData ?? true,
      redactFilePaths: this.telemetrySettings.redactFilePaths ?? false,
      redactUrls: this.telemetrySettings.redactUrls ?? false,
      redactEmails: this.telemetrySettings.redactEmails ?? false,
      redactPersonalInfo: this.telemetrySettings.redactPersonalInfo ?? false,
      customPatterns: this.telemetrySettings.customRedactionPatterns,
    };
  }

  getDataRetentionEnabled(): boolean {
    return this.telemetrySettings.enableDataRetention ?? true;
  }

  getConversationExpirationDays(): number {
    return this.telemetrySettings.conversationExpirationDays ?? 30;
  }

  getMaxConversationsStored(): number {
    return this.telemetrySettings.maxConversationsStored ?? 1000;
  }

  getTelemetrySettings(): TelemetrySettings & {
    remoteConsentGiven?: boolean;
    [key: string]: unknown;
  } {
    return {
      ...this.telemetrySettings,
      remoteConsentGiven: this.telemetrySettings.remoteConsentGiven,
    };
  }

  updateTelemetrySettings(settings: Partial<TelemetrySettings>): void {
    this.telemetrySettings = {
      ...this.telemetrySettings,
      ...settings,
    };

    // If we have a provider manager, update its config to trigger re-wrapping
    if (this.providerManager) {
      this.providerManager.setConfig(this);
    }
  }

  private expandPath(path: string): string {
    if (path.startsWith('~/')) {
      return path.replace('~', process.env.HOME || '');
    }
    return path;
  }

  getGeminiClient(): GeminiClient {
    return this.geminiClient;
  }

  getGeminiDir(): string {
    return path.join(this.targetDir, LLXPRT_DIR);
  }

  getProjectTempDir(): string {
    return this.storage.getProjectTempDir();
  }

  getEnableRecursiveFileSearch(): boolean {
    return this.fileFiltering.enableRecursiveFileSearch;
  }

  getFileFilteringDisableFuzzySearch(): boolean {
    return this.fileFiltering.disableFuzzySearch;
  }

  getFileFilteringRespectGitIgnore(): boolean {
    return this.fileFiltering.respectGitIgnore;
  }
  getFileFilteringRespectLlxprtIgnore(): boolean {
    return this.fileFiltering.respectLlxprtIgnore;
  }

  getFileFilteringOptions(): FileFilteringOptions {
    return {
      respectGitIgnore: this.fileFiltering.respectGitIgnore,
      respectLlxprtIgnore: this.fileFiltering.respectLlxprtIgnore,
    };
  }

  /**
   * Gets custom file exclusion patterns from configuration.
   */
  getCustomExcludes(): string[] {
    const customExcludes: string[] = [];
    return customExcludes;
  }

  getCheckpointingEnabled(): boolean {
    return this.checkpointing;
  }

  getDumpOnError(): boolean {
    return this.dumpOnError;
  }

  getProxy(): string | undefined {
    return this.proxy;
  }

  getWorkingDir(): string {
    return this.cwd;
  }

  getBugCommand(): BugCommandSettings | undefined {
    return this.bugCommand;
  }

  getFileService(): FileDiscoveryService {
    if (!this.fileDiscoveryService) {
      this.fileDiscoveryService = new FileDiscoveryService(this.targetDir);
    }
    return this.fileDiscoveryService;
  }

  getUsageStatisticsEnabled(): boolean {
    return this.usageStatisticsEnabled;
  }

  getExtensionContextFilePaths(): string[] {
    return this.extensionContextFilePaths;
  }

  getExperimentalZedIntegration(): boolean {
    return this.experimentalZedIntegration;
  }

  getListExtensions(): boolean {
    return this.listExtensions;
  }

  getExtensionManagement(): boolean {
    return this.extensionManagement;
  }

  getExtensionLoader(): ExtensionLoader {
    return this._extensionLoader;
  }

  getExtensions(): GeminiCLIExtension[] {
    return this._extensionLoader.getExtensions();
  }

  getActiveExtensions(): ActiveExtension[] {
    return this._activeExtensions;
  }

  /**
   * Check if an extension is enabled (i.e., isActive in the extension loader).
   * Returns true for unknown extensions to avoid filtering valid commands.
   */
  isExtensionEnabled(extensionName: string): boolean {
    const extension = this._extensionLoader
      .getExtensions()
      .find((ext) => ext.name === extensionName);
    // If extension not found, default to true to avoid filtering
    return extension ? extension.isActive : true;
  }

  getEnableExtensionReloading(): boolean {
    return this.enableExtensionReloading;
  }

  getExtensionEvents(): EventEmitter | undefined {
    return this.eventEmitter;
  }

  getProvider(): string | undefined {
    return this.provider;
  }

  setProvider(provider: string): void {
    this.provider = provider;
  }

  getNoBrowser(): boolean {
    return this.noBrowser;
  }

  isBrowserLaunchSuppressed(): boolean {
    return this.getNoBrowser() || !shouldAttemptBrowserLaunch();
  }

  getSummarizeToolOutputConfig():
    | Record<string, SummarizeToolOutputSettings>
    | undefined {
    return this.summarizeToolOutput;
  }

  getIdeClient(): IdeClient | undefined {
    return this.ideClient;
  }

  getIdeMode(): boolean {
    return this.ideMode;
  }

  /**
   * Returns 'true' if the folder trust feature is enabled.
   */
  getFolderTrust(): boolean {
    return this.folderTrust;
  }

  /**
   * Returns 'true' if the workspace is considered "trusted".
   * 'false' for untrusted.
   */
  isTrustedFolder(): boolean {
    // isWorkspaceTrusted in cli/src/config/trustedFolder.js returns undefined
    // when the file based trust value is unavailable, since it is mainly used
    // in the initialization for trust dialogs, etc. Here we return true since
    // config.isTrustedFolder() is used for the main business logic of blocking
    // tool calls etc in the rest of the application.
    //
    // Default value is true since we load with trusted settings to avoid
    // restarts in the more common path. If the user chooses to mark the folder
    // as untrusted, the CLI will restart and we will have the trust value
    // reloaded.
    const context = ideContext.getIdeContext();
    if (context?.workspaceState?.isTrusted !== undefined) {
      return context.workspaceState.isTrusted;
    }

    return this.trustedFolder ?? true;
  }

  setIdeMode(value: boolean): void {
    this.ideMode = value;
  }

  setIdeClientDisconnected(): void {
    void this.ideClient?.disconnect();
  }

  setIdeClientConnected(): void {
    void this.ideClient?.connect();
  }

  getComplexityAnalyzerSettings(): ComplexityAnalyzerSettings {
    return this.complexityAnalyzerSettings;
  }

  private normalizeStreamingValue(value: unknown): unknown {
    if (value === undefined || value === null) {
      return value;
    }

    if (typeof value === 'boolean') {
      return value ? 'enabled' : 'disabled';
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') {
        return 'enabled';
      }
      if (normalized === 'false') {
        return 'disabled';
      }
      if (normalized === 'enabled' || normalized === 'disabled') {
        return normalized;
      }
    }

    return value;
  }

  private normalizeAndPersistStreaming(value: unknown): unknown {
    const normalized = this.normalizeStreamingValue(value);

    if (normalized !== value && normalized !== undefined) {
      this.settingsService.set('streaming', normalized);
      return normalized;
    }

    return normalized;
  }

  getEphemeralSetting(key: string): unknown {
    const rawValue = this.settingsService.get(key);
    if (key === 'streaming') {
      return this.normalizeAndPersistStreaming(rawValue);
    }
    if (key === 'context-limit') {
      const normalized = this.normalizeContextLimit(rawValue);
      if (normalized !== undefined) {
        if (normalized !== rawValue) {
          this.settingsService.set(key, normalized);
        }
        return normalized;
      }
      const invalidNumberSetting = undefined;
      return invalidNumberSetting;
    }
    return rawValue;
  }

  private normalizeContextLimit(value: unknown): number | undefined {
    const invalidContextLimit = undefined;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') {
        return invalidContextLimit;
      }
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
    }
    return invalidContextLimit;
  }

  setEphemeralSetting(key: string, value: unknown): void {
    let settingValue = value;
    if (key === 'streaming') {
      settingValue = this.normalizeStreamingValue(value);
    }
    if (key === 'context-limit') {
      settingValue =
        value === undefined ? undefined : this.normalizeContextLimit(value);
    }

    if (
      key === 'streaming' &&
      settingValue !== undefined &&
      typeof settingValue !== 'string'
    ) {
      throw new Error(
        'Streaming setting must resolve to "enabled" or "disabled"',
      );
    }

    // Line 90: Direct delegation, no local storage
    this.settingsService.set(key, settingValue);

    // @plan PLAN-20260130-ASYNCTASK.P21
    // @requirement REQ-ASYNC-012
    // Propagate task-max-async changes to AsyncTaskManager
    if (key === 'task-max-async') {
      // Normalize the setting value to handle both string and number inputs
      let normalizedValue: number;

      if (typeof settingValue === 'number') {
        normalizedValue = settingValue;
      } else if (typeof settingValue === 'string') {
        // Try to parse as integer, fallback to 0 if invalid
        const parsed = parseInt(settingValue, 10);
        normalizedValue = isNaN(parsed) ? 0 : parsed;
      } else {
        // Fallback for other types
        normalizedValue = 0;
      }

      const asyncTaskManager = this.getAsyncTaskManager();
      if (asyncTaskManager) {
        asyncTaskManager.setMaxAsyncTasks(normalizedValue);
      }
    }

    // Clear provider caches when auth settings or base-url change
    // This fixes the issue where cached auth tokens persist after clearing auth settings
    if (
      key === 'auth-key' ||
      key === 'auth-keyfile' ||
      key === 'base-url' ||
      key === 'socket-timeout' ||
      key === 'socket-keepalive' ||
      key === 'socket-nodelay' ||
      key === 'streaming'
    ) {
      if (this.providerManager) {
        const activeProvider = this.providerManager.getActiveProvider();
        if (activeProvider) {
          // Clear cached OpenAI client if provider has this method
          if (
            'clearClientCache' in activeProvider &&
            typeof activeProvider.clearClientCache === 'function'
          ) {
            const providerWithClearCache = activeProvider as {
              clearClientCache: () => void;
            };
            providerWithClearCache.clearClientCache();
          }
          // Clear cached auth token if provider has this method
          if (
            'clearAuthCache' in activeProvider &&
            typeof activeProvider.clearAuthCache === 'function'
          ) {
            const providerWithClearAuth = activeProvider as {
              clearAuthCache: () => void;
            };
            providerWithClearAuth.clearAuthCache();
          }
        }
      }
    }
    // NO async operations
    // NO queue processing
  }

  clearEphemeralSettings(): void {
    // Line 97: Direct delegation
    this.settingsService.clear();
  }

  getEphemeralSettings(): Record<string, unknown> {
    // Return a copy of all global settings from the SettingsService
    const allSettings = this.settingsService.getAllGlobalSettings();
    if ('streaming' in allSettings) {
      const normalized = this.normalizeAndPersistStreaming(
        allSettings.streaming,
      );
      if (normalized !== undefined) {
        allSettings.streaming = normalized;
      }
    }
    return allSettings;
  }

  isInteractive(): boolean {
    return this.interactive;
  }

  getNonInteractive(): boolean {
    return !this.interactive;
  }

  /**
   * Get the current FileSystemService
   */
  getFileSystemService(): FileSystemService {
    return this.fileSystemService;
  }

  /**
   * Set a custom FileSystemService
   */
  setFileSystemService(fileSystemService: FileSystemService): void {
    this.fileSystemService = fileSystemService;
  }

  getChatCompression(): ChatCompressionSettings | undefined {
    return this.chatCompression;
  }

  addAlwaysAllowedCommand(rootCommand: string): void {
    this.alwaysAllowedCommands.add(rootCommand);
  }

  isCommandAlwaysAllowed(rootCommand: string): boolean {
    return this.alwaysAllowedCommands.has(rootCommand);
  }

  getAlwaysAllowedCommands(): string[] {
    return Array.from(this.alwaysAllowedCommands);
  }

  getShellReplacement(): ShellReplacementMode {
    // Check ephemeral setting first, fall back to constructor value
    const ephemeralValue = this.getEphemeralSetting('shell-replacement');
    if (ephemeralValue !== undefined) {
      return normalizeShellReplacement(
        ephemeralValue as ShellReplacementMode | boolean,
      );
    }
    return this.shellReplacement;
  }

  getUseRipgrep(): boolean {
    return this.useRipgrep;
  }

  getShouldUseNodePtyShell(): boolean {
    return this.shouldUseNodePtyShell;
  }

  getAllowPtyThemeOverride(): boolean {
    return this.allowPtyThemeOverride;
  }

  getPtyScrollbackLimit(): number {
    return this.ptyScrollbackLimit;
  }

  getPtyTerminalWidth(): number | undefined {
    return this.ptyTerminalWidth;
  }

  getPtyTerminalHeight(): number | undefined {
    return this.ptyTerminalHeight;
  }

  setPtyTerminalSize(
    width: number | undefined,
    height: number | undefined,
  ): void {
    if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
      this.ptyTerminalWidth = Math.floor(width);
    } else {
      this.ptyTerminalWidth = undefined;
    }

    if (typeof height === 'number' && Number.isFinite(height) && height > 0) {
      this.ptyTerminalHeight = Math.floor(height);
    } else {
      this.ptyTerminalHeight = undefined;
    }
  }

  getShellExecutionConfig(): ShellExecutionConfig {
    const ephemeralSettings = this.getEphemeralSettings();
    const inactivityTimeoutSeconds =
      (ephemeralSettings['shell-inactivity-timeout-seconds'] as
        | number
        | undefined) ?? 120; // Default 120 seconds
    const inactivityTimeoutMs =
      inactivityTimeoutSeconds === -1
        ? undefined
        : inactivityTimeoutSeconds * 1000;

    return {
      terminalWidth: this.getPtyTerminalWidth(),
      terminalHeight: this.getPtyTerminalHeight(),
      showColor: this.getAllowPtyThemeOverride(),
      scrollback: this.getPtyScrollbackLimit(),
      inactivityTimeoutMs,
      isSandboxOrCI: !!this.getSandbox() || process.env.CI === 'true',
    };
  }

  getSkipNextSpeakerCheck(): boolean {
    return this.skipNextSpeakerCheck;
  }

  getContinueOnFailedApiCall(): boolean {
    return this.continueOnFailedApiCall;
  }

  getEnableShellOutputEfficiency(): boolean {
    return this.enableShellOutputEfficiency;
  }

  getScreenReader(): boolean {
    return this.accessibility.screenReader ?? false;
  }

  getEnablePromptCompletion(): boolean {
    return this.enablePromptCompletion;
  }

  getJitContextEnabled(): boolean {
    // Check settings service first, then fall back to instance value
    const settingsValue = this.settingsService.get('jitContextEnabled');
    if (settingsValue !== undefined) {
      return settingsValue as boolean;
    }
    return this.jitContextEnabled ?? false;
  }

  /**
   * Lazily loads JIT subdirectory memory for a given path.
   * Returns formatted memory content from LLXPRT.md files found between
   * the target path and the trusted root, excluding already-loaded paths.
   */
  async getJitMemoryForPath(targetPath: string): Promise<string> {
    if (!this.getJitContextEnabled()) {
      return '';
    }

    const trustedRoots = [this.getTargetDir()];
    const alreadyLoadedPaths = new Set(this.getLlxprtMdFilePaths());

    const result = await loadJitSubdirectoryMemory(
      targetPath,
      trustedRoots,
      alreadyLoadedPaths,
      this.getDebugMode(),
      true,
    );

    if (result.files.length === 0) {
      return '';
    }

    return result.files
      .map((f) => {
        const trimmed = f.content.trim();
        if (!trimmed) {
          const emptyContext = null;
          return emptyContext;
        }
        return `--- JIT Context from: ${f.path} ---
${trimmed}
--- End of JIT Context from: ${f.path} ---`;
      })
      .filter((block): block is string => block !== null)
      .join('\n\n');
  }

  async getGitService(): Promise<GitService> {
    if (!this.gitService) {
      this.gitService = new GitService(this.targetDir, this.storage);
      await this.gitService.initialize();
    }
    return this.gitService;
  }

  /**
   * Get the AsyncTaskManager instance
   * @plan PLAN-20260130-ASYNCTASK.P09
   */
  getAsyncTaskManager(): AsyncTaskManager | undefined {
    if (!this.asyncTaskManager) {
      // Initialize lazily using the 'task-max-async' setting (default 5)
      const settingsService = this.getSettingsService();
      const maxAsyncTasks =
        (settingsService.get('task-max-async') as number) ?? 5;
      this.asyncTaskManager = new AsyncTaskManager(maxAsyncTasks);
    }
    return this.asyncTaskManager;
  }

  /**
   * Get the AsyncTaskReminderService instance
   * @plan PLAN-20260130-ASYNCTASK.P22
   */
  getAsyncTaskReminderService(): AsyncTaskReminderService | undefined {
    if (!this.asyncTaskReminderService) {
      const asyncTaskManager = this.getAsyncTaskManager();
      if (asyncTaskManager) {
        this.asyncTaskReminderService = new AsyncTaskReminderService(
          asyncTaskManager,
        );
      }
    }
    return this.asyncTaskReminderService;
  }

  /**
   * Set up AsyncTaskAutoTrigger with client callbacks
   * @plan PLAN-20260130-ASYNCTASK.P22
   * @param isAgentBusy Function to check if the agent is busy
   * @param triggerAgentTurn Function to trigger an agent turn with a message
   * @returns Cleanup function to unsubscribe from auto-trigger
   */
  setupAsyncTaskAutoTrigger(
    isAgentBusy: () => boolean,
    triggerAgentTurn: (message: string) => Promise<void>,
  ): () => void {
    const asyncTaskManager = this.getAsyncTaskManager();
    const reminderService = this.getAsyncTaskReminderService();

    if (!asyncTaskManager || !reminderService) {
      // Return a no-op cleanup function if components aren't available
      return () => {};
    }

    if (!this.asyncTaskAutoTrigger) {
      this.asyncTaskAutoTrigger = new AsyncTaskAutoTrigger(
        asyncTaskManager,
        reminderService,
        isAgentBusy,
        triggerAgentTurn,
      );
    } else {
      // Refresh callbacks with the latest closures from React re-renders
      this.asyncTaskAutoTrigger.updateCallbacks(isAgentBusy, triggerAgentTurn);
    }

    return this.asyncTaskAutoTrigger.subscribe();
  }

  /**
   * Get the SettingsService instance
   */
  getSettingsService(): SettingsService {
    return this.settingsService;
  }

  getFileExclusions(): FileExclusions {
    return this.fileExclusions;
  }

  getStorage(): Storage {
    return this.storage;
  }

  getTruncateToolOutputThreshold(): number {
    return this.truncateToolOutputThreshold;
  }

  getTruncateToolOutputLines(): number {
    return this.truncateToolOutputLines;
  }

  isToolOutputTruncationEnabled(): boolean {
    return this.enableToolOutputTruncation;
  }

  async refreshMemory(): Promise<{
    memoryContent: string;
    fileCount: number;
    filePaths: string[];
  }> {
    if (this.getJitContextEnabled() && this.contextManager) {
      await this.contextManager.refresh();
      const memoryContent = this.getUserMemory();
      const fileCount = this.getLlxprtMdFileCount();
      const filePaths = this.getLlxprtMdFilePaths();
      const coreMemoryFileCount = this.getCoreMemoryFileCount();

      coreEvents.emit(CoreEvent.MemoryChanged, {
        fileCount,
        coreMemoryFileCount,
      });

      return { memoryContent, fileCount, filePaths };
    }

    const { memoryContent, fileCount, filePaths } =
      await loadServerHierarchicalMemory(
        this.getWorkingDir(),
        this.shouldLoadMemoryFromIncludeDirectories()
          ? this.getWorkspaceContext().getDirectories()
          : [],
        this.getDebugMode(),
        this.getFileService(),
        this.getExtensions(),
        this.getFolderTrust(),
      );

    this.setUserMemory(memoryContent);
    this.setLlxprtMdFileCount(fileCount);
    this.setLlxprtMdFilePaths(filePaths);

    coreEvents.emit(CoreEvent.MemoryChanged, {
      fileCount,
    });

    return { memoryContent, fileCount, filePaths };
  }

  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P09
   * @requirement REQ-D01-002.1
   * @requirement REQ-D01-002.2
   * @requirement REQ-D01-002.3
   * @pseudocode lines 103-111
   */

  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P11
   * @requirement REQ-D01-002
   * @requirement REQ-D01-003
   * @pseudocode lines 122-133
   */
  async createToolRegistry(messageBus: MessageBus): Promise<ToolRegistry> {
    const result = await createToolRegistryFromConfig(this, messageBus);
    this.allPotentialTools.push(...result.potentialTools);
    if (!this.profileManager) {
      this.setProfileManager(result.profileManager);
    }
    if (!this.subagentManager && result.subagentManager) {
      this.setSubagentManager(result.subagentManager);
    }
    return result.registry;
  }

  /**
   * Get all potential tools (both registered and unregistered) for settings UI
   */
  getAllPotentialTools() {
    return this.allPotentialTools;
  }

  /**
   * Get tool registry information with registered/unregistered separation
   */
  getToolRegistryInfo() {
    return {
      registered: this.allPotentialTools.filter((t) => t.isRegistered),
      unregistered: this.allPotentialTools.filter((t) => !t.isRegistered),
    };
  }

  /**
   * @plan PLAN-20260309-MESSAGEBUS-DI-REMEDIATION.P05
   * @requirement REQ-D01-001.1
   * @requirement REQ-D01-001.2
   * @pseudocode lines 56-72
   */
  async getOrCreateScheduler(
    sessionId: string,
    callbacks: SchedulerCallbacks,
    options?: SchedulerOptions,
    dependencies?: {
      messageBus?: MessageBus;
      toolRegistry?: ToolRegistry;
    },
  ): Promise<import('../core/coreToolScheduler.js').CoreToolScheduler> {
    const schedulerMessageBus = dependencies?.messageBus;
    if (!schedulerMessageBus) {
      throw new Error(
        'Config.getOrCreateScheduler requires an explicit session/runtime MessageBus dependency.',
      );
    }
    return _getOrCreateScheduler(this, sessionId, callbacks, options, {
      messageBus: schedulerMessageBus,
      toolRegistry: dependencies?.toolRegistry ?? this.getToolRegistry(),
    });
  }

  disposeScheduler(sessionId: string): void {
    _disposeScheduler(sessionId);
  }

  getEnableHooks(): boolean {
    return this.enableHooks;
  }

  /**
   * Get hooks configuration
   */
  getHooks(): { [K in HookEventName]?: HookDefinition[] } | undefined {
    return this.hooks;
  }

  /**
   * Get disabled hooks list
   */
  getDisabledHooks(): string[] {
    if (this.disabledHooks.length === 0) {
      const persisted = this.settingsService.get('hooks.disabled') as
        | string[]
        | undefined;
      if (persisted && persisted.length > 0) {
        this.disabledHooks = persisted;
      }
    }
    return this.disabledHooks;
  }

  /**
   * Set disabled hooks list
   * Updates both in-memory state and persists to settings
   */
  setDisabledHooks(hooks: string[]): void {
    this.disabledHooks = hooks;
    // Persist to settings service
    this.settingsService.set('hooks.disabled', hooks);
  }

  /**
   * Get the HookSystem instance, creating it lazily on first access.
   * Returns undefined if hooks are disabled (enableHooks=false).
   *
   * @plan:PLAN-20260216-HOOKSYSTEMREWRITE.P03
   * @requirement:HOOK-001 - Lazy creation on first call when enableHooks=true
   * @requirement:HOOK-002 - Returns undefined when enableHooks=false
   * @requirement:HOOK-010 - Zero CPU/memory overhead when hooks are disabled
   */
  getHookSystem(): HookSystem | undefined {
    // @requirement:HOOK-002 - Return no hook system when hooks are disabled.
    if (!this.enableHooks) {
      const disabledHookSystem = undefined;
      return disabledHookSystem;
    }

    // @requirement:HOOK-001 - Lazy creation on first access
    if (!this.hookSystem) {
      this.hookSystem = new HookSystem(this);
    }

    return this.hookSystem;
  }

  /**
   * Check if interactive shell is enabled.
   * Returns true if shouldUseNodePtyShell setting is enabled.
   */
  getEnableInteractiveShell(): boolean {
    return this.shouldUseNodePtyShell;
  }

  /**
   * Get project hooks configuration
   */
  getProjectHooks():
    | ({ [K in HookEventName]?: HookDefinition[] } & { disabled?: string[] })
    | undefined {
    return this.projectHooks;
  }

  /**
   * Get output settings
   */
  getOutputSettings(): OutputSettings {
    return this.outputSettings;
  }

  /**
   * Get codebase investigator settings
   */
  getCodebaseInvestigatorSettings(): CodebaseInvestigatorSettings {
    return this.codebaseInvestigatorSettings;
  }

  /**
   * Get introspection agent settings
   */
  getIntrospectionAgentSettings(): IntrospectionAgentSettings {
    return this.introspectionAgentSettings;
  }

  /**
   * Checks whether the WriteTodos tool is enabled.
   */
  getUseWriteTodos(): boolean {
    return this.useWriteTodos;
  }

  /**
   * Check if skills support is enabled
   */
  isSkillsSupportEnabled(): boolean {
    return this.skillsSupport;
  }

  /**
   * Get the sanitization config
   */
  getSanitizationConfig(): EnvironmentSanitizationConfig | undefined {
    return this.sanitizationConfig;
  }

  /**
   * Get LSP service client if available.
   * @plan PLAN-20250212-LSP.P33
   * @requirement REQ-DIAG-010, REQ-CFG-010, REQ-CFG-015, REQ-CFG-020
   * @returns LspServiceClient instance or undefined if not initialized or disabled
   */
  getLspServiceClient():
    | import('../lsp/lsp-service-client.js').LspServiceClient
    | undefined {
    return this.lspServiceClient;
  }

  /**
   * Get LSP configuration.
   * @plan PLAN-20250212-LSP.P33
   * @requirement REQ-DIAG-010, REQ-CFG-010, REQ-CFG-015, REQ-CFG-020
   * @returns LspConfig or undefined (undefined means LSP disabled)
   */
  getLspConfig(): import('../lsp/types.js').LspConfig | undefined {
    return this.lspConfig;
  }

  /**
   * Shutdown LSP service if running.
   * @plan PLAN-20250212-LSP.P33
   * @requirement REQ-GRACE-020, REQ-GRACE-040
   */
  async shutdownLspService(): Promise<void> {
    await shutdownLsp(
      {
        lspServiceClient: this.lspServiceClient,
        lspMcpClient: this.lspMcpClient,
        lspMcpTransport: this.lspMcpTransport,
      },
      this.toolRegistry,
    );
    this.lspServiceClient = undefined;
    this.lspMcpClient = undefined;
    this.lspMcpTransport = undefined;
  }
}

// Re-export scheduler types for external use
export { type SchedulerCallbacks, type SchedulerOptions };

// Export model constants for use in CLI
export { DEFAULT_GEMINI_FLASH_MODEL };
