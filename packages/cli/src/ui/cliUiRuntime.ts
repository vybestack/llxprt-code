import type {
  UserPromptEvent,
  SlashCommandEvent,
} from '@vybestack/llxprt-code-telemetry';
import { buildSettingsRuntime } from '../runtime/createRuntimeOwnerFeatures.js';
type SessionSettingsOwner = NonNullable<FromConfigOptions['settingsOwner']>;
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  SessionEndReason,
  WorkspaceSkillOperations,
  WorkspaceCheckpointOperations,
  WorkspacePromptSelection,
  WorkspaceResourceSelection,
  WorkspaceIgnoreOperations,
  WorkspaceSearchOperations,
  AccessibilitySettings,
  AgentClientContract,
  ContentGeneratorConfig,
  ApprovalMode,
  FileFilteringOptions,
  IdeClient,
  LlxprtExtension,
  MCPServerConfig,
  RedactionConfig,
  SandboxConfig,
  ShellExecutionConfig,
  ShellReplacementMode,
  TelemetrySettings,
} from '@vybestack/llxprt-code-core';
import type { Agent, FromConfigOptions } from '@vybestack/llxprt-code-agents';
import type { LspConfig } from '@vybestack/llxprt-code-ide-integration';
import {
  readGitHubCompletionReport,
  type GitHubCompletionReads,
} from './hooks/githubAtCompletion.js';
import type { PerfSnapshotCapability } from './commands/perfCommand.js';
import type { CliSessionPersistencePort } from '../cliSessionPersistence.js';

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

export interface UiSubagentManager {
  listSubagents(): Promise<string[]>;
}

export interface ExtensionEnablementSource {
  isEnabled(extensionName: string, path: string): boolean;
}

export type UiContentGeneratorConfig = ContentGeneratorConfig;

/**
 * Focused capability read-models. Each exposes only the members a single
 * consumer family needs, so callers depend on the smallest suitable surface
 * rather than the full CliUiRuntime aggregate.
 */

/**
 * Provides the live AgentClient used by the streaming path.
 * Each lookup resolves the current Agent owner after profile replacement;
 * hooks receive this boundary separately from workspace capabilities.
 */
export interface AgentClientSource {
  getAgentClient(): AgentClientContract;
  createDetachedAgentClient?(runtimeId?: string): Promise<AgentClientContract>;
}

/**
 * Session identity read-model: stable identifiers and directories a UI
 * consumer needs to label or scope output.
 */
export interface SessionIdentity {
  getSessionId(): string;
  adoptSessionId(sessionId: string): void;
  getTargetDir(): string;
  getProjectRoot(): string;
  getWorkingDir(): string;
  getProjectTempDir(): string;
  getSessionRecordingQueueByteLimit(): number;
  getLlxprtDir(): string;
}

/**
 * Model/provider read-model for components that render or switch the active
 * model/provider.
 */
export interface ModelState {
  getModel(): string;
  getProvider(): string | undefined;
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
  readonly search: WorkspaceSearchOperations['search'];
  readonly initializeSearch: WorkspaceSearchOperations['initializeSearch'];
  readonly ignore: Pick<
    WorkspaceIgnoreOperations,
    | 'shouldIgnoreFile'
    | 'shouldGitIgnoreFile'
    | 'shouldLlxprtIgnoreFile'
    | 'filterFiles'
    | 'filterFilesWithReport'
    | 'getGlobExcludes'
    | 'getReadManyFilesExcludes'
  >;
  getFileFilteringOptions(): FileFilteringOptions;
  getFileFilteringDisableFuzzySearch(): boolean;
  getFileFilteringRespectLlxprtIgnore(): boolean;
  getFileFilteringRespectGitIgnore(): boolean;
  getEnableRecursiveFileSearch(): boolean;
  directories(): readonly string[];
  addDirectory(directory: string): void;
  contains(filePath: string): boolean;
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
  setIdeClientConnected(): void | Promise<void>;
  setIdeClientDisconnected(): void | Promise<void>;
  getLspConfig(): LspConfig | undefined;
}

/**
 * Hook/skill read-model for hook display and skill support consumers.
 */
export interface HookSkillState {
  endHookSession(reason: SessionEndReason): Promise<void>;
  getEnableHooks(): boolean;
  getDisabledHooks(): string[];
  setDisabledHooks(hooks: string[]): void;
  isSkillsSupportEnabled(): boolean;
  getEnableHooksUI(): boolean;
  isAdminSkillsEnabled(): boolean;
}

/**
 * MCP read-model for MCP server, client, prompt, and resource consumers.
 */
export interface McpState {
  getMcpServers(): Record<string, MCPServerConfig> | undefined;
  getMcpServerCommand(): string | undefined;
  getBlockedMcpServers():
    | Array<{ name: string; extensionName: string }>
    | undefined;
  listPrompts: WorkspacePromptSelection['listPrompts'];
  listResources: WorkspaceResourceSelection['listResources'];
}

/**
 * Settings/telemetry read-model for settings service, telemetry, and proxy
 * consumers.
 */
export interface SettingsTelemetryState {
  logUserPrompt(event: UserPromptEvent): void;
  logSlashCommand(event: SlashCommandEvent): void;
  readCitations(): unknown;
  readProfileName(): string | null;
  readSelectedProvider(): string | undefined;
  subscribeModelSelection(listener: () => void): () => void;
  getProxy(): string | undefined;
  getBugCommand(): UiBugCommandSettings | undefined;
  getTelemetrySettings(): TelemetrySettings;
  updateTelemetrySettings(settings: Partial<TelemetrySettings>): Promise<void>;
  getTelemetryLogPromptsEnabled(): boolean;
  getTelemetryEnabled(): boolean;
  getTelemetryOutfile(): string | undefined;
  getConversationLoggingEnabled(): boolean;
  getEmbeddingModel(): string | undefined;
  getSandbox(): SandboxConfig | undefined;
  getRedactionConfig(): RedactionConfig;
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
  describeToolConfiguration(): UiToolRegistryInfo;
}

/**
 * Bucket-failover capability for turn-boundary auth reset/retry.
 */
export interface BucketFailoverRuntime {
  resetBuckets?(): void;
  resetBucketSession?(): void;
  ensureBucketsAuthenticated?(): Promise<void>;
  readFailoverBuckets?(): string[];
  readCurrentBucket?(): string | undefined;
}

/**
 * Checkpoint capability for restorable tool-call persistence.
 */
export interface CheckpointRuntime {
  readonly checkpoints: WorkspaceCheckpointOperations;
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
 * MCP discovery and configured-server state exposed to CLI consumers.
 */
type McpUiSelection = Pick<
  Agent['mcp'],
  | 'listPrompts'
  | 'listResources'
  | 'subscribeStatus'
  | 'listServers'
  | 'listBlockedServers'
>;

export interface McpDiscoveryRuntime {
  getMcpServers(): Record<string, MCPServerConfig> | undefined;
}

/** App-event capability for MCP discovery changes owned by this session. */
export interface AppEventRuntime {
  onMcpClientUpdate(listener: () => void): () => void;
}

/**
 * Approval/policy capability for tools dialog and approval-mode display.
 */
export interface ApprovalState {
  getApprovalMode(): ApprovalMode;
  setApprovalMode(mode: ApprovalMode): void;
  getCoreTools(): string[] | undefined;
  getExcludeTools(): string[] | undefined;
}

/**
 * Extension capability for extension display and enablement.
 */
export interface ExtensionRuntime {
  getExtensions(): LlxprtExtension[];
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
  setTrustedFolderLive(trusted: boolean): Promise<void>;
  getFolderTrust(): boolean;
  getQuestion(): string | undefined;
  getConversationLogPath(): string;
  getEnablePromptCompletion(): boolean;
  getUtilityModel(): string | undefined;
  isJitContextEnabled(): boolean;
  getEphemeralSettings(): Readonly<Record<string, unknown>>;
  setEphemeralSetting(key: string, value: unknown): void;
  getSubagentManager(): UiSubagentManager | undefined;
  /**
   * Transport for brokered GitHub operations, used by @issue and @pr
   * completion. Undefined when no broker is wired, in which case those
   * completions are simply not offered.
   *
   * @plan PLAN-20260731-GHBROKER.P16
   * @requirement REQ-014
   */
  readonly githubCompletion?: GitHubCompletionReads;
  updateSystemInstructionIfInitialized(): void | Promise<void>;
  /**
   * Returns the owned perf snapshot capability for the bare `/perf` live view,
   * or null when perf telemetry is not active. P12 wires this from the
   * interactive perf runtime owner. Optional: callers without a perf owner
   * (disabled/default-off) return null or omit this entirely.
   */
  getPerfSnapshotCapability?(): PerfSnapshotCapability | null;
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
  events: AppEventRuntime;
  bucketFailover: BucketFailoverRuntime;
  checkpoint: CheckpointRuntime;
  sessionLimits: SessionLimitsRuntime;
  interactive: InteractiveRuntime;
  ephemeral: EphemeralSettingsRuntime;
  projectTempDir: string;
  projectChatsDir: string;
  projectCheckpointsDir: string;
  historyFilePath: string;
  userCommandsDir: string;
  projectCommandsDir: string;
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
    ShellState,
    Omit<
      FileWorkspaceState,
      | 'directories'
      | 'addDirectory'
      | 'contains'
      | 'ignore'
      | 'search'
      | 'initializeSearch'
    >,
    Pick<MemoryState, 'shouldLoadMemoryFromIncludeDirectories'>,
    IdeState,
    Omit<HookSkillState, 'endHookSession'>,
    Omit<
      McpState,
      | 'listPrompts'
      | 'listResources'
      | 'subscribeStatus'
      | 'listServers'
      | 'listBlockedServers'
    >,
    McpDiscoveryRuntime,
    SettingsTelemetryState,
    BucketFailoverRuntime,
    Pick<CheckpointRuntime, 'getCheckpointingEnabled'>,
    SessionLimitsRuntime,
    InteractiveRuntime,
    EphemeralSettingsRuntime {
  readonly projectTempDir: string;
  readonly projectChatsDir: string;
  readonly projectCheckpointsDir: string;
  readonly historyFilePath: string;
  readonly userCommandsDir: string;
  readonly projectCommandsDir: string;
}

export interface UiRuntimeBareSource
  extends StreamRuntimeBareSource,
    ApprovalState,
    ExtensionRuntime,
    AppStateRuntime {}

export type StreamRuntimeDeclarationSource = Omit<
  StreamRuntimeBareSource,
  | 'logUserPrompt'
  | 'logSlashCommand'
  | 'updateTelemetrySettings'
  | 'getModel'
  | 'getProvider'
  | 'getContentGeneratorConfig'
  | 'readCitations'
  | 'readProfileName'
  | 'readSelectedProvider'
  | 'subscribeModelSelection'
  | 'getEphemeralSettings'
  | 'setEphemeralSetting'
  | 'getEphemeralSetting'
  | 'getIdeClient'
  | 'getIdeMode'
  | 'setIdeMode'
  | 'setIdeClientConnected'
  | 'setIdeClientDisconnected'
>;
export type UiRuntimeDeclarationSource = Omit<
  UiRuntimeBareSource,
  | 'isTrustedFolder'
  | 'setTrustedFolderLive'
  | 'getSubagentManager'
  | 'logUserPrompt'
  | 'logSlashCommand'
  | 'updateTelemetrySettings'
  | 'getModel'
  | 'getProvider'
  | 'getContentGeneratorConfig'
  | 'readCitations'
  | 'readProfileName'
  | 'readSelectedProvider'
  | 'subscribeModelSelection'
  | 'getEphemeralSettings'
  | 'setEphemeralSetting'
  | 'getEphemeralSetting'
  | 'getIdeClient'
  | 'getIdeMode'
  | 'setIdeMode'
  | 'setIdeClientConnected'
  | 'setIdeClientDisconnected'
>;

function buildSessionRuntime(
  source: StreamRuntimeDeclarationSource,
): SessionIdentity {
  return {
    getSessionId: () => source.getSessionId(),
    adoptSessionId: (sessionId) => source.adoptSessionId(sessionId),
    getTargetDir: () => source.getTargetDir(),
    getProjectRoot: () => source.getProjectRoot(),
    getWorkingDir: () => source.getWorkingDir(),
    getProjectTempDir: () => source.getProjectTempDir(),
    getSessionRecordingQueueByteLimit: () =>
      source.getSessionRecordingQueueByteLimit(),
    getLlxprtDir: () => source.getLlxprtDir(),
  };
}

function buildModelRuntime(
  agent: Pick<Agent, 'getModel' | 'getProvider' | 'agentClient'>,
): ModelState {
  return {
    getModel: () => agent.getModel(),
    getProvider: () => agent.getProvider(),
    getContentGeneratorConfig: () =>
      agent.agentClient.getContentGeneratorConfig(),
  };
}

function buildAgentClientSource(
  agent: Pick<
    Agent,
    | 'agentClient'
    | 'ide'
    | 'getApprovalMode'
    | 'setApprovalMode'
    | 'sessionClient'
    | 'hooks'
    | 'workspace'
    | 'memory'
    | 'getModel'
    | 'getProvider'
    | 'getEphemeralSetting'
    | 'getEphemeralSettings'
    | 'setEphemeralSetting'
    | 'getActiveProfileName'
    | 'onStats'
  > & {
    mcp: McpUiSelection;
  },
): AgentClientSource {
  return {
    getAgentClient: () => agent.agentClient,
    createDetachedAgentClient: (id) =>
      agent.sessionClient.createDetachedAgentClient(id),
  };
}

function buildShellRuntime(source: StreamRuntimeDeclarationSource): ShellState {
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
  source: StreamRuntimeDeclarationSource,
  workspace: Pick<
    Agent,
    | 'workspace'
    | 'memory'
    | 'sessionClient'
    | 'getModel'
    | 'getProvider'
    | 'getEphemeralSetting'
    | 'getEphemeralSettings'
    | 'setEphemeralSetting'
    | 'getActiveProfileName'
    | 'onStats'
    | 'agentClient'
    | 'ide'
    | 'getApprovalMode'
    | 'setApprovalMode'
  > & {
    mcp: McpUiSelection;
  },
): FileWorkspaceState {
  return {
    initializeSearch: (directory, options) =>
      workspace.workspace.initializeSearch(directory, options),
    search: (directory, pattern, options) =>
      workspace.workspace.search(directory, pattern, options),
    ignore: {
      getGlobExcludes: (additional) =>
        workspace.workspace.getGlobExcludes(additional),
      getReadManyFilesExcludes: (additional) =>
        workspace.workspace.getReadManyFilesExcludes(additional),
      shouldIgnoreFile: (filePath, options) =>
        workspace.workspace.shouldIgnoreFile(filePath, options),
      shouldGitIgnoreFile: (filePath) =>
        workspace.workspace.shouldGitIgnoreFile(filePath),
      shouldLlxprtIgnoreFile: (filePath) =>
        workspace.workspace.shouldLlxprtIgnoreFile(filePath),
      filterFiles: (files, options) =>
        workspace.workspace.filterFiles(files, options),
      filterFilesWithReport: (files, options) =>
        workspace.workspace.filterFilesWithReport(files, options),
    },
    getFileFilteringOptions: () => source.getFileFilteringOptions(),
    getFileFilteringDisableFuzzySearch: () =>
      source.getFileFilteringDisableFuzzySearch(),
    getFileFilteringRespectLlxprtIgnore: () =>
      source.getFileFilteringRespectLlxprtIgnore(),
    getFileFilteringRespectGitIgnore: () =>
      source.getFileFilteringRespectGitIgnore(),
    getEnableRecursiveFileSearch: () => source.getEnableRecursiveFileSearch(),
    directories: () => workspace.workspace.getDirectories(),
    addDirectory: (directory) => workspace.workspace.addDirectory(directory),
    contains: (filePath) => workspace.workspace.containsPath(filePath),
  };
}

function buildMemoryRuntime(
  source: StreamRuntimeDeclarationSource,
  workspace: Pick<
    Agent,
    | 'workspace'
    | 'memory'
    | 'sessionClient'
    | 'getModel'
    | 'getProvider'
    | 'getEphemeralSetting'
    | 'getEphemeralSettings'
    | 'setEphemeralSetting'
    | 'getActiveProfileName'
    | 'onStats'
    | 'agentClient'
    | 'ide'
    | 'getApprovalMode'
    | 'setApprovalMode'
  > & {
    mcp: McpUiSelection;
  },
): MemoryState {
  return {
    getUserMemory: () => workspace.memory.getMemory(),
    setUserMemory: (newUserMemory) => workspace.memory.setMemory(newUserMemory),
    setCoreMemory: (content) => workspace.memory.setCoreMemory(content),
    getLlxprtMdFileCount: () => workspace.memory.getFileCount(),
    getCoreMemoryFileCount: () => workspace.memory.getCoreFileCount(),
    getLlxprtMdFilePaths: () => [...workspace.memory.getFilePaths()],
    refreshMemory: async () => {
      const result = await workspace.memory.refresh();
      return { ...result, filePaths: [...result.filePaths] };
    },
    shouldLoadMemoryFromIncludeDirectories: () =>
      source.shouldLoadMemoryFromIncludeDirectories(),
  };
}

function buildIdeRuntime(
  source: StreamRuntimeDeclarationSource,
  ide: Agent['ide'],
): IdeState {
  return {
    getIdeClient: () => ide.getIdeClient(),
    getIdeMode: () => ide.getIdeMode(),
    setIdeMode: (enabled) => ide.setIdeMode(enabled),
    setIdeClientConnected: () => ide.setIdeClientConnected(),
    setIdeClientDisconnected: () => ide.setIdeClientDisconnected(),
    getLspConfig: () => source.getLspConfig(),
  };
}

function buildHooksRuntime(
  source: StreamRuntimeDeclarationSource,
  hooks: Pick<
    Agent['hooks'],
    'triggerSessionEnd' | 'getDisabledHooks' | 'setDisabledHooks'
  >,
): HookSkillState {
  return {
    endHookSession: (reason) => hooks.triggerSessionEnd(reason),
    getEnableHooks: () => source.getEnableHooks(),
    getDisabledHooks: () => [...hooks.getDisabledHooks()],
    setDisabledHooks: (names) => hooks.setDisabledHooks(names),
    isSkillsSupportEnabled: () => source.isSkillsSupportEnabled(),
    getEnableHooksUI: () => source.getEnableHooksUI(),
    isAdminSkillsEnabled: () => source.isAdminSkillsEnabled(),
  };
}

function buildMcpRuntime(
  source: StreamRuntimeDeclarationSource,
  mcp: McpUiSelection,
): McpState {
  return {
    getMcpServers: () =>
      Object.fromEntries(
        mcp.listServers().map((server) => [server.name, server.config]),
      ),
    getMcpServerCommand: () => source.getMcpServerCommand(),
    getBlockedMcpServers: () => [...mcp.listBlockedServers()],
    listPrompts: (server) => mcp.listPrompts(server),
    listResources: () => mcp.listResources(),
  };
}

function buildAppEventRuntime(
  mcp: Pick<Agent['mcp'], 'subscribeStatus'>,
): AppEventRuntime {
  return {
    onMcpClientUpdate: (listener) => mcp.subscribeStatus(listener),
  };
}

/**
 * Helper to build a {@link StreamRuntime} from a runtime source at the
 * composition edge. Each field is a concrete focused adapter so the nested
 * runtime does not expose the flat source object below the composition edge.
 */
function buildStreamWorkspaceRuntime(
  source: StreamRuntimeDeclarationSource,
  workspace: Pick<
    Agent,
    | 'hooks'
    | 'workspace'
    | 'memory'
    | 'sessionClient'
    | 'getModel'
    | 'getProvider'
    | 'getEphemeralSetting'
    | 'getEphemeralSettings'
    | 'setEphemeralSetting'
    | 'getActiveProfileName'
    | 'onStats'
    | 'agentClient'
    | 'ide'
    | 'getApprovalMode'
    | 'setApprovalMode'
  > & {
    mcp: McpUiSelection;
  },
  telemetrySettings?: SessionSettingsOwner,
): Omit<StreamRuntime, 'agentClientSource'> {
  return {
    session: buildSessionRuntime(source),
    model: buildModelRuntime(workspace),
    shell: buildShellRuntime(source),
    files: buildFilesRuntime(source, workspace),
    memory: buildMemoryRuntime(source, workspace),
    ide: buildIdeRuntime(source, workspace.ide),
    hooks: buildHooksRuntime(source, workspace.hooks),
    mcp: buildMcpRuntime(source, workspace.mcp),
    settings: buildSettingsRuntime(source, workspace, telemetrySettings),
    events: buildAppEventRuntime(workspace.mcp),
    bucketFailover: {
      resetBuckets: source.resetBuckets?.bind(source),
      resetBucketSession: source.resetBucketSession?.bind(source),
      ensureBucketsAuthenticated:
        source.ensureBucketsAuthenticated?.bind(source),
      readFailoverBuckets: source.readFailoverBuckets?.bind(source),
      readCurrentBucket: source.readCurrentBucket?.bind(source),
    },
    checkpoint: {
      checkpoints: workspace.workspace.checkpoints,
      getCheckpointingEnabled: () => source.getCheckpointingEnabled(),
    },
    sessionLimits: { getMaxSessionTurns: () => source.getMaxSessionTurns() },
    interactive: { isInteractive: () => source.isInteractive() },
    ephemeral: {
      getEphemeralSetting: (key) => workspace.getEphemeralSetting(key),
    },
    projectTempDir: source.projectTempDir,
    projectChatsDir: source.projectChatsDir,
    projectCheckpointsDir: source.projectCheckpointsDir,
    historyFilePath: source.historyFilePath,
    userCommandsDir: source.userCommandsDir,
    projectCommandsDir: source.projectCommandsDir,
  };
}

function buildUiWorkspaceRuntime(
  source: UiRuntimeDeclarationSource,
  workspace: Parameters<typeof buildStreamWorkspaceRuntime>[1] &
    Pick<Agent, 'getApprovalMode' | 'setApprovalMode'> & {
      tools: Pick<Agent['tools'], 'get'>;
    },
  bucketFailover?: BucketFailoverRuntime,
  telemetrySettings?: SessionSettingsOwner,
): Omit<UiRuntime, 'agentClientSource'> {
  return {
    ...buildStreamWorkspaceRuntime(source, workspace, telemetrySettings),
    ...(bucketFailover ? { bucketFailover } : {}),
    approval: {
      getApprovalMode: () => workspace.getApprovalMode(),
      setApprovalMode: (mode) => workspace.setApprovalMode(mode),
      getCoreTools: () => source.getCoreTools(),
      getExcludeTools: () => source.getExcludeTools(),
    },
    extensions: {
      getExtensions: () => source.getExtensions(),
      isExtensionEnabled: (extensionName) =>
        source.isExtensionEnabled(extensionName),
      extensionEnablementManager: source.extensionEnablementManager,
    },
    app: {
      getAccessibility: () => source.getAccessibility(),
      getScreenReader: () => source.getScreenReader(),
      getDebugMode: () => source.getDebugMode(),
      isRestrictiveSandbox: () => source.isRestrictiveSandbox(),
      isTrustedFolder: () => workspace.ide.isTrustedFolder(),
      setTrustedFolderLive: (trusted) =>
        workspace.ide.setTrustedFolderLive(trusted),
      getFolderTrust: () => source.getFolderTrust(),
      getQuestion: () => source.getQuestion(),
      getConversationLogPath: () => source.getConversationLogPath(),
      getEnablePromptCompletion: () => source.getEnablePromptCompletion(),
      getUtilityModel: () => source.getUtilityModel(),
      isJitContextEnabled: () => source.isJitContextEnabled(),
      getEphemeralSettings: () => workspace.getEphemeralSettings(),
      setEphemeralSetting: (key, value) =>
        workspace.setEphemeralSetting(key, value),
      getSubagentManager: () => workspace.workspace.subagentDefinitions,
      // @plan PLAN-20260731-GHBROKER.P16
      githubCompletion: {
        readReport: async (op, params, signal) =>
          readGitHubCompletionReport(
            workspace.tools.get('github'),
            op,
            params,
            signal,
          ),
      },
      updateSystemInstructionIfInitialized: () =>
        source.updateSystemInstructionIfInitialized(),
    },
  };
}

export function buildUiRuntimeFromSource(
  source: UiRuntimeDeclarationSource,
  agent: Pick<
    Agent,
    | 'agentClient'
    | 'ide'
    | 'getApprovalMode'
    | 'setApprovalMode'
    | 'sessionClient'
    | 'hooks'
    | 'workspace'
    | 'memory'
    | 'getModel'
    | 'getProvider'
    | 'getEphemeralSetting'
    | 'getEphemeralSettings'
    | 'setEphemeralSetting'
    | 'getActiveProfileName'
    | 'onStats'
  > & {
    tools: Pick<Agent['tools'], 'get'>;
    mcp: McpUiSelection;
  },
  bucketFailover?: BucketFailoverRuntime,
  telemetrySettings?: SessionSettingsOwner,
): UiRuntime {
  return {
    ...buildUiWorkspaceRuntime(
      source,
      agent,
      bucketFailover,
      telemetrySettings,
    ),
    agentClientSource: buildAgentClientSource(agent),
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
  source: UiRuntimeDeclarationSource,
  agent: Parameters<typeof buildUiWorkspaceRuntime>[1] & {
    tools: Pick<Agent['tools'], 'describeConfiguration' | 'get'>;
    mcp: McpUiSelection;
  },
  perfSnapshotCapability?: PerfSnapshotCapability | null,
  sessionPersistence?: CliSessionPersistencePort,
  bucketFailover?: BucketFailoverRuntime,
  skillOperations?: Pick<
    WorkspaceSkillOperations,
    'list' | 'find' | 'reload' | 'isAdminEnabled'
  >,
  restartExtension?: (extension: LlxprtExtension) => Promise<void>,
  telemetrySettings?: SessionSettingsOwner,
): CliUiRuntime {
  // Non-slice members must be destructured out and re-attached explicitly.
  // The spread below only flattens capability SLICE OBJECTS; a member whose
  // value is a bare function (or any non-object) contributes no own enumerable
  // properties to Object.assign and would be dropped silently.
  const {
    projectTempDir,
    projectChatsDir,
    projectCheckpointsDir,
    historyFilePath,
    userCommandsDir,
    projectCommandsDir,
    ...capabilities
  } = buildUiWorkspaceRuntime(source, agent, bucketFailover, telemetrySettings);
  // This flattening assumes every capability object exposes unique property
  // names. If a future capability overlaps an existing one, Object.assign will
  // keep the last value silently, so add an explicit test when adding slices.
  return Object.assign(
    {},
    ...Object.values(capabilities),
    {
      projectTempDir,
      projectChatsDir,
      projectCheckpointsDir,
      historyFilePath,
      userCommandsDir,
      projectCommandsDir,
      describeToolConfiguration: () => agent.tools.describeConfiguration(),
    },
    restartExtension !== undefined ? { restartExtension } : {},
    skillOperations !== undefined ? { skillOperations } : {},
    sessionPersistence !== undefined ? { sessionPersistence } : {},
    perfSnapshotCapability !== undefined && perfSnapshotCapability !== null
      ? { getPerfSnapshotCapability: () => perfSnapshotCapability }
      : {},
  );
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
  listPrompts: WorkspacePromptSelection['listPrompts'];
  listResources: WorkspaceResourceSelection['listResources'];
}

/**
 * Structural composition of all focused capability interfaces. This is NOT a
 * flat god-object — it is a type-level intersection of focused read-models.
 * The bootstrap runtime satisfies it structurally at runtime. Used by broader UI
 * hooks (slash commands, at-completion, tool dialog, etc.) that have not yet
 * been migrated to the nested UiRuntime pattern. The streaming path and
 * AppContainer MUST NOT use this type — they use StreamRuntime/UiRuntime.
 */
export type CliUiRuntime = UiRuntimeBareSource &
  CheckpointRuntime &
  ToolRuntime &
  McpState &
  FileWorkspaceState &
  MemoryState & {
    readonly restartExtension?: (extension: LlxprtExtension) => Promise<void>;
    readonly skillOperations?: Pick<
      WorkspaceSkillOperations,
      'list' | 'find' | 'reload' | 'isAdminEnabled'
    >;
    readonly sessionPersistence?: CliSessionPersistencePort;
  };
