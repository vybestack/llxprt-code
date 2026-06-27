/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import process from 'node:process';
import path from 'node:path';
import { PromptRegistry } from '../prompts/prompt-registry.js';
import { ResourceRegistry } from '../resources/resource-registry.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { ActivateSkillTool } from '@vybestack/llxprt-code-tools';
import { Storage } from '@vybestack/llxprt-code-settings';
import { CoreSkillServiceAdapter } from '../tools-adapters/CoreSkillServiceAdapter.js';
import { DebugLogger } from '../debug/DebugLogger.js';

import type { AgentClientContract } from '../core/clientContract.js';
import { HookSystem } from '../hooks/hookSystem.js';
import { ContextManager } from '../services/contextManager.js';
import type { AsyncTaskManager } from '../services/asyncTaskManager.js';
import type { AsyncTaskReminderService } from '../services/asyncTaskReminderService.js';
import {
  loadServerHierarchicalMemory,
  loadJitSubdirectoryMemory,
} from '../utils/memoryDiscovery.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from './models.js';
import { IdeClient } from '@vybestack/llxprt-code-ide-integration';
import { ideContext } from '@vybestack/llxprt-code-ide-integration';
import {
  getOrCreateScheduler as _getOrCreateScheduler,
  type SchedulerCallbacks,
  type SchedulerOptions,
} from './schedulerSingleton.js';
import { initializeLsp } from './lspIntegration.js';
import {
  applyConfigParams,
  type ConfigConstructorTarget,
} from './configConstructor.js';
import { ConfigBase } from './configBase.js';
import {
  buildNewContentGeneratorConfig,
  disposePreviousAgentClient,
  extractExistingState,
  requireAgentClientFactory,
  transferHistoryToNewClient,
} from './agentClientLifecycle.js';
import {
  getOrCreateAsyncTaskManager,
  getOrCreateAsyncTaskReminderService,
  setupAsyncTaskAutoTrigger,
} from './asyncTaskServices.js';
import { parseSettingsSubagentDefinitions } from './subagentSettingsParser.js';

import {
  type ConfigParameters,
  type RedactionConfig,
  ApprovalMode,
  type TelemetrySettings,
} from './configTypes.js';

// Re-export all types for backward compatibility
export {
  type ConfigParameters,
  type RedactionConfig,
  ApprovalMode,
  type AccessibilitySettings,
  type BugCommandSettings,
  type ChatCompressionSettings,
  type SummarizeToolOutputSettings,
  type ComplexityAnalyzerSettings,
  type OutputSettings,
  type IntrospectionAgentSettings,
  type TelemetrySettings,
  type GeminiCLIExtension,
  type ExtensionInstallMetadata,
  type ShellReplacementMode,
  normalizeShellReplacement,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
  MCPServerConfig,
  AuthProviderType,
  type SandboxConfig,
  type ActiveExtension,
  type FailoverContext,
  type BucketFailoverHandler,
  type OnAuthErrorHandler,
  type MCPOAuthConfig,
  type AnyToolInvocation,
  type SkillDefinition,
  type FileFilteringOptions,
} from './configTypes.js';
// Re-export constants for backward compatibility
export {
  DEFAULT_FILE_FILTERING_OPTIONS,
  DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
  DEFAULT_AUTOCOMPLETE_IGNORE_DIRS,
  DEFAULT_AUTOCOMPLETE_IGNORE_PATTERNS,
  DEFAULT_AUTOCOMPLETE_MAX_DEPTH,
} from './constants.js';

import type { MessageBus } from '../confirmation-bus/message-bus.js';

import { coreEvents, CoreEvent } from '../utils/events.js';
import { McpClientManager } from '@vybestack/llxprt-code-mcp';
import { getCoreVersion } from '../utils/version.js';

import type { ShellExecutionConfig } from '../services/shellExecutionService.js';
import type { ToolSchedulerContract } from '../core/toolSchedulerContract.js';

export class Config extends ConfigBase {
  constructor(params: ConfigParameters) {
    super();
    applyConfigParams(this as unknown as ConfigConstructorTarget, params);
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
      await getCoreVersion(),
      this.toolRegistry,
      this,
      this.eventEmitter,
    );
    await Promise.all([
      this.mcpClientManager.startConfiguredMcpServers(),
      this.getExtensionLoader().start(this),
    ]);

    await initializeLsp(this._lspState, this);

    // Discover skills if enabled
    if (this.skillsSupport) {
      await this.getSkillManager().discoverSkills(
        this.storage,
        this.getExtensions(),
      );
      this.getSkillManager().setDisabledSkills(this.disabledSkills);

      // Re-register ActivateSkillTool to update its schema with the discovered enabled skill enums
      if (this.getSkillManager().getSkills().length > 0) {
        this.getToolRegistry().unregisterTool(ActivateSkillTool.Name);
        this.getToolRegistry().registerTool(
          new ActivateSkillTool(
            new CoreSkillServiceAdapter(this),
            initializationMessageBus,
          ),
        );
      }
    }

    // Register subagents (after skill discovery, before AgentClient creation)
    this.registerSubagents();

    // Create AgentClient instance immediately without authentication
    // This ensures agentClient is available for providers on startup
    // @plan PLAN-20260610-ISSUE1592.P01
    // @requirement REQ-INV-001
    const clientFactory = requireAgentClientFactory(
      this.agentClientFactory,
      'initialize',
    );
    this.agentClient = clientFactory(this, this.runtimeState);

    if (this.getJitContextEnabled()) {
      this.contextManager = new ContextManager(this);
      await this.contextManager.refresh();
    }

    // Reserved for future model switching tracking
    void this._modelSwitchedDuringSession;
  }

  private getAgentClientIfReady(): AgentClientContract | undefined {
    const client = this.agentClient as AgentClientContract | undefined;
    if (client === undefined) {
      return undefined;
    }
    if (!client.isInitialized()) {
      return undefined;
    }
    return client;
  }

  private registerSubagents(): void {
    const subagentMgr = this.getSubagentManager();
    if (!subagentMgr) {
      return;
    }
    // Register extension-contributed subagents
    subagentMgr.clearExtensionSubagents();
    for (const extension of this.getExtensions()) {
      if (
        extension.isActive &&
        extension.subagents !== undefined &&
        extension.subagents.length > 0
      ) {
        subagentMgr.registerExtensionSubagents(
          extension.name,
          extension.subagents,
        );
      }
    }
    // Register settings-defined subagents
    const allSettings = this.settingsService.getAllGlobalSettings();
    const definitions = parseSettingsSubagentDefinitions(allSettings);
    if (definitions) {
      subagentMgr.clearSettingsSubagents();
      subagentMgr.registerSettingsSubagents(definitions);
    }
  }

  initializeContentGeneratorConfig: () => Promise<void> = async () => {
    const logger = new DebugLogger(
      'llxprt:config:initializeContentGeneratorConfig',
    );
    const previousAgentClient = this.agentClient;
    const { history: existingHistory, historyService: existingHistoryService } =
      await extractExistingState(logger, this.agentClient);

    const {
      contentGeneratorConfig: newContentGeneratorConfig,
      runtimeState: newRuntimeState,
    } = buildNewContentGeneratorConfig(
      this,
      this.providerManager,
      this.contentGeneratorFactory,
      this.runtimeState,
    );
    this.runtimeState = newRuntimeState;
    // @plan PLAN-20260610-ISSUE1592.P01
    // @requirement REQ-INV-001
    const clientFactory = requireAgentClientFactory(
      this.agentClientFactory,
      'initializeContentGeneratorConfig',
    );
    const newAgentClient = clientFactory(this, this.runtimeState);

    transferHistoryToNewClient(
      logger,
      newAgentClient,
      existingHistory,
      existingHistoryService,
      newContentGeneratorConfig,
      this.getContentGeneratorConfig()?.vertexai,
    );

    await newAgentClient.initialize(newContentGeneratorConfig);
    logger.debug('New client initialized');

    this.contentGeneratorConfig = newContentGeneratorConfig;
    disposePreviousAgentClient(logger, previousAgentClient);
    this.agentClient = newAgentClient;

    const newHistory = await this.agentClient.getHistory();
    const newHistoryService = this.agentClient.getHistoryService();
    if (newHistoryService && this.tokenizerFactory) {
      newHistoryService.setTokenizerFactory(this.tokenizerFactory);
    }

    logger.debug('State verification after refreshAuth', {
      originalHistoryLength: existingHistory.length,
      newHistoryLength: newHistory.length,
      historyPreserved: newHistory.length > 0,
      historyServicePreserved: existingHistoryService === newHistoryService,
    });
    this.inFallbackMode = false;
  };

  getModel(): string {
    // Delegate to SettingsService as source of truth
    const settingsService = this.getSettingsService();
    const activeProvider = settingsService.get('activeProvider') as string;
    // Preserve old truthiness semantics: call getProviderSettings when
    // activeProvider is truthy/non-empty.
    if (typeof activeProvider === 'string' && activeProvider.length > 0) {
      const providerSettings =
        settingsService.getProviderSettings(activeProvider);
      // Restore old truthiness semantics: falsy model should not be returned.
      // Only return truthy string models.
      if (
        typeof providerSettings.model === 'string' &&
        providerSettings.model.length > 0
      ) {
        return providerSettings.model;
      }
    }
    // Fallback to legacy
    const legacyModel = this.getContentGeneratorConfig()?.model;
    return legacyModel && legacyModel.length > 0 ? legacyModel : this.model;
  }

  setModel(newModel: string): void {
    // Update SettingsService as source of truth
    const settingsService = this.getSettingsService();
    const activeProvider = settingsService.get('activeProvider') as string;
    if (typeof activeProvider === 'string' && activeProvider.length > 0) {
      settingsService.setProviderSetting(activeProvider, 'model', newModel);
    }
    // Keep legacy updates for backward compatibility
    const contentConfig = this.getContentGeneratorConfig();
    if (contentConfig) {
      contentConfig.model = newModel;
    }
    // Also update the base model so it persists across refreshAuth
    if (this.model !== newModel || this.inFallbackMode) {
      this.model = newModel;
      coreEvents.emitModelChanged(newModel);
    }
    this.setFallbackMode(false);
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

  /**
   * Refreshes the MCP context, including memory, tools, and system instructions.
   * Preserved from gmerge branch for compatibility with McpClientManager.
   */
  async refreshMcpContext(): Promise<void> {
    await this.refreshMemory();
    const client = this.getAgentClientIfReady();
    if (client) {
      await client.setTools();
      await client.updateSystemInstruction();
    }
  }

  async reloadSkills(): Promise<void> {
    if (this._onReload) {
      const result = await this._onReload();
      if (result.disabledSkills) {
        this.disabledSkills = result.disabledSkills;
      }
      if (result.adminSkillsEnabled !== undefined) {
        this.adminSkillsEnabled = result.adminSkillsEnabled;
        this.skillManager.setAdminSettings(this.adminSkillsEnabled);
      }
    }
    await this.skillManager.discoverSkills(this.storage, this.getExtensions());
    this.skillManager.setDisabledSkills(this.disabledSkills);
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
      for (const tool of extension.excludeTools ?? []) {
        excludeToolsSet.add(tool);
      }
    }
    return [...excludeToolsSet];
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

  setApprovalMode(mode: ApprovalMode): void {
    if (!this.isTrustedFolder() && mode !== ApprovalMode.DEFAULT) {
      throw new Error(
        'Cannot enable privileged approval modes in an untrusted folder.',
      );
    }

    this.approvalMode = mode;
  }

  updateSystemInstructionIfInitialized(): void | Promise<void> {}

  getContinueSessionRef(): string | null {
    if (typeof this.continueSession === 'string') {
      return this.continueSession;
    }
    return this.continueSession ? '__CONTINUE_LATEST__' : null;
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
    return path.join(Storage.getGlobalDataDir(), 'conversations');
  }

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

  private expandPath(filePath: string): string {
    if (filePath.startsWith('~/')) {
      return filePath.replace('~', process.env.HOME ?? '');
    }
    return filePath;
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
        if (!trimmed) return null;
        return `--- JIT Context from: ${f.path} ---\n${trimmed}\n--- End of JIT Context from: ${f.path} ---`;
      })
      .filter((block): block is string => block !== null)
      .join('\n\n');
  }

  /**
   * Get the AsyncTaskManager instance
   * @plan PLAN-20260130-ASYNCTASK.P09
   */
  getAsyncTaskManager(): AsyncTaskManager | undefined {
    return getOrCreateAsyncTaskManager(
      this.getSettingsService(),
      () => this.asyncTaskManager,
      (manager) => {
        this.asyncTaskManager = manager;
      },
    );
  }

  /**
   * Get the AsyncTaskReminderService instance
   * @plan PLAN-20260130-ASYNCTASK.P22
   */
  getAsyncTaskReminderService(): AsyncTaskReminderService | undefined {
    return getOrCreateAsyncTaskReminderService(
      this.getSettingsService(),
      () => this.asyncTaskManager,
      (manager) => {
        this.asyncTaskManager = manager;
      },
      () => this.asyncTaskReminderService,
      (service) => {
        this.asyncTaskReminderService = service;
      },
    );
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
    return setupAsyncTaskAutoTrigger(
      this.getSettingsService(),
      {
        getManager: () => this.asyncTaskManager,
        setManager: (manager) => {
          this.asyncTaskManager = manager;
        },
        getReminder: () => this.asyncTaskReminderService,
        setReminder: (service) => {
          this.asyncTaskReminderService = service;
        },
        getAutoTrigger: () => this.asyncTaskAutoTrigger,
        setAutoTrigger: (trigger) => {
          this.asyncTaskAutoTrigger = trigger;
        },
      },
      isAgentBusy,
      triggerAgentTurn,
    );
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
  ): Promise<ToolSchedulerContract> {
    const schedulerMessageBus = dependencies?.messageBus;
    if (!schedulerMessageBus) {
      throw new Error(
        'Config.getOrCreateScheduler requires an explicit session/runtime MessageBus dependency.',
      );
    }
    return _getOrCreateScheduler(this, sessionId, callbacks, options, {
      messageBus: schedulerMessageBus,
      toolRegistry: dependencies.toolRegistry ?? this.getToolRegistry(),
    });
  }

  /**
   * Get disabled hooks list
   */
  getDisabledHooks(): string[] {
    if (this.disabledHooks.length === 0) {
      const persisted = this.settingsService.get('hooksConfig.disabled') as
        | string[]
        | undefined;
      if (persisted && persisted.length > 0) {
        this.disabledHooks = persisted;
      }
    }
    return this.disabledHooks;
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
    this.hookSystem ??= new HookSystem(this);

    return this.hookSystem;
  }

  async dispose(): Promise<void> {
    const client = this.agentClient as AgentClientContract | undefined;
    if (client !== undefined) {
      client.dispose();
    }
    if (this.mcpClientManager !== undefined) {
      await this.mcpClientManager.stop();
    }
  }
}
// Re-export scheduler types for external use
export { type SchedulerCallbacks, type SchedulerOptions };
// Export model constants for use in CLI
export { DEFAULT_GEMINI_FLASH_MODEL };
