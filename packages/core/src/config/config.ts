/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import process from 'node:process';
import { createContentGeneratorConfig } from '../core/contentGenerator.js';
import { PromptRegistry } from '../prompts/prompt-registry.js';
import { ResourceRegistry } from '../resources/resource-registry.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import { ActivateSkillTool } from '../tools/activate-skill.js';
import { DebugLogger } from '../debug/DebugLogger.js';

import { GeminiClient } from '../core/client.js';
import { createAgentRuntimeStateFromConfig } from '../runtime/runtimeStateFactory.js';
import { HookSystem } from '../hooks/hookSystem.js';
import type { HistoryService } from '../services/history/HistoryService.js';
import { ContextManager } from '../services/contextManager.js';
// @plan PLAN-20260130-ASYNCTASK.P09
import { AsyncTaskManager } from '../services/asyncTaskManager.js';
// @plan PLAN-20260130-ASYNCTASK.P22
import { AsyncTaskReminderService } from '../services/asyncTaskReminderService.js';
import { AsyncTaskAutoTrigger } from '../services/asyncTaskAutoTrigger.js';
import {
  loadServerHierarchicalMemory,
  loadJitSubdirectoryMemory,
} from '../utils/memoryDiscovery.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from './models.js';
import { IdeClient } from '../ide/ide-client.js';
import { ideContext } from '../ide/ideContext.js';
import type { Content } from '@google/genai';
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
  type CodebaseInvestigatorSettings,
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
  type MCPOAuthConfig,
  type AnyToolInvocation,
  type SkillDefinition,
  type FileFilteringOptions,
} from './configTypes.js';
// Re-export constants for backward compatibility
export {
  DEFAULT_FILE_FILTERING_OPTIONS,
  DEFAULT_MEMORY_FILE_FILTERING_OPTIONS,
} from './constants.js';

import type { MessageBus } from '../confirmation-bus/message-bus.js';

import { coreEvents, CoreEvent } from '../utils/events.js';
import { McpClientManager } from '../tools/mcp-client-manager.js';

import type { ShellExecutionConfig } from '../services/shellExecutionService.js';

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
          new ActivateSkillTool(this, initializationMessageBus),
        );
      }
    }

    // Register extension-contributed subagents (after skill discovery, before GeminiClient creation)
    const subagentMgr = this.getSubagentManager();
    if (subagentMgr) {
      subagentMgr.clearExtensionSubagents();
      for (const extension of this.getExtensions()) {
        if (extension.isActive && extension.subagents?.length) {
          subagentMgr.registerExtensionSubagents(
            extension.name,
            extension.subagents,
          );
        }
      }
    }

    // Register settings-defined subagents (after extension subagents, before GeminiClient creation)
    if (subagentMgr) {
      const allSettings = this.settingsService.getAllGlobalSettings();
      const subagentsSettings = allSettings?.['subagents'] as
        | Record<string, unknown>
        | undefined;
      const definitions = subagentsSettings?.['definitions'] as
        | Record<string, { profile: string; systemPrompt: string }>
        | undefined;
      if (definitions && typeof definitions === 'object') {
        subagentMgr.clearSettingsSubagents();
        subagentMgr.registerSettingsSubagents(definitions);
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
      for (const tool of extension.excludeTools || []) {
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
    return this.expandPath('~/.llxprt/conversations/');
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
      return filePath.replace('~', process.env.HOME || '');
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
      return undefined;
    }

    // @requirement:HOOK-001 - Lazy creation on first access
    if (!this.hookSystem) {
      this.hookSystem = new HookSystem(this);
    }

    return this.hookSystem;
  }

  async dispose(): Promise<void> {
    this.geminiClient?.dispose();
    if (this.mcpClientManager) {
      await this.mcpClientManager.stop();
    }
  }
}
// Re-export scheduler types for external use
export { type SchedulerCallbacks, type SchedulerOptions };
// Export model constants for use in CLI
export { DEFAULT_GEMINI_FLASH_MODEL };
