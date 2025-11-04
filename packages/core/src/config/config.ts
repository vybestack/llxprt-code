/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import {
  AuthType,
  ContentGeneratorConfig,
  createContentGeneratorConfig,
} from '../core/contentGenerator.js';
import { PromptRegistry } from '../prompts/prompt-registry.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { LSTool } from '../tools/ls.js';
import { ReadFileTool } from '../tools/read-file.js';
import { GrepTool } from '../tools/grep.js';
import { RipGrepTool } from '../tools/ripGrep.js';
import { GlobTool } from '../tools/glob.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import { EditTool } from '../tools/edit.js';
import { SmartEditTool } from '../tools/smart-edit.js';
import { ShellTool } from '../tools/shell.js';
import { WriteFileTool } from '../tools/write-file.js';
import { WebFetchTool } from '../tools/web-fetch.js';
import { ReadManyFilesTool } from '../tools/read-many-files.js';
import { ReadLineRangeTool } from '../tools/read_line_range.js';
import { DeleteLineRangeTool } from '../tools/delete_line_range.js';
import { InsertAtLineTool } from '../tools/insert_at_line.js';
import {
  MemoryTool,
  setLlxprtMdFilename,
  LLXPRT_CONFIG_DIR as LLXPRT_DIR,
} from '../tools/memoryTool.js';
import { WebSearchTool } from '../tools/web-search.js';
import { TodoWrite } from '../tools/todo-write.js';
import { TodoRead } from '../tools/todo-read.js';
import { TodoPause } from '../tools/todo-pause.js';
import { TaskTool } from '../tools/task.js';
import type { SubagentSchedulerFactory } from '../core/subagentScheduler.js';
import { ListSubagentsTool } from '../tools/list-subagents.js';
import { GeminiClient } from '../core/client.js';
import { createAgentRuntimeStateFromConfig } from '../runtime/runtimeStateFactory.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import { GitService } from '../services/gitService.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { loadServerHierarchicalMemory } from '../utils/memoryDiscovery.js';
import {
  // TELEMETRY: Re-enabled for local file logging only
  initializeTelemetry,
  DEFAULT_TELEMETRY_TARGET,
  DEFAULT_OTLP_ENDPOINT,
  TelemetryTarget,
  logCliConfiguration,
  StartSessionEvent,
} from '../telemetry/index.js';
import {
  DEFAULT_GEMINI_EMBEDDING_MODEL,
  DEFAULT_GEMINI_FLASH_MODEL,
} from './models.js';
import type { IProviderManager as ProviderManager } from '../providers/IProviderManager.js';
import { shouldAttemptBrowserLaunch } from '../utils/browser.js';
import { MCPOAuthConfig } from '../mcp/oauth-provider.js';
import { IdeClient } from '../ide/ide-client.js';
import { ideContext } from '../ide/ideContext.js';
import type { Content } from '@google/genai';
import { registerSettingsService } from '../settings/settingsServiceInstance.js';
import { SettingsService } from '../settings/SettingsService.js';
import {
  createProviderRuntimeContext,
  getActiveProviderRuntimeContext,
  peekActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';
import {
  FileSystemService,
  StandardFileSystemService,
} from '../services/fileSystemService.js';
import { ProfileManager } from './profileManager.js';
import { SubagentManager } from './subagentManager.js';

// Re-export OAuth config type
export type { MCPOAuthConfig, AnyToolInvocation };
import type { AnyToolInvocation } from '../tools/tools.js';
import { WorkspaceContext } from '../utils/workspaceContext.js';
import { Storage } from './storage.js';
import { FileExclusions } from '../utils/ignorePatterns.js';
import type { EventEmitter } from 'node:events';

// Import privacy-related types
export interface RedactionConfig {
  redactApiKeys: boolean;
  redactCredentials: boolean;
  redactFilePaths: boolean;
  redactUrls: boolean;
  redactEmails: boolean;
  redactPersonalInfo: boolean;
  customPatterns?: Array<{
    name: string;
    pattern: RegExp;
    replacement: string;
    enabled: boolean;
  }>;
}

export enum ApprovalMode {
  DEFAULT = 'default',
  AUTO_EDIT = 'autoEdit',
  YOLO = 'yolo',
}

export interface AccessibilitySettings {
  disableLoadingPhrases?: boolean;
  screenReader?: boolean;
}

export interface BugCommandSettings {
  urlTemplate: string;
}

export interface ChatCompressionSettings {
  contextPercentageThreshold?: number;
}

export interface SummarizeToolOutputSettings {
  tokenBudget?: number;
}

export interface ComplexityAnalyzerSettings {
  complexityThreshold?: number;
  minTasksForSuggestion?: number;
  suggestionCooldownMs?: number;
}

export interface TelemetrySettings {
  enabled?: boolean;
  target?: TelemetryTarget;
  otlpEndpoint?: string;
  logPrompts?: boolean;
  outfile?: string;
  logConversations?: boolean;
  logResponses?: boolean;
  redactSensitiveData?: boolean;
  maxConversationHistory?: number;
  conversationLogPath?: string;
  maxLogFiles?: number;
  maxLogSizeMB?: number;
  retentionDays?: number;
  // Privacy-related settings
  redactFilePaths?: boolean;
  redactUrls?: boolean;
  redactEmails?: boolean;
  redactPersonalInfo?: boolean;
  customRedactionPatterns?: Array<{
    name: string;
    pattern: RegExp;
    replacement: string;
    enabled: boolean;
  }>;
  enableDataRetention?: boolean;
  conversationExpirationDays?: number;
  maxConversationsStored?: number;
  remoteConsentGiven?: boolean;
}

export interface GeminiCLIExtension {
  name: string;
  version: string;
  isActive: boolean;
  path: string;
}
export interface FileFilteringOptions {
  respectGitIgnore: boolean;
  respectLlxprtIgnore: boolean;
}
// For memory files
export const DEFAULT_MEMORY_FILE_FILTERING_OPTIONS: FileFilteringOptions = {
  respectGitIgnore: false,
  respectLlxprtIgnore: true,
};
// For all other files
export const DEFAULT_FILE_FILTERING_OPTIONS: FileFilteringOptions = {
  respectGitIgnore: true,
  respectLlxprtIgnore: true,
};
export class MCPServerConfig {
  constructor(
    // For stdio transport
    readonly command?: string,
    readonly args?: string[],
    readonly env?: Record<string, string>,
    readonly cwd?: string,
    // For sse transport
    readonly url?: string,
    // For streamable http transport
    readonly httpUrl?: string,
    readonly headers?: Record<string, string>,
    // For websocket transport
    readonly tcp?: string,
    // Common
    readonly timeout?: number,
    readonly trust?: boolean,
    // Metadata
    readonly description?: string,
    readonly includeTools?: string[],
    readonly excludeTools?: string[],
    readonly extensionName?: string,
    // OAuth configuration
    readonly oauth?: MCPOAuthConfig,
    readonly authProviderType?: AuthProviderType,
  ) {}
}

export enum AuthProviderType {
  DYNAMIC_DISCOVERY = 'dynamic_discovery',
  GOOGLE_CREDENTIALS = 'google_credentials',
}

export interface SandboxConfig {
  command: 'docker' | 'podman' | 'sandbox-exec';
  image: string;
}

export interface ActiveExtension {
  name: string;
  version: string;
}

export interface ConfigParameters {
  sessionId: string;
  embeddingModel?: string;
  sandbox?: SandboxConfig;
  targetDir: string;
  debugMode: boolean;
  question?: string;
  fullContext?: boolean;
  coreTools?: string[];
  allowedTools?: string[];
  excludeTools?: string[];
  toolDiscoveryCommand?: string;
  toolCallCommand?: string;
  mcpServerCommand?: string;
  mcpServers?: Record<string, MCPServerConfig>;
  userMemory?: string;
  llxprtMdFileCount?: number;
  approvalMode?: ApprovalMode;
  showMemoryUsage?: boolean;
  contextLimit?: number;
  compressionThreshold?: number;
  contextFileName?: string | string[];
  accessibility?: AccessibilitySettings;
  telemetry?: TelemetrySettings;
  usageStatisticsEnabled?: boolean;
  fileFiltering?: {
    respectGitIgnore?: boolean;
    respectLlxprtIgnore?: boolean;
    enableRecursiveFileSearch?: boolean;
    disableFuzzySearch?: boolean;
  };
  checkpointing?: boolean;
  dumpOnError?: boolean;
  proxy?: string;
  cwd: string;
  fileDiscoveryService?: FileDiscoveryService;
  includeDirectories?: string[];
  bugCommand?: BugCommandSettings;
  model: string;
  extensionContextFilePaths?: string[];
  maxSessionTurns?: number;
  experimentalZedIntegration?: boolean;
  listExtensions?: boolean;
  activeExtensions?: ActiveExtension[];
  providerManager?: ProviderManager;
  provider?: string;
  extensions?: GeminiCLIExtension[];
  blockedMcpServers?: Array<{ name: string; extensionName: string }>;
  noBrowser?: boolean;
  summarizeToolOutput?: Record<string, SummarizeToolOutputSettings>;
  folderTrustFeature?: boolean;
  folderTrust?: boolean;
  ideMode?: boolean;
  ideClient?: IdeClient;
  complexityAnalyzer?: ComplexityAnalyzerSettings;
  loadMemoryFromIncludeDirectories?: boolean;
  chatCompression?: ChatCompressionSettings;
  interactive?: boolean;
  shellReplacement?: boolean;
  trustedFolder?: boolean;
  useRipgrep?: boolean;
  shouldUseNodePtyShell?: boolean;
  skipNextSpeakerCheck?: boolean;
  extensionManagement?: boolean;
  enablePromptCompletion?: boolean;
  eventEmitter?: EventEmitter;
  useSmartEdit?: boolean;
  settingsService?: SettingsService;
}

export class Config {
  private toolRegistry!: ToolRegistry;
  private promptRegistry!: PromptRegistry;
  private readonly sessionId: string;
  private readonly settingsService: SettingsService;
  private fileSystemService: FileSystemService;
  private contentGeneratorConfig!: ContentGeneratorConfig;
  private readonly embeddingModel: string;
  private readonly sandbox: SandboxConfig | undefined;
  private readonly targetDir: string;
  private workspaceContext: WorkspaceContext;
  private readonly debugMode: boolean;
  private readonly question: string | undefined;
  private readonly fullContext: boolean;
  private readonly coreTools: string[] | undefined;
  private readonly allowedTools: string[] | undefined;
  private readonly excludeTools: string[] | undefined;
  private readonly toolDiscoveryCommand: string | undefined;
  private readonly toolCallCommand: string | undefined;
  private readonly mcpServerCommand: string | undefined;
  private readonly mcpServers: Record<string, MCPServerConfig> | undefined;
  private userMemory: string;
  private llxprtMdFileCount: number;
  private approvalMode: ApprovalMode;
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
  private readonly checkpointing: boolean;
  private readonly dumpOnError: boolean;
  private readonly proxy: string | undefined;
  private readonly cwd: string;
  private readonly bugCommand: BugCommandSettings | undefined;
  private model: string;
  private readonly originalModel: string;
  private readonly extensionContextFilePaths: string[];
  private readonly noBrowser: boolean;
  private readonly folderTrustFeature: boolean;
  private readonly folderTrust: boolean;
  private ideMode: boolean;
  private ideClient!: IdeClient;
  private inFallbackMode = false;
  private _modelSwitchedDuringSession: boolean = false;
  private readonly maxSessionTurns: number;
  private readonly _activeExtensions: ActiveExtension[];
  private readonly listExtensions: boolean;
  private readonly _extensions: GeminiCLIExtension[];
  private readonly _blockedMcpServers: Array<{
    name: string;
    extensionName: string;
  }>;
  private providerManager?: ProviderManager;
  private profileManager?: ProfileManager;
  private subagentManager?: SubagentManager;
  private subagentSchedulerFactory?: SubagentSchedulerFactory;

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
  private readonly skipNextSpeakerCheck: boolean;
  private readonly extensionManagement: boolean;
  private readonly enablePromptCompletion: boolean = false;
  private initialized: boolean = false;
  private readonly shellReplacement: boolean = false;
  readonly storage: Storage;
  private readonly fileExclusions: FileExclusions;
  private readonly eventEmitter?: EventEmitter;
  private readonly useSmartEdit: boolean;

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
      this.settingsService = getActiveProviderRuntimeContext().settingsService;
    }

    const currentContext = peekActiveProviderRuntimeContext();
    if (!currentContext) {
      setActiveProviderRuntimeContext(
        createProviderRuntimeContext({
          settingsService: this.settingsService,
          config: this,
          runtimeId: providedSettingsService
            ? 'injected-config'
            : 'legacy-config',
          metadata: { source: 'ConfigConstructor' },
        }),
      );
    } else if (
      currentContext.settingsService === this.settingsService &&
      currentContext.config !== this
    ) {
      setActiveProviderRuntimeContext({
        ...currentContext,
        config: this,
      });
    }

    this.sessionId = params.sessionId;
    this.embeddingModel =
      params.embeddingModel ?? DEFAULT_GEMINI_EMBEDDING_MODEL;
    this.fileSystemService = new StandardFileSystemService();
    this.sandbox = params.sandbox;
    this.targetDir = path.resolve(params.targetDir);
    this.workspaceContext = new WorkspaceContext(
      this.targetDir,
      params.includeDirectories ?? [],
    );
    this.debugMode = params.debugMode;
    this.question = params.question;
    this.fullContext = params.fullContext ?? false;
    this.coreTools = params.coreTools;
    this.allowedTools = params.allowedTools;
    this.excludeTools = params.excludeTools;
    this.toolDiscoveryCommand = params.toolDiscoveryCommand;
    this.toolCallCommand = params.toolCallCommand;
    this.mcpServerCommand = params.mcpServerCommand;
    this.mcpServers = params.mcpServers;
    this.userMemory = params.userMemory ?? '';
    this.llxprtMdFileCount = params.llxprtMdFileCount ?? 0;
    this.approvalMode = params.approvalMode ?? ApprovalMode.DEFAULT;
    this.showMemoryUsage = params.showMemoryUsage ?? false;
    this.accessibility = params.accessibility ?? {};
    this.telemetrySettings = {
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
    this.usageStatisticsEnabled = params.usageStatisticsEnabled ?? true;

    this.fileFiltering = {
      respectGitIgnore: params.fileFiltering?.respectGitIgnore ?? true,
      respectLlxprtIgnore: params.fileFiltering?.respectLlxprtIgnore ?? true,
      enableRecursiveFileSearch:
        params.fileFiltering?.enableRecursiveFileSearch ?? true,
      disableFuzzySearch: params.fileFiltering?.disableFuzzySearch ?? false,
    };
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
    this._extensions = params.extensions ?? [];
    this._blockedMcpServers = params.blockedMcpServers ?? [];
    this.noBrowser = params.noBrowser ?? false;
    this.summarizeToolOutput = params.summarizeToolOutput;
    this.folderTrustFeature = params.folderTrustFeature ?? false;
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
    this.shellReplacement = params.shellReplacement ?? false;
    this.trustedFolder = params.trustedFolder;
    this.useRipgrep = params.useRipgrep ?? false;
    this.shouldUseNodePtyShell = params.shouldUseNodePtyShell ?? false;
    this.skipNextSpeakerCheck = params.skipNextSpeakerCheck ?? false;
    this.useSmartEdit = params.useSmartEdit ?? false;
    this.extensionManagement = params.extensionManagement ?? false;
    this.storage = new Storage(this.targetDir);
    this.enablePromptCompletion = params.enablePromptCompletion ?? false;
    this.fileExclusions = new FileExclusions(this);
    this.eventEmitter = params.eventEmitter;

    this.runtimeState = createAgentRuntimeStateFromConfig(this);

    if (params.contextFileName) {
      setLlxprtMdFilename(params.contextFileName);
    }

    // TELEMETRY: Re-enabled for local file logging only - no network endpoints allowed
    const isTestEnvironment =
      process.env.NODE_ENV === 'test' || process.env.VITEST;
    if (process.env.VERBOSE === 'true' && !isTestEnvironment) {
      console.log(
        `[CONFIG] Telemetry settings:`,
        JSON.stringify(this.telemetrySettings),
      );
    }
    if (this.telemetrySettings.enabled) {
      if (process.env.VERBOSE === 'true' && !isTestEnvironment) {
        console.log(`[CONFIG] Initializing telemetry`);
      }
      initializeTelemetry(this);
    } else if (process.env.VERBOSE === 'true' && !isTestEnvironment) {
      console.log(`[CONFIG] Telemetry disabled`);
    }

    logCliConfiguration(this, new StartSessionEvent(this));
  }

  /**
   * Must only be called once, throws if called again.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      throw Error('Config was already initialized');
    }
    this.initialized = true;
    this.ideClient = await IdeClient.getInstance();
    // Initialize centralized FileDiscoveryService
    this.getFileService();
    if (this.getCheckpointingEnabled()) {
      await this.getGitService();
    }
    this.promptRegistry = new PromptRegistry();
    this.toolRegistry = await this.createToolRegistry();

    // Create GeminiClient instance immediately without authentication
    // This ensures geminiClient is available for providers on startup
    this.geminiClient = new GeminiClient(this, this.runtimeState);

    // Reserved for future model switching tracking
    void this._modelSwitchedDuringSession;
  }

  async refreshAuth(authMethod: AuthType) {
    const logger = new DebugLogger('llxprt:config:refreshAuth');

    // Save the current conversation history AND HistoryService before creating a new client
    let existingHistory: Content[] = [];
    let existingHistoryService: HistoryService | null = null;

    if (this.geminiClient && this.geminiClient.isInitialized()) {
      existingHistory = await this.geminiClient.getHistory();
      existingHistoryService = this.geminiClient.getHistoryService();
      logger.debug('Retrieved existing state', {
        historyLength: existingHistory.length,
        hasHistoryService: !!existingHistoryService,
        authMethod,
      });
    }

    // Create new content generator config
    const newContentGeneratorConfig = createContentGeneratorConfig(
      this,
      authMethod,
    );

    // Add provider manager to the config if available (llxprt multi-provider support)
    if (this.providerManager) {
      newContentGeneratorConfig.providerManager = this.providerManager;
    }

    const updatedRuntimeState = createAgentRuntimeStateFromConfig(this, {
      runtimeId: this.runtimeState.runtimeId,
      overrides: {
        model: newContentGeneratorConfig.model,
        authType:
          newContentGeneratorConfig.authType ?? this.runtimeState.authType,
        authPayload: newContentGeneratorConfig.apiKey
          ? { apiKey: newContentGeneratorConfig.apiKey }
          : undefined,
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
        this.contentGeneratorConfig?.authType === AuthType.USE_GEMINI &&
        authMethod === AuthType.LOGIN_WITH_GOOGLE;

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
  }

  getSessionId(): string {
    return this.sessionId;
  }

  shouldLoadMemoryFromIncludeDirectories(): boolean {
    return this.loadMemoryFromIncludeDirectories;
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
    this.model = newModel;
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

  getEmbeddingModel(): string {
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

  getDebugMode(): boolean {
    return this.debugMode;
  }
  getQuestion(): string | undefined {
    return this.question;
  }

  getFullContext(): boolean {
    return this.fullContext;
  }

  getCoreTools(): string[] | undefined {
    return this.coreTools;
  }

  getAllowedTools(): string[] | undefined {
    return this.allowedTools;
  }

  getExcludeTools(): string[] | undefined {
    return this.excludeTools;
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

  getMcpServers(): Record<string, MCPServerConfig> | undefined {
    return this.mcpServers;
  }

  getUserMemory(): string {
    return this.userMemory;
  }

  setUserMemory(newUserMemory: string): void {
    this.userMemory = newUserMemory;
  }

  getLlxprtMdFileCount(): number {
    return this.llxprtMdFileCount;
  }

  setLlxprtMdFileCount(count: number): void {
    this.llxprtMdFileCount = count;
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

  getShowMemoryUsage(): boolean {
    return this.showMemoryUsage;
  }

  getAccessibility(): AccessibilitySettings {
    return this.accessibility;
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
    // Check CLI flags first - placeholder for future CLI implementation
    // For now, check environment variables and settings file

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
   * TODO: This is a placeholder implementation. In the future, this could
   * read from settings files, CLI arguments, or environment variables.
   */
  getCustomExcludes(): string[] {
    // Placeholder implementation - returns empty array for now
    // Future implementation could read from:
    // - User settings file
    // - Project-specific configuration
    // - Environment variables
    // - CLI arguments
    return [];
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

  getExtensions(): GeminiCLIExtension[] {
    return this._extensions;
  }

  getActiveExtensions(): ActiveExtension[] {
    return this._activeExtensions;
  }

  getBlockedMcpServers(): Array<{ name: string; extensionName: string }> {
    return this._blockedMcpServers;
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

  getFolderTrustFeature(): boolean {
    return this.folderTrustFeature;
  }

  /**
   * Returns 'true' if the workspace is considered "trusted".
   * 'false' for untrusted.
   */
  getFolderTrust(): boolean {
    return this.folderTrust;
  }

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
    this.ideClient?.disconnect();
  }

  setIdeClientConnected(): void {
    this.ideClient?.connect();
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
    return rawValue;
  }

  setEphemeralSetting(key: string, value: unknown): void {
    let settingValue = value;
    if (key === 'streaming') {
      settingValue = this.normalizeStreamingValue(value);
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

  getShellReplacement(): boolean {
    // Check ephemeral setting first, fall back to constructor value
    const ephemeralValue = this.getEphemeralSetting('shell-replacement');
    if (ephemeralValue === true) {
      return true;
    }
    return this.shellReplacement;
  }

  getUseRipgrep(): boolean {
    return this.useRipgrep;
  }

  getShouldUseNodePtyShell(): boolean {
    return this.shouldUseNodePtyShell;
  }

  getSkipNextSpeakerCheck(): boolean {
    return this.skipNextSpeakerCheck;
  }

  getScreenReader(): boolean {
    return this.accessibility.screenReader ?? false;
  }

  getEnablePromptCompletion(): boolean {
    return this.enablePromptCompletion;
  }

  getUseSmartEdit(): boolean {
    return this.useSmartEdit;
  }

  async getGitService(): Promise<GitService> {
    if (!this.gitService) {
      this.gitService = new GitService(this.targetDir, this.storage);
      await this.gitService.initialize();
    }
    return this.gitService;
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

  async refreshMemory(): Promise<{ memoryContent: string; fileCount: number }> {
    const { memoryContent, fileCount } = await loadServerHierarchicalMemory(
      this.getWorkingDir(),
      this.shouldLoadMemoryFromIncludeDirectories()
        ? this.getWorkspaceContext().getDirectories()
        : [],
      this.getDebugMode(),
      this.getFileService(),
      this.getExtensionContextFilePaths(),
      this.getFolderTrust(),
    );

    this.setUserMemory(memoryContent);
    this.setLlxprtMdFileCount(fileCount);

    return { memoryContent, fileCount };
  }

  async createToolRegistry(): Promise<ToolRegistry> {
    const registry = new ToolRegistry(this, this.eventEmitter);

    const baseCoreTools = this.getCoreTools();
    const effectiveCoreTools =
      baseCoreTools && baseCoreTools.length > 0
        ? [...baseCoreTools]
        : undefined;

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

    // helper to create & register core tools that are enabled
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registerCoreTool = (ToolClass: any, ...args: unknown[]) => {
      const className = ToolClass.name;
      const toolName = ToolClass.Name || className;
      const coreTools = effectiveCoreTools;
      const excludeTools = this.getExcludeTools() || [];

      let isEnabled = true; // Enabled by default if coreTools is not set.
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
      }

      if (isEnabled) {
        registry.registerTool(new ToolClass(...args));
      }
    };

    registerCoreTool(LSTool, this);
    registerCoreTool(ReadFileTool, this);

    if (this.getUseRipgrep()) {
      registerCoreTool(RipGrepTool, this);
    } else {
      registerCoreTool(GrepTool, this);
    }

    registerCoreTool(GlobTool, this);
    if (this.getUseSmartEdit()) {
      registerCoreTool(SmartEditTool, this);
    } else {
      registerCoreTool(EditTool, this);
    }
    registerCoreTool(WriteFileTool, this);
    registerCoreTool(WebFetchTool, this);
    registerCoreTool(ReadManyFilesTool, this);
    registerCoreTool(ReadLineRangeTool, this);
    registerCoreTool(DeleteLineRangeTool, this);
    registerCoreTool(InsertAtLineTool, this);
    registerCoreTool(ShellTool, this);
    registerCoreTool(MemoryTool);
    registerCoreTool(WebSearchTool, this);
    registerCoreTool(TodoWrite);
    registerCoreTool(TodoRead);
    registerCoreTool(TodoPause);

    let profileManager = this.getProfileManager();
    if (!profileManager) {
      const profilesDir = path.join(os.homedir(), '.llxprt', 'profiles');
      profileManager = new ProfileManager(profilesDir);
      this.setProfileManager(profileManager);
    }

    let subagentManager = this.getSubagentManager();
    if (!subagentManager && profileManager) {
      const subagentsDir = path.join(os.homedir(), '.llxprt', 'subagents');
      subagentManager = new SubagentManager(subagentsDir, profileManager);
      this.setSubagentManager(subagentManager);
    }

    if (profileManager && subagentManager) {
      registerCoreTool(TaskTool, this, {
        profileManager,
        subagentManager,
        schedulerFactoryProvider: () =>
          this.getInteractiveSubagentSchedulerFactory(),
      });
    }

    registerCoreTool(ListSubagentsTool, this, {
      getSubagentManager: () => this.getSubagentManager(),
    });

    await registry.discoverAllTools();
    return registry;
  }
}
// Export model constants for use in CLI
export { DEFAULT_GEMINI_FLASH_MODEL };
