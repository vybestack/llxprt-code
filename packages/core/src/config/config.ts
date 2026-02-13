/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import {
  type ContentGeneratorConfig,
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
import { ShellTool } from '../tools/shell.js';
import { ASTEditTool } from '../tools/ast-edit.js';
import { ASTReadFileTool } from '../tools/ast-edit.js';
// @plan PLAN-20260211-ASTGREP.P05
import { AstGrepTool } from '../tools/ast-grep.js';
import { StructuralAnalysisTool } from '../tools/structural-analysis.js';
import { WriteFileTool } from '../tools/write-file.js';
import { GoogleWebFetchTool } from '../tools/google-web-fetch.js';
import { ReadManyFilesTool } from '../tools/read-many-files.js';
import { ReadLineRangeTool } from '../tools/read_line_range.js';
import { DeleteLineRangeTool } from '../tools/delete_line_range.js';
import { InsertAtLineTool } from '../tools/insert_at_line.js';
import {
  MemoryTool,
  setLlxprtMdFilename,
  LLXPRT_CONFIG_DIR as LLXPRT_DIR,
} from '../tools/memoryTool.js';
import { GoogleWebSearchTool } from '../tools/google-web-search.js';
import { ExaWebSearchTool } from '../tools/exa-web-search.js';
import { TodoWrite } from '../tools/todo-write.js';
import { TodoRead } from '../tools/todo-read.js';
import { TodoPause } from '../tools/todo-pause.js';
import { CodeSearchTool } from '../tools/codesearch.js';
import { DirectWebFetchTool } from '../tools/direct-web-fetch.js';

import { TaskTool } from '../tools/task.js';
import type { SubagentSchedulerFactory } from '../core/subagentScheduler.js';
import { ListSubagentsTool } from '../tools/list-subagents.js';
import { GeminiClient } from '../core/client.js';
import { createAgentRuntimeStateFromConfig } from '../runtime/runtimeStateFactory.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import type { HookDefinition, HookEventName } from '../hooks/types.js';
import { FileDiscoveryService } from '../services/fileDiscoveryService.js';
import { GitService } from '../services/gitService.js';
import { HistoryService } from '../services/history/HistoryService.js';
// @plan PLAN-20260130-ASYNCTASK.P09
import { AsyncTaskManager } from '../services/asyncTaskManager.js';
// @plan PLAN-20260130-ASYNCTASK.P22
import { AsyncTaskReminderService } from '../services/asyncTaskReminderService.js';
import { AsyncTaskAutoTrigger } from '../services/asyncTaskAutoTrigger.js';
// @plan PLAN-20260130-ASYNCTASK.P14
import { CheckAsyncTasksTool } from '../tools/check-async-tasks.js';
import { loadServerHierarchicalMemory } from '../utils/memoryDiscovery.js';
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
import {
  createProviderRuntimeContext,
  getActiveProviderRuntimeContext,
  peekActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';
import {
  type FileSystemService,
  StandardFileSystemService,
} from '../services/fileSystemService.js';
import { ProfileManager } from './profileManager.js';
import { SubagentManager } from './subagentManager.js';
import {
  getOrCreateScheduler as _getOrCreateScheduler,
  disposeScheduler as _disposeScheduler,
  type SchedulerCallbacks,
} from './schedulerSingleton.js';

// Re-export OAuth config type
export type { MCPOAuthConfig, AnyToolInvocation };
import type { AnyToolInvocation } from '../tools/tools.js';
import { WorkspaceContext } from '../utils/workspaceContext.js';
import { Storage } from './storage.js';
import { FileExclusions } from '../utils/ignorePatterns.js';
import type { EventEmitter } from 'node:events';
import { MessageBus } from '../confirmation-bus/message-bus.js';
import { PolicyEngine } from '../policy/policy-engine.js';
import type { PolicyEngineConfig } from '../policy/types.js';
import { setGlobalProxy } from '../utils/fetch.js';
import { coreEvents, CoreEvent } from '../utils/events.js';
import {
  type ExtensionLoader,
  SimpleExtensionLoader,
} from '../utils/extensionLoader.js';
import { McpClientManager } from '../tools/mcp-client-manager.js';

import type { ShellExecutionConfig } from '../services/shellExecutionService.js';

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
  /** @plan PLAN-20260211-COMPRESSION.P12 */
  strategy?: string;
  /** @plan PLAN-20260211-COMPRESSION.P12 */
  profile?: string;
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

/**
 * All information required in CLI to handle an extension. Defined in Core so
 * that the collection of loaded, active, and inactive extensions can be passed
 * around on the config object though Core does not use this information
 * directly.
 */
export interface GeminiCLIExtension {
  name: string;
  version: string;
  isActive: boolean;
  path: string;
  installMetadata?: ExtensionInstallMetadata;
  mcpServers?: Record<string, MCPServerConfig>;
  contextFiles: string[];
  excludeTools?: string[];
  hooks?: { [K in HookEventName]?: HookDefinition[] };
}

export interface ExtensionInstallMetadata {
  source: string;
  type: 'git' | 'local' | 'link' | 'github-release';
  releaseTag?: string; // Only present for github-release installs.
  ref?: string;
  autoUpdate?: boolean;
}

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

/** Shell replacement mode type */
export type ShellReplacementMode = 'allowlist' | 'all' | 'none';

/**
 * Normalize shell-replacement setting to canonical mode.
 * Handles legacy boolean values for backward compatibility.
 */
export function normalizeShellReplacement(
  value: ShellReplacementMode | boolean | undefined,
): ShellReplacementMode {
  if (value === undefined) {
    return 'allowlist'; // Default to upstream behavior
  }
  if (value === true || value === 'all') {
    return 'all';
  }
  if (value === false || value === 'none') {
    return 'none';
  }
  if (value === 'allowlist') {
    return 'allowlist';
  }
  // Fallback for any unexpected value
  return 'allowlist';
}

export const DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD = 4_000_000;
export const DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES = 1000;
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
    readonly extension?: GeminiCLIExtension,
    // OAuth configuration
    readonly oauth?: MCPOAuthConfig,
    readonly authProviderType?: AuthProviderType,
    // Service Account Configuration
    /* targetAudience format: CLIENT_ID.apps.googleusercontent.com */
    readonly targetAudience?: string,
    /* targetServiceAccount format: <service-account-name>@<project-num>.iam.gserviceaccount.com */
    readonly targetServiceAccount?: string,
  ) {}
}

export enum AuthProviderType {
  DYNAMIC_DISCOVERY = 'dynamic_discovery',
  GOOGLE_CREDENTIALS = 'google_credentials',
  SERVICE_ACCOUNT_IMPERSONATION = 'service_account_impersonation',
}

export interface SandboxConfig {
  command: 'docker' | 'podman' | 'sandbox-exec';
  image: string;
}

export interface ActiveExtension {
  name: string;
  version: string;
}

/**
 * Handler for bucket failover on rate limit/quota errors
 * @plan PLAN-20251213issue490
 */
export interface BucketFailoverHandler {
  /**
   * Get the list of available buckets
   */
  getBuckets(): string[];

  /**
   * Get the currently active bucket
   */
  getCurrentBucket(): string | undefined;

  /**
   * Try to failover to the next bucket
   * @returns true if successfully switched to a new bucket, false if no more buckets
   */
  tryFailover(): Promise<boolean>;

  /**
   * Check if bucket failover is enabled
   */
  isEnabled(): boolean;
}

export interface ConfigParameters {
  sessionId: string;
  embeddingModel?: string;
  sandbox?: SandboxConfig;
  targetDir: string;
  debugMode: boolean;
  outputFormat?: OutputFormat;
  question?: string;

  coreTools?: string[];
  allowedTools?: string[];
  excludeTools?: string[];
  toolDiscoveryCommand?: string;
  toolCallCommand?: string;
  mcpServerCommand?: string;
  mcpServers?: Record<string, MCPServerConfig>;
  userMemory?: string;
  coreMemory?: string;
  llxprtMdFileCount?: number;
  llxprtMdFilePaths?: string[];
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
  extensionLoader?: ExtensionLoader;
  enabledExtensions?: string[];
  enableExtensionReloading?: boolean;
  allowedMcpServers?: string[];
  blockedMcpServers?: Array<{ name: string; extensionName: string }>;
  noBrowser?: boolean;
  summarizeToolOutput?: Record<string, SummarizeToolOutputSettings>;
  folderTrust?: boolean;
  ideMode?: boolean;
  ideClient?: IdeClient;
  complexityAnalyzer?: ComplexityAnalyzerSettings;
  loadMemoryFromIncludeDirectories?: boolean;
  chatCompression?: ChatCompressionSettings;
  interactive?: boolean;
  shellReplacement?: 'allowlist' | 'all' | 'none' | boolean;
  trustedFolder?: boolean;
  useRipgrep?: boolean;
  shouldUseNodePtyShell?: boolean;
  allowPtyThemeOverride?: boolean;
  ptyScrollbackLimit?: number;
  ptyTerminalWidth?: number;
  ptyTerminalHeight?: number;
  skipNextSpeakerCheck?: boolean;
  extensionManagement?: boolean;
  enablePromptCompletion?: boolean;
  eventEmitter?: EventEmitter;
  settingsService?: SettingsService;
  policyEngineConfig?: PolicyEngineConfig;
  truncateToolOutputThreshold?: number;
  truncateToolOutputLines?: number;
  enableToolOutputTruncation?: boolean;
  continueOnFailedApiCall?: boolean;
  enableShellOutputEfficiency?: boolean;
  continueSession?: boolean;
  disableYoloMode?: boolean;
  enableMessageBusIntegration?: boolean;
  enableHooks?: boolean;
  hooks?: {
    [K in HookEventName]?: HookDefinition[];
  };
}

export class Config {
  private toolRegistry!: ToolRegistry;
  private mcpClientManager?: McpClientManager;
  private allowedMcpServers: string[];
  private blockedMcpServers: Array<{ name: string; extensionName: string }>;
  private promptRegistry!: PromptRegistry;
  private readonly sessionId: string;
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

  private readonly coreTools: string[] | undefined;
  private readonly allowedTools: string[] | undefined;
  private readonly excludeTools: string[] | undefined;
  private readonly toolDiscoveryCommand: string | undefined;
  private readonly toolCallCommand: string | undefined;
  private readonly mcpServerCommand: string | undefined;
  private mcpServers: Record<string, MCPServerConfig> | undefined;
  private userMemory: string;
  private coreMemory: string;
  private llxprtMdFileCount: number;
  private llxprtMdFilePaths: string[];
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
  private readonly messageBus: MessageBus;
  private readonly policyEngine: PolicyEngine;
  truncateToolOutputThreshold: number;
  truncateToolOutputLines: number;
  enableToolOutputTruncation: boolean;
  private readonly continueOnFailedApiCall: boolean;
  private readonly enableShellOutputEfficiency: boolean;
  private readonly continueSession: boolean;
  private readonly disableYoloMode: boolean;
  private readonly enableHooks: boolean;
  private readonly hooks:
    | { [K in HookEventName]?: HookDefinition[] }
    | undefined;
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
    this.userMemory = params.userMemory ?? '';
    this.coreMemory = params.coreMemory ?? '';
    this.llxprtMdFileCount = params.llxprtMdFileCount ?? 0;
    this.llxprtMdFilePaths = params.llxprtMdFilePaths ?? [];
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

    // Initialize policy engine and message bus
    this.policyEngine = new PolicyEngine(params.policyEngineConfig);
    this.messageBus = new MessageBus(this.policyEngine, this.debugMode);

    this.runtimeState = createAgentRuntimeStateFromConfig(this);
    this.disableYoloMode = params.disableYoloMode ?? false;
    this.enableHooks = params.enableHooks ?? false;

    // Enable MessageBus integration if:
    // 1. Explicitly enabled via setting, OR
    // 2. Hooks are enabled and hooks are configured
    const hasHooks = params.hooks && Object.keys(params.hooks).length > 0;
    const hooksNeedMessageBus = this.enableHooks && hasHooks;
    const messageBusEnabled =
      params.enableMessageBusIntegration ??
      (hooksNeedMessageBus ? true : false);
    // Update messageBus initialization to consider hooks
    if (messageBusEnabled && !this.messageBus) {
      // MessageBus is already initialized in constructor, just log that hooks may use it
      const debugLogger = new DebugLogger('llxprt:config');
      debugLogger.debug(
        () =>
          `MessageBus enabled for hooks (enableHooks=${this.enableHooks}, hasHooks=${hasHooks})`,
      );
    }
    this.hooks = params.hooks;

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
    this.mcpClientManager = new McpClientManager(
      this.toolRegistry,
      this,
      this.eventEmitter,
    );
    await Promise.all([
      this.mcpClientManager.startConfiguredMcpServers(),
      this.getExtensionLoader().start(this),
    ]);

    // Create GeminiClient instance immediately without authentication
    // This ensures geminiClient is available for providers on startup
    this.geminiClient = new GeminiClient(this, this.runtimeState);

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
    return this.sessionId;
  }

  isContinueSession(): boolean {
    return this.continueSession;
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
    return this.userMemory;
  }

  setUserMemory(newUserMemory: string): void {
    this.userMemory = newUserMemory;
  }

  getCoreMemory(): string {
    return this.coreMemory;
  }

  setCoreMemory(newCoreMemory: string): void {
    this.coreMemory = newCoreMemory;
  }

  async updateSystemInstructionIfInitialized(): Promise<void> {
    const geminiClient = this.geminiClient;
    if (geminiClient?.isInitialized()) {
      await geminiClient.updateSystemInstruction();
    }
  }

  getLlxprtMdFileCount(): number {
    return this.llxprtMdFileCount;
  }

  setLlxprtMdFileCount(count: number): void {
    this.llxprtMdFileCount = count;
  }

  getLlxprtMdFilePaths(): string[] {
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

  getMessageBus(): MessageBus {
    return this.messageBus;
  }

  getPolicyEngine(): PolicyEngine {
    return this.policyEngine;
  }

  isYoloModeDisabled(): boolean {
    return this.disableYoloMode || !this.isTrustedFolder();
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
    if (key === 'context-limit') {
      const normalized = this.normalizeContextLimit(rawValue);
      if (normalized !== undefined) {
        if (normalized !== rawValue) {
          this.settingsService.set(key, normalized);
        }
        return normalized;
      }
      return undefined;
    }
    return rawValue;
  }

  private normalizeContextLimit(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') {
        return undefined;
      }
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
    }
    return undefined;
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
    return {
      terminalWidth: this.getPtyTerminalWidth(),
      terminalHeight: this.getPtyTerminalHeight(),
      showColor: this.getAllowPtyThemeOverride(),
      scrollback: this.getPtyScrollbackLimit(),
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

  async refreshMemory(): Promise<{
    memoryContent: string;
    fileCount: number;
    filePaths: string[];
  }> {
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
      memoryContent,
      fileCount,
      filePaths,
    });

    return { memoryContent, fileCount, filePaths };
  }

  async createToolRegistry(): Promise<ToolRegistry> {
    const registry = new ToolRegistry(this);

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

      const isExcluded = excludeTools.some(
        (tool) => tool === className || tool === toolName,
      );

      if (isExcluded) {
        isEnabled = false;
        reason = 'excluded by excludeTools setting';
      }

      // Record tool attempt for settings UI
      const toolRecord = {
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

      this.allPotentialTools.push(toolRecord);
    };

    registerCoreTool(LSTool, this);
    registerCoreTool(ReadFileTool, this);

    if (this.getUseRipgrep()) {
      registerCoreTool(RipGrepTool, this);
    } else {
      registerCoreTool(GrepTool, this);
    }

    registerCoreTool(GlobTool, this);
    registerCoreTool(EditTool, this);
    registerCoreTool(ASTEditTool, this);
    registerCoreTool(WriteFileTool, this);
    registerCoreTool(GoogleWebFetchTool, this);
    registerCoreTool(ReadManyFilesTool, this);
    registerCoreTool(ReadLineRangeTool, this);
    registerCoreTool(ASTReadFileTool, this);
    // @plan PLAN-20260211-ASTGREP.P05
    registerCoreTool(AstGrepTool, this);
    registerCoreTool(StructuralAnalysisTool, this);
    registerCoreTool(DeleteLineRangeTool, this);
    registerCoreTool(InsertAtLineTool, this);
    registerCoreTool(ShellTool, this);
    registerCoreTool(MemoryTool, this);
    registerCoreTool(GoogleWebSearchTool, this);
    registerCoreTool(ExaWebSearchTool, this);
    registerCoreTool(TodoWrite);
    registerCoreTool(TodoRead);
    registerCoreTool(TodoPause);
    registerCoreTool(CodeSearchTool, this);
    registerCoreTool(DirectWebFetchTool, this);

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

    // Handle TaskTool with dependency checking
    const taskToolArgs = {
      profileManager,
      subagentManager,
      schedulerFactoryProvider: () =>
        this.getInteractiveSubagentSchedulerFactory(),
      getAsyncTaskManager: () => this.getAsyncTaskManager(),
    };

    if (profileManager && subagentManager) {
      registerCoreTool(TaskTool, this, taskToolArgs);
    } else {
      // Record TaskTool as unregistered due to missing dependencies
      const taskToolRecord = {
        toolClass: TaskTool,
        toolName: 'TaskTool',
        displayName: TaskTool.Name || 'TaskTool',
        isRegistered: false,
        reason:
          !profileManager && !subagentManager
            ? 'requires profile manager and subagent manager'
            : !profileManager
              ? 'requires profile manager'
              : 'requires subagent manager',
        args: [this, taskToolArgs],
      };
      this.allPotentialTools.push(taskToolRecord);
    }

    // Handle ListSubagentsTool with dependency checking
    const listSubagentsArgs = {
      getSubagentManager: () => this.getSubagentManager(),
    };

    if (subagentManager) {
      registerCoreTool(ListSubagentsTool, this, listSubagentsArgs);
    } else {
      // Record ListSubagentsTool as unregistered due to missing subagent manager
      const listSubagentsRecord = {
        toolClass: ListSubagentsTool,
        toolName: 'ListSubagentsTool',
        displayName: ListSubagentsTool.Name || 'ListSubagentsTool',
        isRegistered: false,
        reason: 'requires subagent manager',
        args: [this, listSubagentsArgs],
      };
      this.allPotentialTools.push(listSubagentsRecord);
    }

    // @plan PLAN-20260130-ASYNCTASK.P14
    // Register CheckAsyncTasksTool
    const checkAsyncTasksArgs = {
      getAsyncTaskManager: () => this.getAsyncTaskManager(),
    };
    registerCoreTool(CheckAsyncTasksTool, checkAsyncTasksArgs);

    await registry.discoverAllTools();
    registry.sortTools();
    return registry;
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

  async getOrCreateScheduler(
    sessionId: string,
    callbacks: SchedulerCallbacks,
  ): Promise<import('../core/coreToolScheduler.js').CoreToolScheduler> {
    return _getOrCreateScheduler(this, sessionId, callbacks);
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
   * Check if interactive shell is enabled.
   * Returns true if the shouldUseNodePtyShell setting is enabled.
   */
  getEnableInteractiveShell(): boolean {
    return this.shouldUseNodePtyShell;
  }
}

// Re-export SchedulerCallbacks for external use
export { type SchedulerCallbacks };

// Export model constants for use in CLI
export { DEFAULT_GEMINI_FLASH_MODEL };
