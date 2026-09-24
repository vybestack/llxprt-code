/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import process from 'node:process';
import path from 'node:path';
import { PromptRegistry } from '../prompts/prompt-registry.js';
import { ResourceRegistry } from '../resources/resource-registry.js';
import { Storage } from '@vybestack/llxprt-code-settings';
import { DebugLogger } from '../debug/DebugLogger.js';
import { getErrorMessage } from '../utils/errors.js';
import { initializeParser } from '../utils/shell-parser.js';
import { unloadActiveExtensions } from '../utils/extensionLoader.js';

import type { AgentClientContract } from '../core/clientContract.js';
import { HookSystem } from '../hooks/hookSystem.js';
import { ContextManager } from '../services/contextManager.js';
import type { AsyncTaskManager } from '../services/asyncTaskManager.js';
import type { ShellJobPort } from '../session/sessionExecutionServices.js';
import {
  loadServerHierarchicalMemory,
  loadJitSubdirectoryMemory,
} from '../utils/memoryDiscovery.js';
import { IdeClient } from '@vybestack/llxprt-code-ide-integration';
import { ideContext } from '@vybestack/llxprt-code-ide-integration';
import { initializeLsp } from './lspIntegration.js';
import * as configConstructor from './configConstructor.js';
import { ConfigBase } from './configBase.js';
import {
  buildNewContentGeneratorConfig,
  createDetachedAgentClient,
  extractExistingState,
  prepareAgentClientReplacement,
  requireAgentClientFactory,
} from './agentClientLifecycle.js';
import { syncActivateMcpServerTool } from './mcp-lazy-tool-sync.js';
import { syncSkillActivationTool } from './skill-tool-sync.js';
import { LiveTrustTransitionLifecycle } from './liveTrustTransitionLifecycle.js';
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
  type LlxprtExtension,
  type ExtensionInstallMetadata,
  type ShellReplacementMode,
  normalizeShellReplacement,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD,
  DEFAULT_TRUNCATE_TOOL_OUTPUT_LINES,
  type MCPServerConfig,
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
import type { McpHostConfig } from '@vybestack/llxprt-code-mcp/host/hostInterfaces.js';
import { getCoreVersion } from '../utils/version.js';
import {
  buildMcpTrustedRules,
  MCP_TRUSTED_POLICY_SOURCE,
} from '../policy/config.js';

import type { ShellExecutionConfig } from '../services/shellExecutionService.js';

function createMcpHostConfig(config: Config): McpHostConfig {
  return {
    refreshMcpContext: () => config.refreshDiscoveredMcpMetadata(),
    getAllowedMcpServers: () => config.getAllowedMcpServers(),
    getBlockedMcpServers: () => config.getBlockedMcpServers(),
    getMcpServers: () => config.getMcpServers(),
    getMcpServerCommand: () => config.getMcpServerCommand(),
    getPromptRegistry: () => config.getPromptRegistry(),
    getResourceRegistry: () => config.getResourceRegistry(),
    getWorkspaceContext: () => config.getWorkspaceContext(),
    getDebugMode: () => config.getDebugMode(),
    getExtensions: () => config.getExtensions(),
    isTrustedFolder: () => config.isTrustedFolder(),
  };
}

function requireMessageBus(
  messageBus: MessageBus | undefined,
  operation: string,
): asserts messageBus is MessageBus {
  if (messageBus === undefined) {
    throw new Error(
      `${operation} requires an explicit session/runtime MessageBus dependency.`,
    );
  }
}

export class Config extends ConfigBase {
  private static readonly logger = new DebugLogger('llxprt:config');

  private readonly liveTrustTransitionLifecycle: LiveTrustTransitionLifecycle;

  constructor(params: ConfigParameters) {
    super();
    configConstructor.applyConfigParams(
      this as unknown as configConstructor.ConfigConstructorTarget,
      params,
    );
    this.syncModeDerivedPolicyRules(this.approvalMode);
    this.cachedEffectiveTrust = this.isTrustedFolder();
    this.liveTrustTransitionLifecycle = new LiveTrustTransitionLifecycle({
      downgradeApprovalMode: () => {
        if (this.approvalMode !== ApprovalMode.DEFAULT) {
          this.approvalMode = ApprovalMode.DEFAULT;
        }
      },
      removeTrustedPolicyRules: () =>
        this.policyEngine.removeRulesBySource(MCP_TRUSTED_POLICY_SOURCE),
      updateTrustPolicy: (trusted) => {
        if (trusted) {
          for (const rule of buildMcpTrustedRules({
            mcpServers: this.getMcpServers(),
          })) {
            this.policyEngine.addRule(rule);
          }
        } else {
          this.mcpClientManager?.quarantineForTrustRevocation();
        }
      },
      transitionMcp: (trusted) =>
        trusted
          ? this.mcpClientManager?.onFolderTrustGained()
          : this.mcpClientManager?.onFolderTrustRevoked(),
      initializeHooks: (signal) => this.getHookSystem()?.initialize(signal),
      emitTrustChanged: (trusted) => coreEvents.emitFolderTrustChanged(trusted),
    });
  }

  // Issue #2325: Background MCP discovery promise started in initialize() so
  // startup is not blocked. Awaited in dispose() to avoid tearing down servers
  // mid-discovery.
  private mcpDiscoveryPromise: Promise<void> | undefined;
  private readonly skillSurfaceSubscribers = new Set<() => Promise<void>>();
  private readonly mcpSurfaceSubscribers = new Set<() => Promise<void>>();

  private initializationPromise: Promise<void> | undefined;

  /** Must only be called once; use ensureInitialized for idempotent adoption. */
  initialize(dependencies?: {
    messageBus?: MessageBus;
    taskManager?: AsyncTaskManager;
    shellJobs?: ShellJobPort;
  }): Promise<void> {
    if (this.initializationPromise !== undefined) {
      throw Error('Config was already initialized');
    }
    this.initializationPromise = this.performInitialization(dependencies);
    // Return the exact stored promise so callers (ensureInitialized) that
    // observe this.initializationPromise see the SAME object identity. A
    // plain `return` (not async) preserves referential identity.
    return this.initializationPromise;
  }

  /**
   * Initializes once and shares the original result with adopting callers.
   * A failed initialization remains failed rather than exposing partial state.
   */
  ensureInitialized(
    dependencies?:
      | {
          messageBus?: MessageBus;
          taskManager?: AsyncTaskManager;
          shellJobs?: ShellJobPort;
        }
      | (() => {
          messageBus: MessageBus;
          taskManager?: AsyncTaskManager;
          shellJobs?: ShellJobPort;
        }),
  ): Promise<void> {
    if (this.initializationPromise === undefined) {
      const resolvedDependencies =
        typeof dependencies === 'function' ? dependencies() : dependencies;
      this.initializationPromise =
        this.performInitialization(resolvedDependencies);
    }
    return this.initializationPromise;
  }

  private async performInitialization(dependencies?: {
    messageBus?: MessageBus;
    taskManager?: AsyncTaskManager;
    shellJobs?: ShellJobPort;
  }): Promise<void> {
    const initializationMessageBus = dependencies?.messageBus;
    if (!initializationMessageBus) {
      throw new Error(
        'Config.initialize requires an explicit session/runtime MessageBus dependency.',
      );
    }
    const clientFactory = requireAgentClientFactory(
      this.agentClientFactory,
      'initialize',
    );
    this.cachedEffectiveTrust = this.isTrustedFolder();
    this.ideClient = await IdeClient.getInstance();
    // Initialize centralized FileDiscoveryService
    this.getFileService();
    if (this.getCheckpointingEnabled()) {
      await this.getGitService();
    }
    this.promptRegistry = new PromptRegistry();
    this.resourceRegistry = new ResourceRegistry();
    await initializeParser();
    const taskManager = dependencies.taskManager;
    const shellJobs = dependencies.shellJobs;
    this.toolRegistry = await this.createToolRegistry(
      initializationMessageBus,
      () => taskManager,
      () => shellJobs,
    );
    this.mcpClientManager = new McpClientManager(
      await getCoreVersion(),
      this.toolRegistry,
      createMcpHostConfig(this),
      this.eventEmitter,
    );
    this.registerIdeTrustListener();
    this.initialized = true;
    // Issue #2325: Fire MCP discovery in the background — don't block startup.
    // Tools are gated before model turns via McpClientManager.whenDiscoverySettled().
    this.mcpDiscoveryPromise =
      this.mcpClientManager.startConfiguredMcpServers();
    await this.getExtensionLoader().start(this, () =>
      this.refreshExtensionSkills(),
    );

    await initializeLsp(this._lspState, this);

    // Discover skills if enabled
    if (this.skillsSupport) {
      await this.getSkillManager().discoverSkills(
        this.storage,
        this.getExtensions(),
      );
      this.getSkillManager().setDisabledSkills(this.disabledSkills);
      syncSkillActivationTool(this, initializationMessageBus);
    }

    // Register subagents (after skill discovery, before AgentClient creation)
    this.registerSubagents();

    // Create AgentClient instance immediately without authentication
    // This ensures agentClient is available for providers on startup
    // @plan PLAN-20260610-ISSUE1592.P01
    // @requirement REQ-INV-001
    this.agentClient = clientFactory(this, this.runtimeState);

    if (this.isJitContextEnabled()) {
      this.contextManager = new ContextManager(this);
      await this.contextManager.refresh();
    }

    // Reserved for future model switching tracking
    void this._modelSwitchedDuringSession;
  }

  /**
   * Creates a detached agent client with a fresh runtime state, isolated
   * from the session's primary agent client and with its tool set cleared.
   * Used for one-shot operations such as subagent auto-prompt generation.
   */
  async createDetachedAgentClient(id?: string): Promise<AgentClientContract> {
    return createDetachedAgentClient(this, id);
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

    await prepareAgentClientReplacement(
      logger,
      newAgentClient,
      previousAgentClient,
      existingHistory,
      existingHistoryService,
      newContentGeneratorConfig,
      this.getContentGeneratorConfig()?.vertexai,
    );
    logger.debug('New client initialized');

    this.contentGeneratorConfig = newContentGeneratorConfig;
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
    // #2534 Domain C2: single read path — the provider-scoped settings store
    // (providers[P].model) first, then the contentGeneratorConfig.model
    // derived projection, then the constructor-seeded terminal fallback for
    // Configs without an active provider (the field is not a second store:
    // the store and projection always win on read).
    const settingsService = this.getSettingsService();
    const activeProvider = settingsService.get('activeProvider') as string;
    if (typeof activeProvider === 'string' && activeProvider.length > 0) {
      const providerSettings =
        settingsService.getProviderSettings(activeProvider);
      if (
        typeof providerSettings.model === 'string' &&
        providerSettings.model.length > 0
      ) {
        return providerSettings.model;
      }
    }
    const projected = this.getContentGeneratorConfig()?.model;
    return projected && projected.length > 0 ? projected : this.model;
  }

  setModel(newModel: string): void {
    // #2534 Domain C2: one transition — a single provider-scoped store write
    // plus the contentGeneratorConfig.model derived projection. The terminal
    // fallback field (providerless Configs) is updated in the same transition
    // so getModel() keeps returning the last-set model until a provider scope
    // exists; the change event fires only for actual changes, as on main.
    const settingsService = this.getSettingsService();
    const activeProvider = settingsService.get('activeProvider') as string;
    if (typeof activeProvider === 'string' && activeProvider.length > 0) {
      settingsService.setProviderSetting(activeProvider, 'model', newModel);
    }
    const contentConfig = this.getContentGeneratorConfig();
    if (contentConfig) {
      contentConfig.model = newModel;
    }
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

  async refreshMcpServers(
    messageBus: MessageBus,
    server?: string,
  ): Promise<void> {
    requireMessageBus(messageBus, 'Config.refreshMcpServers');
    await this.refreshMcpServersWithContext(
      () => this.refreshMcpContext(messageBus),
      server,
    );
  }

  /**
   * Refreshes the MCP context, including memory, tools, and system instructions.
   * Preserved from gmerge branch for compatibility with McpClientManager.
   */
  subscribeMcpSurface(subscriber: () => Promise<void>): () => void {
    this.mcpSurfaceSubscribers.add(subscriber);
    return () => {
      this.mcpSurfaceSubscribers.delete(subscriber);
    };
  }

  async refreshDiscoveredMcpMetadata(): Promise<void> {
    await this.refreshMemory();
    for (const subscriber of this.mcpSurfaceSubscribers) {
      await subscriber();
    }
  }

  async refreshMcpContext(messageBus: MessageBus): Promise<void> {
    requireMessageBus(messageBus, 'Config.refreshMcpContext');
    await this.refreshMemory();
    await syncActivateMcpServerTool(this.getToolRegistry(), messageBus, () =>
      this.refreshMcpContext(messageBus),
    );
    const client = this.getAgentClientIfReady();
    if (client) {
      await client.setTools();
      await client.updateSystemInstruction();
    }
  }

  async reloadMcpServers(messageBus: MessageBus): Promise<void> {
    if (this._onReloadMcpServers === undefined) {
      throw new Error(
        'MCP server reload is not available in this composition.',
      );
    }
    const { mcpServers, blockedMcpServers, settingsMcpServers } =
      await this._onReloadMcpServers();
    this.mcpServers = mcpServers;
    this.blockedMcpServers = [...blockedMcpServers];
    this.policyEngine.removeRulesBySource(MCP_TRUSTED_POLICY_SOURCE);
    if (this.isTrustedFolder()) {
      for (const rule of buildMcpTrustedRules({
        mcpServers: settingsMcpServers,
      })) {
        this.policyEngine.addRule(rule);
      }
    }
    await this.mcpClientManager?.reconcileConfiguredMcpServers(() =>
      this.refreshMcpContext(messageBus),
    );
  }

  /**
   * Rediscovers skills and carries the result through to the model, without
   * re-reading settings.
   *
   * Use this when the set of skill *sources* changes underneath the session,
   * for example when an extension that contributes skills is loaded or
   * unloaded (issue #3383). `reloadSkills` is the variant to use when the user
   * asked for a reload and settings should be re-read too.
   */
  subscribeSkillSurface(subscriber: () => Promise<void>): () => void {
    this.skillSurfaceSubscribers.add(subscriber);
    return () => {
      this.skillSurfaceSubscribers.delete(subscriber);
    };
  }

  private async refreshExtensionSkills(): Promise<void> {
    await this.skillManager.discoverSkills(this.storage, this.getExtensions());
    this.skillManager.setDisabledSkills(this.disabledSkills);
    for (const subscriber of this.skillSurfaceSubscribers) {
      await subscriber();
    }
  }

  async publishSkillSurface(messageBus: MessageBus): Promise<void> {
    requireMessageBus(messageBus, 'Config.publishSkillSurface');
    syncSkillActivationTool(this, messageBus);
    const client = this.getAgentClientIfReady();
    if (client) {
      await client.setTools();
    }
  }

  async refreshSkills(messageBus: MessageBus): Promise<void> {
    await this.skillManager.discoverSkills(this.storage, this.getExtensions());
    this.skillManager.setDisabledSkills(this.disabledSkills);
    await this.publishSkillSurface(messageBus);
    for (const subscriber of this.skillSurfaceSubscribers) await subscriber();
  }

  async reloadSkills(messageBus: MessageBus): Promise<void> {
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
    await this.refreshSkills(messageBus);
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
    if (this.isJitContextEnabled() && this.contextManager) {
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
    this.syncModeDerivedPolicyRules(mode);
  }

  private syncModeDerivedPolicyRules(mode: ApprovalMode): void {
    const engine = this.getPolicyEngine();
    engine.setApprovalMode(mode);
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

  getTelemetrySettings(): TelemetrySettings {
    return configConstructor.withClonedPerf(this.telemetrySettings);
  }

  updateTelemetrySettings(settings: Partial<TelemetrySettings>): void {
    this.telemetrySettings = configConstructor.mergeTelemetrySettings(
      this.telemetrySettings,
      settings,
    );

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
    return this.getIdeTrust() ?? this.trustedFolder ?? true;
  }

  getIdeTrust(): boolean | undefined {
    return (
      this.ideTrust ?? ideContext.getIdeContext()?.workspaceState?.isTrusted
    );
  }

  /**
   * Updates the local trust fallback. IDE trust remains authoritative, so this
   * only triggers a transition when the effective trust value changes.
   */
  setTrustedFolderLive(trusted: boolean): Promise<void> {
    const previousEffectiveTrust = this.isTrustedFolder();
    this.trustedFolder = trusted;
    if (!this.initialized) {
      return Promise.resolve();
    }
    return this.reconcileEffectiveTrust(previousEffectiveTrust);
  }

  private reconcileEffectiveTrust(
    previousEffectiveTrust: boolean,
  ): Promise<void> {
    const effectiveTrust = this.isTrustedFolder();
    this.cachedEffectiveTrust = effectiveTrust;
    if (previousEffectiveTrust !== effectiveTrust) {
      return this.liveTrustTransitionLifecycle.apply(effectiveTrust);
    }
    return Promise.resolve();
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
    const inactivitySeconds = Number(
      ephemeralSettings['shell-inactivity-timeout-seconds'] ?? 120,
    );

    const rawLimit = ephemeralSettings['shell-output-retention-max-bytes'];

    return {
      terminalWidth: this.getPtyTerminalWidth(),
      terminalHeight: this.getPtyTerminalHeight(),
      showColor: this.getAllowPtyThemeOverride(),
      scrollback: this.getPtyScrollbackLimit(),
      inactivityTimeoutMs:
        inactivitySeconds === -1 ? undefined : inactivitySeconds * 1000,
      outputRetentionMaxBytes:
        typeof rawLimit === 'number' ? rawLimit : undefined,
      isSandboxOrCI: !!this.getSandbox() || process.env.CI === 'true',
    };
  }

  /**
   * Lazily loads JIT subdirectory memory for a given path.
   * Returns formatted memory content from LLXPRT.md files found between
   * the target path and the trusted root, excluding already-loaded paths.
   */
  async getJitMemoryForPath(targetPath: string): Promise<string> {
    if (!this.isJitContextEnabled()) {
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

  async refreshMemory(): Promise<{
    memoryContent: string;
    fileCount: number;
    filePaths: string[];
  }> {
    if (this.isJitContextEnabled() && this.contextManager) {
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
      return undefined;
    }

    // @requirement:HOOK-001 - Lazy creation on first access
    this.hookSystem ??= new HookSystem(this);

    return this.hookSystem;
  }

  private ideTrust: boolean | undefined;
  private cachedEffectiveTrust: boolean;

  /**
   * Resolves once any pending trust-transition side-effects have settled.
   */
  async whenTrustTransitionSettled(): Promise<void> {
    await this.liveTrustTransitionLifecycle.whenSettled();
  }

  private ideTrustChangeListener:
    | ((isTrusted: boolean | undefined) => void)
    | undefined;

  /**
   * Subscribes to live IDE trust changes so that MCP servers, hooks, and
   * approval mode are updated immediately without requiring a restart.
   */
  private registerIdeTrustListener(): void {
    const client = this.ideClient;
    const previousEffectiveTrust = this.cachedEffectiveTrust;
    this.ideTrust = ideContext.getIdeContext()?.workspaceState?.isTrusted;
    if (client && typeof client.addTrustChangeListener === 'function') {
      this.ideTrustChangeListener = (isTrusted: boolean | undefined) => {
        const priorEffectiveTrust = this.cachedEffectiveTrust;
        this.ideTrust = isTrusted;
        void this.reconcileEffectiveTrust(priorEffectiveTrust).catch(
          (error) => {
            Config.logger.error(
              `IDE trust reconciliation failed: ${getErrorMessage(error)}`,
            );
          },
        );
      };
      client.addTrustChangeListener(this.ideTrustChangeListener);
    }
    void this.reconcileEffectiveTrust(previousEffectiveTrust).catch((error) => {
      Config.logger.error(
        `IDE trust reconciliation failed: ${getErrorMessage(error)}`,
      );
    });
  }

  private disposalPromise: Promise<void> | undefined;

  dispose(): Promise<void> {
    this.disposalPromise ??= this.performDisposal();
    return this.disposalPromise;
  }

  private async performDisposal(): Promise<void> {
    const failures: unknown[] = [];
    try {
      this.liveTrustTransitionLifecycle.beginDisposal();
    } catch (error) {
      failures.push(error);
    }
    if (
      this.ideTrustChangeListener &&
      this.ideClient &&
      typeof this.ideClient.removeTrustChangeListener === 'function'
    ) {
      try {
        this.ideClient.removeTrustChangeListener(this.ideTrustChangeListener);
      } catch (error) {
        failures.push(error);
      }
      this.ideTrustChangeListener = undefined;
    }
    // Initiate MCP shutdown before awaiting trust-transition settlement so
    // in-flight MCP work is cancelled and cannot block disposal.
    const stopPromise = this.mcpClientManager?.stop();
    try {
      await this.whenTrustTransitionSettled();
    } catch (error) {
      failures.push(error);
    }
    try {
      failures.push(
        ...(await unloadActiveExtensions(this.getExtensionLoader())),
      );
    } catch (error) {
      failures.push(error);
    }
    const client = this.agentClient as AgentClientContract | undefined;
    if (client !== undefined) {
      try {
        await client.dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    if (this.hookSystem !== undefined) {
      const hookSystem = this.hookSystem;
      this.hookSystem = undefined;
      try {
        hookSystem.dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    if (this.mcpDiscoveryPromise !== undefined) {
      try {
        await this.mcpDiscoveryPromise;
      } catch (error) {
        Config.logger.warn(
          `MCP discovery rejected during dispose: ${getErrorMessage(error)}`,
        );
      }
    }
    if (stopPromise !== undefined) {
      try {
        await stopPromise;
      } catch (error) {
        failures.push(error);
      }
    }
    throwFailures(failures);
  }
}

function throwFailures(failures: unknown[]): void {
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Config disposal failed');
  }
}
