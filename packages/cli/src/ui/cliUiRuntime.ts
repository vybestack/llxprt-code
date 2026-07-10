/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AccessibilitySettings,
  AgentClientContract,
  AgentClientFactory,
  ApprovalMode,
  AsyncTaskManager,
  BucketFailoverHandler,
  ContextManager,
  FileDiscoveryService,
  FileFilteringOptions,
  FileSystemService,
  HookSystem,
  IdeClient,
  LlxprtExtension,
  MCPResource,
  MCPServerConfig,
  MessageBus,
  PolicyEngine,
  RedactionConfig,
  RuntimeProviderManager,
  SandboxConfig,
  SchedulerCallbacks,
  SchedulerOptions,
  ShellExecutionConfig,
  ShellReplacementMode,
  SkillManager,
  SubagentSchedulerFactory,
  TelemetrySettings,
  ToolRegistry,
  ToolSchedulerContract,
} from '@vybestack/llxprt-code-core';
import type {
  DiscoveredMCPPrompt,
  MCPDiscoveryState,
} from '@vybestack/llxprt-code-mcp';
import type { SettingsService, Storage } from '@vybestack/llxprt-code-settings';
import type {
  LspConfig,
  LspServiceClient,
} from '@vybestack/llxprt-code-ide-integration';

export interface RefreshMemoryResult {
  memoryContent: string;
  fileCount: number;
  filePaths: string[];
}

export interface UiWorkspaceContext {
  getDirectories(): readonly string[];
  addDirectory(path: string): void;
  isPathWithinWorkspace(inputPath: string): boolean;
}

export interface UiBugCommandSettings {
  urlTemplate?: string;
}

export interface UiPromptRegistry {
  getPromptsByServer(serverName: string): DiscoveredMCPPrompt[];
  getAllPrompts(): DiscoveredMCPPrompt[];
  getPrompt(name: string): DiscoveredMCPPrompt | undefined;
  clear(): void;
}

export interface UiResourceRegistry {
  getAllResources(): MCPResource[];
  findResourceByUri(identifier: string): MCPResource | undefined;
}

export interface UiExtensionLoader {
  getExtensions(): LlxprtExtension[];
  restartExtension(extension: LlxprtExtension): Promise<void>;
}

export interface UiSubagentManager {
  listSubagents(): Promise<string[]>;
}

export interface ExtensionEnablementSource {
  isEnabled(extensionName: string, path: string): boolean;
}

export interface UiMcpClientManager {
  getClient?(name: string):
    | {
        readResource(uri: string): Promise<unknown>;
      }
    | undefined;
  getDiscoveryState(): MCPDiscoveryState;
  getMcpServerCount(): number;
  restartServer(serverName: string): Promise<void>;
}

export interface UiContentGeneratorConfig {
  model?: string;
  apiKey?: string;
  vertexai?: boolean;
  providerManager?: {
    getActiveProvider?: () =>
      | {
          getContextLimit?: () => number | undefined;
        }
      | undefined;
    getServerToolsProvider?():
      | {
          getServerTools: () => string[];
          invokeServerTool: (
            name: string,
            params: { prompt: string },
            options: { signal: AbortSignal },
          ) => Promise<unknown>;
        }
      | null
      | undefined;
  };
}

/**
 * Focused capability read-models. Each exposes only the members a single
 * consumer family needs, so callers depend on the smallest suitable surface
 * rather than the full CliUiRuntime aggregate.
 */

/**
 * Provides the live AgentClient used by the streaming path.
 * Bootstrap resolves the client once and threads it explicitly; downstream
 * hooks receive this boundary instead of dereferencing the runtime object.
 */
export interface AgentClientSource {
  getAgentClient(): AgentClientContract;
  getAgentClientFactory?(): AgentClientFactory | undefined;
  createDetachedAgentClient?(runtimeId?: string): AgentClientContract;
}

/**
 * Session identity read-model: stable identifiers and directories a UI
 * consumer needs to label or scope output.
 */
export interface SessionIdentity {
  getSessionId(): string;
  getTargetDir(): string;
  getProjectRoot(): string;
  getWorkingDir(): string;
  getProjectTempDir(): string;
  getGeminiDir(): string;
}

/**
 * Model/provider read-model for components that render or switch the active
 * model/provider.
 */
export interface ModelState {
  getModel(): string;
  getProvider(): string | undefined;
  setProvider(provider: string): void;
  getProviderManager(): RuntimeProviderManager | undefined;
  getContentGeneratorConfig(): UiContentGeneratorConfig | undefined;
}

/**
 * Shell/terminal read-model for embedded shell and PTY consumers.
 */
export interface ShellState {
  getShouldUseNodePtyShell(): boolean;
  getEnableInteractiveShell(): boolean;
  getPtyTerminalWidth(): number | undefined;
  getPtyTerminalHeight(): number | undefined;
  setPtyTerminalSize(
    width: number | undefined,
    height: number | undefined,
  ): void;
  getTerminalBackground(): string | undefined;
  getShellReplacement(): ShellReplacementMode;
  getShellExecutionConfig(): ShellExecutionConfig;
}

/**
 * File/workspace read-model for file discovery, filtering, and workspace
 * directory consumers.
 */
export interface FileWorkspaceState {
  getFileService(): FileDiscoveryService;
  getFileFilteringOptions(): FileFilteringOptions;
  getFileFilteringDisableFuzzySearch(): boolean;
  getFileExclusions(): {
    getGlobExcludes(): string[];
    getReadManyFilesExcludes(): string[];
  };
  getFileFilteringRespectLlxprtIgnore(): boolean;
  getFileFilteringRespectGitIgnore(): boolean;
  getFileSystemService(): FileSystemService;
  getEnableRecursiveFileSearch(): boolean;
  getWorkspaceContext(): UiWorkspaceContext;
}

/**
 * Memory read-model for components that display or refresh memory content.
 */
export interface MemoryState {
  getUserMemory(): string;
  setUserMemory(newUserMemory: string): void;
  setCoreMemory(content: string): void;
  getLlxprtMdFileCount(): number;
  getCoreMemoryFileCount(): number;
  getLlxprtMdFilePaths(): string[];
  setLlxprtMdFileCount(count: number): void;
  setLlxprtMdFilePaths(paths: string[]): void;
  refreshMemory(): Promise<RefreshMemoryResult>;
  shouldLoadMemoryFromIncludeDirectories(): boolean;
}

/**
 * IDE read-model for IDE client and integration prompt consumers.
 */
export interface IdeState {
  getIdeClient(): IdeClient | undefined;
  getIdeMode(): boolean;
  setIdeMode(value: boolean): void;
  setIdeClientConnected(): void;
  setIdeClientDisconnected(): void;
  getLspConfig(): LspConfig | undefined;
  getLspServiceClient(): LspServiceClient | undefined;
}

/**
 * Hook/skill read-model for hook display and skill support consumers.
 */
export interface HookSkillState {
  getHookSystem(): HookSystem | undefined;
  getEnableHooks(): boolean;
  getDisabledHooks(): string[];
  setDisabledHooks(hooks: string[]): void;
  isSkillsSupportEnabled(): boolean;
  getEnableHooksUI(): boolean;
  reloadSkills(): Promise<void>;
  getSkillManager(): SkillManager;
}

/**
 * MCP read-model for MCP server, client, prompt, and resource consumers.
 */
export interface McpState {
  getMcpServers(): Record<string, MCPServerConfig> | undefined;
  getMcpServerCommand(): string | undefined;
  getMcpClientManager(): UiMcpClientManager | undefined;
  getBlockedMcpServers():
    | Array<{ name: string; extensionName: string }>
    | undefined;
  getResourceRegistry(): UiResourceRegistry;
  getPromptRegistry(): UiPromptRegistry;
}

/**
 * Settings/telemetry read-model for settings service, telemetry, and proxy
 * consumers.
 */
export interface SettingsTelemetryState {
  getSettingsService(): SettingsService;
  getProxy(): string | undefined;
  getBugCommand(): UiBugCommandSettings | undefined;
  getTelemetrySettings(): TelemetrySettings & {
    remoteConsentGiven?: boolean;
    [key: string]: unknown;
  };
  updateTelemetrySettings(settings: Partial<TelemetrySettings>): void;
  getTelemetryLogPromptsEnabled(): boolean;
  getTelemetryEnabled(): boolean;
  getTelemetryOutfile(): string | undefined;
  getTelemetryTarget(): string;
  getTelemetryOtlpEndpoint(): string;
  getConversationLoggingEnabled(): boolean;
  getEmbeddingModel(): string | undefined;
  getSandbox(): SandboxConfig | undefined;
  getRedactionConfig(): RedactionConfig;
}

/**
 * Scheduler capability for the agentic loop. Mirrors the narrow
 * {@link AgenticLoopRuntime} contract from the agents package.
 */
export interface SchedulerRuntime {
  disposeScheduler(sessionId: string): void;
  getOrCreateScheduler(
    sessionId: string,
    callbacks: SchedulerCallbacks,
    options?: SchedulerOptions,
    dependencies?: {
      messageBus?: MessageBus;
      toolRegistry?: ToolRegistry;
    },
  ): Promise<ToolSchedulerContract>;
  setInteractiveSubagentSchedulerFactory(
    factory: SubagentSchedulerFactory | undefined,
  ): void;
}

export interface UiToolRegistryInfo {
  registered: Array<{ displayName: string }>;
  unregistered: Array<{ displayName: string; reason?: string }>;
}

/**
 * Tool-registry SOURCE capability. This is a bare-source read-model (part of
 * {@link StreamRuntimeBareSource}) consumed by the focused MCP/auto-prompt
 * boundaries ({@link McpCommandRuntime}, the auto-prompt runtime) and by the
 * settings dialog's dynamic tool-settings derivation. It is intentionally NOT
 * re-exposed as a projected `tools` slice on {@link StreamRuntime}: the
 * streaming/UI path lists tools through the public `agent.tools` surface
 * (#2376), so no UI hook reads the registry off the runtime.
 */
export interface ToolRuntime {
  getToolRegistry(): ToolRegistry;
  getToolRegistryInfo(): UiToolRegistryInfo;
}

/**
 * Async-task capability for background task auto-trigger and cancellation.
 */
export interface AsyncTaskRuntime {
  getAsyncTaskManager(): AsyncTaskManager | undefined;
  setupAsyncTaskAutoTrigger(
    isAgentBusy: () => boolean,
    triggerAgentTurn: (message: string) => Promise<void>,
  ): () => void;
}

/**
 * Bucket-failover capability for turn-boundary auth reset/retry.
 */
export interface BucketFailoverRuntime {
  getBucketFailoverHandler(): BucketFailoverHandler | undefined;
}

/**
 * Checkpoint capability for restorable tool-call persistence.
 */
export interface CheckpointRuntime {
  getCheckpointingEnabled(): boolean;
}

/**
 * Session-limits capability for max-turns enforcement.
 */
export interface SessionLimitsRuntime {
  getMaxSessionTurns(): number;
}

/**
 * Interactive-mode capability for the agentic loop's interactive flag.
 */
export interface InteractiveRuntime {
  isInteractive(): boolean;
}

/**
 * Ephemeral-settings capability for feature flags like emoji filter.
 */
export interface EphemeralSettingsRuntime {
  getEphemeralSetting(key: string): unknown;
}

/**
 * MCP-discovery capability for stream-gating on MCP readiness.
 */
export interface McpDiscoveryRuntime {
  getMcpClientManager(): UiMcpClientManager | undefined;
  getMcpServers(): Record<string, MCPServerConfig> | undefined;
}

/**
 * Approval/policy capability for tools dialog and approval-mode display.
 */
export interface ApprovalState {
  getApprovalMode(): ApprovalMode;
  setApprovalMode(mode: ApprovalMode): void;
  getPolicyEngine(): PolicyEngine;
  getCoreTools(): string[] | undefined;
  getExcludeTools(): string[] | undefined;
}

/**
 * Extension capability for extension display and enablement.
 */
export interface ExtensionRuntime {
  getExtensions(): LlxprtExtension[];
  getExtensionLoader(): UiExtensionLoader;
  isExtensionEnabled(extensionName: string): boolean;
  extensionEnablementManager?: ExtensionEnablementSource;
}

/**
 * App-level capability for accessibility, debug mode, sandbox, and misc flags.
 */
export interface AppStateRuntime {
  getAccessibility(): AccessibilitySettings;
  getScreenReader(): boolean;
  getDebugMode(): boolean;
  isRestrictiveSandbox(): boolean;
  isTrustedFolder(): boolean;
  getFolderTrust(): boolean;
  getQuestion(): string | undefined;
  getConversationLogPath(): string;
  getEnablePromptCompletion(): boolean;
  isJitContextEnabled(): boolean;
  getContextManager(): ContextManager | undefined;
  getEphemeralSettings(): Record<string, unknown>;
  setEphemeralSetting(key: string, value: unknown): void;
  getSubagentManager(): UiSubagentManager | undefined;
  updateSystemInstructionIfInitialized(): void | Promise<void>;
}

/**
 * Nested runtime boundary for the streaming path. Each field is a focused
 * capability interface so downstream hooks depend on the smallest suitable
 * surface rather than a flat god-object.
 */
export interface StreamRuntime {
  session: SessionIdentity;
  model: ModelState;
  agentClientSource: AgentClientSource;
  shell: ShellState;
  files: FileWorkspaceState;
  memory: MemoryState;
  ide: IdeState;
  hooks: HookSkillState;
  mcp: McpState;
  settings: SettingsTelemetryState;
  scheduler: SchedulerRuntime;
  asyncTasks: AsyncTaskRuntime;
  bucketFailover: BucketFailoverRuntime;
  checkpoint: CheckpointRuntime;
  sessionLimits: SessionLimitsRuntime;
  interactive: InteractiveRuntime;
  ephemeral: EphemeralSettingsRuntime;
  storage: Storage;
}

/**
 * Nested runtime boundary for the full UI layer. Composed at the composition
 * edge from focused capability objects sourced from bootstrap runtime state.
 * Below AppContainer, code accesses `runtime.session.getSessionId()` etc.,
 * never a flat aggregate.
 */
export interface UiRuntime extends StreamRuntime {
  approval: ApprovalState;
  extensions: ExtensionRuntime;
  app: AppStateRuntime;
}

/**
 * Bare structural source satisfying all focused capability interfaces
 * simultaneously. The CLI bootstrap runtime satisfies this at runtime; the
 * nested UiRuntime is built from it once at the composition edge.
 */
export interface StreamRuntimeBareSource
  extends SessionIdentity,
    ModelState,
    AgentClientSource,
    ShellState,
    FileWorkspaceState,
    MemoryState,
    IdeState,
    HookSkillState,
    McpState,
    McpDiscoveryRuntime,
    SettingsTelemetryState,
    ToolRuntime,
    SchedulerRuntime,
    AsyncTaskRuntime,
    BucketFailoverRuntime,
    CheckpointRuntime,
    SessionLimitsRuntime,
    InteractiveRuntime,
    EphemeralSettingsRuntime {
  readonly storage: Storage;
}

export interface UiRuntimeBareSource
  extends StreamRuntimeBareSource,
    ApprovalState,
    ExtensionRuntime,
    AppStateRuntime {}

function buildSessionRuntime(source: StreamRuntimeBareSource): SessionIdentity {
  return {
    getSessionId: () => source.getSessionId(),
    getTargetDir: () => source.getTargetDir(),
    getProjectRoot: () => source.getProjectRoot(),
    getWorkingDir: () => source.getWorkingDir(),
    getProjectTempDir: () => source.getProjectTempDir(),
    getGeminiDir: () => source.getGeminiDir(),
  };
}

function buildModelRuntime(source: StreamRuntimeBareSource): ModelState {
  return {
    getModel: () => source.getModel(),
    getProvider: () => source.getProvider(),
    setProvider: (provider) => source.setProvider(provider),
    getProviderManager: () => source.getProviderManager(),
    getContentGeneratorConfig: () => source.getContentGeneratorConfig(),
  };
}

function buildAgentClientSource(
  source: StreamRuntimeBareSource,
): AgentClientSource {
  const base: AgentClientSource = {
    getAgentClient: () => source.getAgentClient(),
    getAgentClientFactory: () => source.getAgentClientFactory?.(),
  };
  if (source.createDetachedAgentClient) {
    base.createDetachedAgentClient = (runtimeId) =>
      source.createDetachedAgentClient!(runtimeId);
  }
  return base;
}

function buildShellRuntime(source: StreamRuntimeBareSource): ShellState {
  return {
    getShouldUseNodePtyShell: () => source.getShouldUseNodePtyShell(),
    getEnableInteractiveShell: () => source.getEnableInteractiveShell(),
    getPtyTerminalWidth: () => source.getPtyTerminalWidth(),
    getPtyTerminalHeight: () => source.getPtyTerminalHeight(),
    setPtyTerminalSize: (width, height) =>
      source.setPtyTerminalSize(width, height),
    getTerminalBackground: () => source.getTerminalBackground(),
    getShellReplacement: () => source.getShellReplacement(),
    getShellExecutionConfig: () => source.getShellExecutionConfig(),
  };
}

function buildFilesRuntime(
  source: StreamRuntimeBareSource,
): FileWorkspaceState {
  return {
    getFileService: () => source.getFileService(),
    getFileFilteringOptions: () => source.getFileFilteringOptions(),
    getFileFilteringDisableFuzzySearch: () =>
      source.getFileFilteringDisableFuzzySearch(),
    getFileExclusions: () => source.getFileExclusions(),
    getFileFilteringRespectLlxprtIgnore: () =>
      source.getFileFilteringRespectLlxprtIgnore(),
    getFileFilteringRespectGitIgnore: () =>
      source.getFileFilteringRespectGitIgnore(),
    getFileSystemService: () => source.getFileSystemService(),
    getEnableRecursiveFileSearch: () => source.getEnableRecursiveFileSearch(),
    getWorkspaceContext: () => source.getWorkspaceContext(),
  };
}

function buildMemoryRuntime(source: StreamRuntimeBareSource): MemoryState {
  return {
    getUserMemory: () => source.getUserMemory(),
    setUserMemory: (newUserMemory) => source.setUserMemory(newUserMemory),
    setCoreMemory: (content) => source.setCoreMemory(content),
    getLlxprtMdFileCount: () => source.getLlxprtMdFileCount(),
    getCoreMemoryFileCount: () => source.getCoreMemoryFileCount(),
    getLlxprtMdFilePaths: () => source.getLlxprtMdFilePaths(),
    setLlxprtMdFileCount: (count) => source.setLlxprtMdFileCount(count),
    setLlxprtMdFilePaths: (paths) => source.setLlxprtMdFilePaths(paths),
    refreshMemory: () => source.refreshMemory(),
    shouldLoadMemoryFromIncludeDirectories: () =>
      source.shouldLoadMemoryFromIncludeDirectories(),
  };
}

function buildIdeRuntime(source: StreamRuntimeBareSource): IdeState {
  return {
    getIdeClient: () => source.getIdeClient(),
    getIdeMode: () => source.getIdeMode(),
    setIdeMode: (enabled) => source.setIdeMode(enabled),
    setIdeClientConnected: () => source.setIdeClientConnected(),
    setIdeClientDisconnected: () => source.setIdeClientDisconnected(),
    getLspConfig: () => source.getLspConfig(),
    getLspServiceClient: () => source.getLspServiceClient(),
  };
}

function buildHooksRuntime(source: StreamRuntimeBareSource): HookSkillState {
  return {
    getHookSystem: () => source.getHookSystem(),
    getEnableHooks: () => source.getEnableHooks(),
    getDisabledHooks: () => source.getDisabledHooks(),
    setDisabledHooks: (hooks) => source.setDisabledHooks(hooks),
    isSkillsSupportEnabled: () => source.isSkillsSupportEnabled(),
    getEnableHooksUI: () => source.getEnableHooksUI(),
    reloadSkills: () => source.reloadSkills(),
    getSkillManager: () => source.getSkillManager(),
  };
}

function buildMcpRuntime(source: StreamRuntimeBareSource): McpState {
  return {
    getMcpServers: () => source.getMcpServers(),
    getMcpServerCommand: () => source.getMcpServerCommand(),
    getMcpClientManager: () => source.getMcpClientManager(),
    getBlockedMcpServers: () => source.getBlockedMcpServers(),
    getResourceRegistry: () => source.getResourceRegistry(),
    getPromptRegistry: () => source.getPromptRegistry(),
  };
}

function buildSettingsRuntime(
  source: StreamRuntimeBareSource,
): SettingsTelemetryState {
  return {
    getSettingsService: () => source.getSettingsService(),
    getProxy: () => source.getProxy(),
    getBugCommand: () => source.getBugCommand(),
    getTelemetrySettings: () => source.getTelemetrySettings(),
    updateTelemetrySettings: (settings) =>
      source.updateTelemetrySettings(settings),
    getTelemetryLogPromptsEnabled: () => source.getTelemetryLogPromptsEnabled(),
    getTelemetryEnabled: () => source.getTelemetryEnabled(),
    getTelemetryOutfile: () => source.getTelemetryOutfile(),
    getTelemetryTarget: () => source.getTelemetryTarget(),
    getTelemetryOtlpEndpoint: () => source.getTelemetryOtlpEndpoint(),
    getConversationLoggingEnabled: () => source.getConversationLoggingEnabled(),
    getEmbeddingModel: () => source.getEmbeddingModel(),
    getSandbox: () => source.getSandbox(),
    getRedactionConfig: () => source.getRedactionConfig(),
  };
}

function buildSchedulerRuntime(
  source: StreamRuntimeBareSource,
): SchedulerRuntime {
  return {
    disposeScheduler: (sessionId) => source.disposeScheduler(sessionId),
    getOrCreateScheduler: (sessionId, callbacks, options, dependencies) =>
      source.getOrCreateScheduler(sessionId, callbacks, options, dependencies),
    setInteractiveSubagentSchedulerFactory: (factory) =>
      source.setInteractiveSubagentSchedulerFactory(factory),
  };
}

function buildAsyncTaskRuntime(
  source: StreamRuntimeBareSource,
): AsyncTaskRuntime {
  return {
    getAsyncTaskManager: () => source.getAsyncTaskManager(),
    setupAsyncTaskAutoTrigger: (isAgentBusy, triggerAgentTurn) =>
      source.setupAsyncTaskAutoTrigger(isAgentBusy, triggerAgentTurn),
  };
}

/**
 * Helper to build a {@link StreamRuntime} from a runtime source at the
 * composition edge. Each field is a concrete focused adapter so the nested
 * runtime does not expose the flat source object below the composition edge.
 */
function buildStreamRuntimeFromSource(
  source: StreamRuntimeBareSource,
): StreamRuntime {
  return {
    session: buildSessionRuntime(source),
    model: buildModelRuntime(source),
    agentClientSource: buildAgentClientSource(source),
    shell: buildShellRuntime(source),
    files: buildFilesRuntime(source),
    memory: buildMemoryRuntime(source),
    ide: buildIdeRuntime(source),
    hooks: buildHooksRuntime(source),
    mcp: buildMcpRuntime(source),
    settings: buildSettingsRuntime(source),
    scheduler: buildSchedulerRuntime(source),
    asyncTasks: buildAsyncTaskRuntime(source),
    bucketFailover: {
      getBucketFailoverHandler: () => source.getBucketFailoverHandler(),
    },
    checkpoint: {
      getCheckpointingEnabled: () => source.getCheckpointingEnabled(),
    },
    sessionLimits: { getMaxSessionTurns: () => source.getMaxSessionTurns() },
    interactive: { isInteractive: () => source.isInteractive() },
    ephemeral: {
      getEphemeralSetting: (key) => source.getEphemeralSetting(key),
    },
    storage: source.storage,
  };
}

export function buildUiRuntimeFromSource(
  source: UiRuntimeBareSource,
): UiRuntime {
  return {
    ...buildStreamRuntimeFromSource(source),
    approval: {
      getApprovalMode: () => source.getApprovalMode(),
      setApprovalMode: (mode) => source.setApprovalMode(mode),
      getPolicyEngine: () => source.getPolicyEngine(),
      getCoreTools: () => source.getCoreTools(),
      getExcludeTools: () => source.getExcludeTools(),
    },
    extensions: {
      getExtensions: () => source.getExtensions(),
      getExtensionLoader: () => source.getExtensionLoader(),
      isExtensionEnabled: (extensionName) =>
        source.isExtensionEnabled(extensionName),
      extensionEnablementManager: source.extensionEnablementManager,
    },
    app: {
      getAccessibility: () => source.getAccessibility(),
      getScreenReader: () => source.getScreenReader(),
      getDebugMode: () => source.getDebugMode(),
      isRestrictiveSandbox: () => source.isRestrictiveSandbox(),
      isTrustedFolder: () => source.isTrustedFolder(),
      getFolderTrust: () => source.getFolderTrust(),
      getQuestion: () => source.getQuestion(),
      getConversationLogPath: () => source.getConversationLogPath(),
      getEnablePromptCompletion: () => source.getEnablePromptCompletion(),
      isJitContextEnabled: () => source.isJitContextEnabled(),
      getContextManager: () => source.getContextManager(),
      getEphemeralSettings: () => source.getEphemeralSettings(),
      setEphemeralSetting: (key, value) =>
        source.setEphemeralSetting(key, value),
      getSubagentManager: () => source.getSubagentManager(),
      updateSystemInstructionIfInitialized: () =>
        source.updateSystemInstructionIfInitialized(),
    },
  };
}

/**
 * @deprecated Use {@link CliUiRuntime} instead. Slash-command code and other
 * broad-runtime consumers are being migrated to the canonical alias; this type
 * is retained temporarily to avoid a flag-day rename across all call sites and
 * will be removed once the migration completes.
 */
export type SlashCommandRuntime = CliUiRuntime;

/**
 * Builds a flat delegation adapter satisfying {@link CliUiRuntime} from the
 * bootstrap source. This breaks the Config identity link: downstream code
 * receives a plain object literal with delegated methods, not the raw Config
 * instance. The adapter flattens every capability produced by
 * {@link buildUiRuntimeFromSource} into a single object so slash commands and
 * dialogs receive the flat surface they expect.
 */
export function buildSlashCommandRuntime(
  source: UiRuntimeBareSource,
): CliUiRuntime {
  const { storage, ...capabilities } = buildUiRuntimeFromSource(source);
  // This flattening assumes every capability object exposes unique property
  // names. If a future capability overlaps an existing one, Object.assign will
  // keep the last value silently, so add an explicit test when adding slices.
  return Object.assign({}, ...Object.values(capabilities), { storage });
}

/**
 * MCP-command boundary: the focused capability slice that MCP display and
 * auth commands actually need.
 */
export interface McpCommandRuntime {
  getMcpServers(): Record<string, MCPServerConfig> | undefined;
  getBlockedMcpServers():
    | Array<{ name: string; extensionName: string }>
    | undefined;
  getMcpClientManager(): UiMcpClientManager | undefined;
  getAgentClient(): AgentClientContract;
  getToolRegistry(): ToolRegistry;
  getResourceRegistry(): UiResourceRegistry;
  getPromptRegistry(): UiPromptRegistry;
}

/**
 * Structural composition of all focused capability interfaces. This is NOT a
 * flat god-object — it is a type-level intersection of focused read-models.
 * The bootstrap runtime satisfies it structurally at runtime. Used by broader UI
 * hooks (slash commands, at-completion, tool dialog, etc.) that have not yet
 * been migrated to the nested UiRuntime pattern. The streaming path and
 * AppContainer MUST NOT use this type — they use StreamRuntime/UiRuntime.
 */
export type CliUiRuntime = UiRuntimeBareSource;
