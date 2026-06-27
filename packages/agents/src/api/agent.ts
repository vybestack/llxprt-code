/**
 * @plan:PLAN-20260617-COREAPI.P05
 * @requirement:REQ-001, REQ-017
 * @plan:PLAN-20260621-COREAPIREMED.P06
 */

import type { Content, Part } from '@google/genai';
import type { UserTierId } from '@vybestack/llxprt-code-core/code_assist/types.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  ApprovalMode,
  MCPServerConfig,
} from '@vybestack/llxprt-code-core/config/config.js';
import type {
  HookEventName,
  HookInput,
  HookOutput,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import type {
  ToolConfirmationOutcome,
  ToolConfirmationPayload,
} from '@vybestack/llxprt-code-tools';
import type { PolicyDecision } from '@vybestack/llxprt-code-core';
// @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-004 @pseudocode agents-projection.md line 95
import type { McpOAuthStatus } from '@vybestack/llxprt-code-core';
import type { EditorCallbacks } from './config-types.js';
import type {
  AgentEvent,
  AgentToolCall,
  DoneReason,
  ToolConfirmation,
  ToolUpdate,
} from './event-types.js';

export type Unsubscribe = () => void;

export type AgentMessage = Content;
export type AgentHistoryItem = IContent;

export type AgentInput =
  | string
  | readonly Part[]
  | Readonly<{ readonly text: string; readonly role?: 'user' | 'system' }>;

export type McpDiscoveryMode = 'await' | 'skip';

export type AuthStatus =
  | 'authenticated'
  | 'unauthenticated'
  | 'expired'
  | 'unknown';

export type AgentErrorCode =
  | 'mcp_discovery_failed'
  | 'provider_error'
  | 'tool_error'
  | 'auth_error'
  | 'unknown';

export interface AgentError {
  readonly code: AgentErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export interface TurnOptions {
  readonly signal?: AbortSignal;
  readonly promptId?: string;
  readonly maxTurns?: number;
  readonly mcpDiscovery?: McpDiscoveryMode;
}

export interface GenerateOptions {
  readonly model?: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly signal?: AbortSignal;
  readonly promptId?: string;
  readonly readHistory?: boolean;
  readonly writeHistory?: boolean;
}

export interface SessionStats {
  readonly promptTokens: number;
  readonly candidateTokens: number;
  readonly totalTokens: number;
  readonly cachedTokens: number;
  readonly contextWindowSize: number;
  readonly contextWindowUsed: number;
  readonly turnCount: number;
}

export interface AgentResult {
  readonly text: string;
  readonly toolCalls: readonly AgentToolCall[];
  readonly finishReason: DoneReason;
  readonly error?: AgentError;
  readonly usage?: SessionStats;
}

export interface CompressionResult {
  readonly status: 'compressed' | 'skipped' | 'failed';
  readonly originalTokenCount?: number;
  readonly newTokenCount?: number;
  readonly promptId?: string;
}

export interface ProviderInfo {
  readonly name: string;
  readonly displayName?: string;
  readonly configured: boolean;
  readonly authType?: string;
  readonly baseUrl?: string;
}

export interface ToolInfo {
  readonly name: string;
  readonly description?: string;
  readonly source: 'builtin' | 'mcp' | 'extension' | 'skill';
  readonly server?: string;
  readonly enabled: boolean;
}

export interface ProviderStatus {
  readonly provider: string;
  readonly model: string;
  readonly authStatus: AuthStatus;
  readonly baseUrl?: string;
  readonly keyName?: string;
  readonly keyFile?: string;
  readonly oauthEnabled?: boolean;
}

export type ToolDecision = ToolConfirmationOutcome;
export type ToolDecisionPayload = ToolConfirmationPayload;

export type McpDiscoveryState =
  | 'idle'
  | 'pending'
  | 'ready'
  | 'partial'
  | 'failed';

export interface McpServerInfo {
  readonly name: string;
  readonly config: MCPServerConfig;
  readonly status:
    | 'connected'
    | 'connecting'
    | 'disconnected'
    | 'error'
    | 'disabled';
  readonly tools?: readonly string[];
  readonly transport?: string;
}

// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
// @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-004 @pseudocode agents-projection.md line 93
export interface McpServerAuthStatus {
  readonly server: string;
  readonly authenticated: boolean; // corrected: oauthStatus === 'authenticated'
  readonly requiresAuth: boolean; // corrected: real per-server
  readonly oauthStatus: McpOAuthStatus;
  readonly sessionAuthenticated: boolean;
  readonly authUrl?: string;
}

export interface McpStatus {
  readonly discoveryState: McpDiscoveryState;
  readonly servers: readonly McpServerInfo[];
}

// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
export interface McpDetailsOptions {
  readonly includeTools?: boolean;
  readonly includePrompts?: boolean;
  readonly includeResources?: boolean;
}

// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
export interface McpPromptInfo {
  readonly name: string;
  readonly description?: string;
}

// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
export interface McpResourceInfo {
  readonly name?: string;
  readonly uri: string;
}

// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
export interface McpBlockedServer {
  readonly name: string;
  readonly extensionName: string;
}

// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
// @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-003,REQ-004 @pseudocode agents-projection.md line 94
export interface McpServerDetail {
  readonly name: string;
  readonly authenticated: boolean; // corrected
  readonly requiresAuth: boolean;
  readonly oauthStatus: McpOAuthStatus;
  readonly sessionAuthenticated: boolean;
  readonly tools?: readonly ToolInfo[];
  readonly prompts?: readonly McpPromptInfo[];
  readonly resources?: readonly McpResourceInfo[];
}

// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
export interface McpDetailStatus {
  readonly servers: readonly McpServerDetail[];
  readonly blockedServers: readonly McpBlockedServer[];
}

export interface AuthBucket {
  readonly name: string;
  readonly provider?: string;
  readonly baseUrl?: string;
  readonly active: boolean;
}

// @plan:PLAN-20260622-COREAPIGAP.P12 @requirement:REQ-005
export interface AuthProviderDetail {
  readonly provider: string;
  readonly authenticated: boolean;
  readonly oauthEnabled: boolean;
  readonly expiry?: number;
}

// @plan:PLAN-20260622-COREAPIGAP.P12 @requirement:REQ-005
export interface AuthBucketStatus {
  readonly bucket: string;
  readonly authenticated: boolean;
  readonly expiry?: number;
  readonly isSessionBucket: boolean;
}

export interface KeyInfo {
  readonly name: string;
  readonly provider?: string;
}

export interface IdeInfo {
  readonly name: string;
  readonly version?: string;
  readonly trusted: boolean;
}

export interface IdeStatus {
  readonly current: IdeInfo | null;
  readonly detected: readonly IdeInfo[];
  readonly modeEnabled: boolean;
}

export interface SessionCheckpoint {
  readonly id: string;
  readonly createdAt: string;
  readonly label?: string;
  readonly messageCount: number;
}

export interface SessionRecordingState {
  readonly enabled: boolean;
  readonly path?: string;
  readonly format?: string;
}

export interface ProfileSummary {
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  readonly isDefault: boolean;
  readonly isLoadBalancer?: boolean;
}

export interface ProfileDetail extends ProfileSummary {
  readonly modelParams?: Readonly<Record<string, unknown>>;
  readonly baseUrl?: string;
  readonly authKeyName?: string;
  readonly authKeyFile?: string;
}

export interface HookExecutionRequest {
  readonly event: HookEventName;
  readonly input: HookInput;
}

export interface HookExecutionResponse {
  readonly event: HookEventName;
  readonly output: HookOutput;
}

// @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
export interface ToolKeyInfo {
  readonly toolName: string;
  readonly displayName: string;
  readonly description?: string;
}

// @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
export interface ToolKeyStatus {
  readonly toolName: string;
  readonly hasKey: boolean;
  readonly maskedKey?: string;
  readonly keyFile?: string;
}

// @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
export interface AgentToolKeyControl {
  supported(): readonly ToolKeyInfo[];
  status(toolName: string): Promise<ToolKeyStatus>;
  save(toolName: string, key: string): Promise<void>;
  delete(toolName: string): Promise<void>;
  setKeyFile(toolName: string, path: string | null): Promise<void>;
  getKeyFile(toolName: string): Promise<string | null>;
}

export interface AgentToolControl {
  list(): readonly ToolInfo[];
  setEnabled(names: readonly string[]): Promise<void>;
  onConfirmationRequest(cb: (req: ToolConfirmation) => void): Unsubscribe;
  respondToConfirmation(
    confirmationId: string,
    decision: ToolDecision,
    payload?: ToolDecisionPayload,
    requiresUserConfirmation?: boolean,
  ): void;
  onToolUpdate(cb: (u: ToolUpdate) => void): Unsubscribe;
  setEditorCallbacks(cbs: EditorCallbacks): void;
  // @plan:PLAN-20260622-COREAPIGAP.P16 @requirement:REQ-007
  readonly keys: AgentToolKeyControl;
}

export interface AgentMcpControl {
  listServers(): readonly McpServerInfo[];
  status(): McpStatus;
  toolsByServer(): Readonly<Record<string, readonly ToolInfo[]>>;
  auth(server: string): Promise<McpServerAuthStatus>;
  discoveryState(): McpDiscoveryState;
  refresh(server?: string): Promise<void>;
  // @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
  authenticate(server: string): Promise<McpServerAuthStatus>;
  // @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
  details(opts?: McpDetailsOptions): Promise<McpDetailStatus>;
}

export interface AgentAuthKeysControl {
  list(): Promise<readonly KeyInfo[]>;
  save(
    name: string,
    apiKey: string,
    opts?: { readonly provider?: string },
  ): Promise<void>;
  use(name: string, opts?: { readonly provider?: string }): Promise<void>;
  delete(name: string, opts?: { readonly provider?: string }): Promise<void>;
  setRaw(
    apiKey: string | null,
    opts?: { readonly provider?: string },
  ): Promise<void>;
  setKeyFile(
    path: string | null,
    opts?: { readonly provider?: string },
  ): Promise<void>;
}

export interface AgentAuthControl {
  login(provider: string, opts?: { readonly bucket?: string }): Promise<void>;
  logout(
    provider: string,
    opts?: { readonly bucket?: string; readonly all?: boolean },
  ): Promise<void>;
  status(provider?: string): AuthStatus;
  enableOAuth(provider: string): Promise<void>;
  disableOAuth(provider: string): Promise<void>;
  listBuckets(provider?: string): readonly AuthBucket[];
  switchBucket(provider: string, bucket: string): Promise<void>;
  mcpLogin(server: string): Promise<void>;
  readonly keys: AgentAuthKeysControl;
  setBaseUrl(
    baseUrl: string | null,
    opts?: { readonly provider?: string },
  ): Promise<void>;
  // @plan:PLAN-20260622-COREAPIGAP.P12 @requirement:REQ-005
  detailedStatus(provider: string): Promise<AuthProviderDetail>;
  getHigherPriorityAuth(provider: string): Promise<string | null>;
  listBucketStatuses(provider: string): Promise<readonly AuthBucketStatus[]>;
}

export interface AgentIdeControl {
  current(): IdeInfo | null;
  detected(): readonly IdeInfo[];
  trust(name: string): Promise<void>;
  status(): IdeStatus;
  openEditor(): Promise<void>;
  closeEditor(): Promise<void>;
}

export interface AgentSessionControl {
  resume(
    target: 'latest' | string,
    options?: { readonly prefix?: boolean },
  ): Promise<void>;
  createCheckpoint(label?: string): Promise<SessionCheckpoint>;
  restoreCheckpoint(id: string): Promise<void>;
  listCheckpoints(): readonly SessionCheckpoint[];
  setRecording(state: SessionRecordingState): Promise<void>;
  getRecording(): SessionRecordingState;
}

export interface AgentProfileControl {
  list(): readonly ProfileSummary[];
  get(name: string): ProfileDetail | undefined;
  create(
    name: string,
    detail: Readonly<Omit<ProfileDetail, 'isDefault' | 'isLoadBalancer'>>,
  ): Promise<void>;
  saveCurrent(name: string): Promise<void>;
  delete(name: string): Promise<void>;
  apply(name: string): Promise<void>;
  setDefault(name: string): Promise<void>;
  getDefault(): ProfileSummary | undefined;
}

export interface AgentHookControl {
  onHookExecution(
    cb: (req: HookExecutionRequest, resp: HookExecutionResponse) => void,
  ): Unsubscribe;
  triggerSessionStart(): Promise<void>;
  triggerSessionEnd(): Promise<void>;
  clear(): void;
  // @plan:PLAN-20260622-COREAPIGAP.P10 @requirement:REQ-004
  listHooks(): readonly HookInfo[];
  getDisabledHooks(): readonly string[];
  setDisabledHooks(names: readonly string[]): void;
  enable(name: string): void;
  disable(name: string): void;
}

/**
 * Projected public view of a registered hook (REQ-004.1). Mirrors a live
 * HookRegistryEntry's identifying fields without exposing the engine type.
 * @plan:PLAN-20260622-COREAPIGAP.P10
 * @requirement:REQ-004
 */
export interface HookInfo {
  readonly name: string;
  readonly eventName: string;
  readonly enabled: boolean;
  readonly source?: string;
}

/**
 * Read-only projection of a policy rule (REQ-002.1). `argsPattern` is the
 * RegExp source STRING (JSON-safe), never a RegExp.
 * @plan:PLAN-20260622-COREAPIGAP.P06
 * @requirement:REQ-002
 */
export interface PolicyRuleView {
  readonly priority?: number;
  readonly toolName?: string;
  readonly decision: PolicyDecision;
  readonly argsPattern?: string;
  readonly source?: string;
}

/**
 * Read-only inspection of the engine policy (REQ-002).
 * @plan:PLAN-20260622-COREAPIGAP.P06
 * @requirement:REQ-002
 */
export interface AgentPolicyControl {
  getRules(): readonly PolicyRuleView[];
  getDefaultDecision(): PolicyDecision;
  isNonInteractive(): boolean;
}

/**
 * Projected public view of an async task. OMITS abortController and any
 * non-serializable internal (REQ-003.7).
 * @plan:PLAN-20260622-COREAPIGAP.P08
 * @requirement:REQ-003
 */
export interface AgentTaskInfo {
  readonly id: string;
  readonly subagentName: string;
  readonly goalPrompt: string;
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled';
  readonly launchedAt: number;
  readonly completedAt?: number;
  readonly error?: string;
}

/**
 * Undefined-safe async-task administration (REQ-003).
 * @plan:PLAN-20260622-COREAPIGAP.P08
 * @requirement:REQ-003
 */
export interface AgentTasksControl {
  list(): readonly AgentTaskInfo[];
  listRunning(): readonly AgentTaskInfo[];
  get(id: string): AgentTaskInfo | undefined;
  cancel(id: string): boolean;
  cancelAllRunning(): number;
}

/**
 * Runtime memory operations (REQ-010). Backed by Config memory methods so
 * clients no longer need raw Config escape hatches for memory access.
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P02
 */
export interface MemoryRefreshResult {
  readonly memoryContent: string;
  readonly fileCount: number;
  readonly filePaths: readonly string[];
}

export interface MemoryChangedEvent {
  readonly fileCount: number;
  readonly coreMemoryFileCount?: number;
}

export interface AgentMemoryControl {
  getMemory(): string;
  setMemory(content: string): void;
  getFileCount(): number;
  getFilePaths(): readonly string[];
  getCoreMemory(): string | undefined;
  getCoreFileCount(): number;
  setCoreMemory(content: string): void;
  refresh(): Promise<MemoryRefreshResult>;
  onMemoryChanged(cb: (event: MemoryChangedEvent) => void): Unsubscribe;
}

/**
 * Projected public view of a discovered skill.
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P03
 */
export interface SkillInfo {
  readonly name: string;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly source?: string;
  readonly location?: string;
}

/**
 * Skills query/reload operations (REQ-013). Backed by Config.getSkillManager()
 * so clients no longer need raw Config for skill queries.
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P03
 */
export interface AgentSkillsControl {
  list(opts?: { readonly includeDisabled?: boolean }): readonly SkillInfo[];
  get(name: string): SkillInfo | undefined;
  reload(): Promise<void>;
  isAdminEnabled(): boolean;
}

/**
 * Narrow read-only/modifying workspace accessors (REQ-001). Backed by
 * Config.getWorkspaceContext()/getTargetDir()/getProjectRoot() so clients
 * no longer need raw Config for workspace queries.
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P04
 */
export interface AgentWorkspaceControl {
  getDirectories(): readonly string[];
  addDirectory(path: string): void;
  getWorkingDirectory(): string;
  getProjectRoot(): string;
}

/**
 * Projected public view of an LSP server status. Mirrors the ide-integration
 * ServerStatus shape without leaking the raw LspServiceClient.
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P05
 */
export interface LspServerStatus {
  readonly serverId: string;
  readonly healthy: boolean;
  readonly detail?: string;
  readonly state?: 'ok' | 'broken' | 'starting' | 'idle';
  readonly status?: string;
}

/**
 * Public LSP status snapshot. `disabled` is true when LSP is not configured or
 * unavailable; `servers` is always an array (empty when no servers).
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P05
 */
export interface LspStatusSnapshot {
  readonly disabled: boolean;
  readonly servers: readonly LspServerStatus[];
  readonly unavailableReason?: string;
}

/**
 * Read-only LSP status inspection (REQ-010). Backed by
 * Config.getLspConfig()/getLspServiceClient() so clients no longer need
 * raw Config for LSP status.
 * @plan:PLAN-20260626-RUNTIMEBOUNDARY.P05
 */
export interface AgentLspControl {
  status(): Promise<LspStatusSnapshot>;
}

export interface Agent {
  chat(input: AgentInput, opts?: TurnOptions): Promise<AgentResult>;
  stream(input: AgentInput, opts?: TurnOptions): AsyncIterable<AgentEvent>;

  getProvider(): string;
  setProvider(provider: string, model?: string): Promise<void>;
  getProviderStatus(): ProviderStatus;
  getModel(): string;
  setModel(model: string): Promise<void>;
  getCurrentSequenceModel(): string | null;
  /**
   * Reads the live approval mode from the bound Config (no caching).
   * @plan:PLAN-20260622-COREAPIGAP.P04
   * @requirement:REQ-001
   */
  getApprovalMode(): ApprovalMode;
  /**
   * Sets the approval mode via the bound Config. Delegates directly: the
   * untrusted-folder guard throw (config.ts:404) propagates unchanged.
   * @plan:PLAN-20260622-COREAPIGAP.P04
   * @requirement:REQ-001
   */
  setApprovalMode(mode: ApprovalMode): void;
  /**
   * Returns the bound runtime-context runtimeId (REQ-005.1).
   * @plan:PLAN-20260621-COREAPIREMED.P18
   * @requirement:REQ-005
   */
  getRuntimeId(): string;
  /** @plan:PLAN-20260621-COREAPIREMED.P10 @requirement:REQ-002 */
  getEphemeralSetting(key: string): unknown;
  /** @plan:PLAN-20260621-COREAPIREMED.P10 @requirement:REQ-002 */
  setEphemeralSetting(key: string, value: unknown): void;
  /** @plan:PLAN-20260621-COREAPIREMED.P10 @requirement:REQ-002 */
  getEphemeralSettings(): Readonly<Record<string, unknown>>;
  getModelParams(): Readonly<Record<string, unknown>>;
  setModelParam(key: string, value: unknown): void;
  clearModelParam(key: string): void;
  getUserTier(): UserTierId | undefined;

  readonly profiles: AgentProfileControl;
  readonly tools: AgentToolControl;
  readonly mcp: AgentMcpControl;
  readonly auth: AgentAuthControl;
  readonly ide: AgentIdeControl;
  readonly session: AgentSessionControl;
  readonly hooks: AgentHookControl;
  readonly policy: AgentPolicyControl;
  /** @plan:PLAN-20260622-COREAPIGAP.P08 @requirement:REQ-003 */
  readonly tasks: AgentTasksControl;
  /** @plan:PLAN-20260626-RUNTIMEBOUNDARY.P02 */
  readonly memory: AgentMemoryControl;
  /** @plan:PLAN-20260626-RUNTIMEBOUNDARY.P03 */
  readonly skills: AgentSkillsControl;
  /** @plan:PLAN-20260626-RUNTIMEBOUNDARY.P04 */
  readonly workspace: AgentWorkspaceControl;
  /** @plan:PLAN-20260626-RUNTIMEBOUNDARY.P05 */
  readonly lsp: AgentLspControl;

  getHistory(): Promise<readonly AgentMessage[]>;
  setHistory(
    history: readonly AgentMessage[],
    opts?: { readonly stripThoughts?: boolean },
  ): Promise<void>;
  addHistory(message: AgentMessage): Promise<void>;
  restoreHistory(items: readonly AgentHistoryItem[]): Promise<void>;
  resetChat(): Promise<void>;
  updateSystemInstruction(): Promise<void>;
  addDirectoryContext(): Promise<void>;
  compress(opts?: { readonly promptId?: string }): Promise<CompressionResult>;
  getStats(): SessionStats;
  onStats(cb: (stats: SessionStats) => void): Unsubscribe;

  generate(input: AgentInput, opts?: GenerateOptions): Promise<string>;
  generateJson(
    contents: readonly AgentMessage[],
    schema: Readonly<Record<string, unknown>>,
    opts?: GenerateOptions,
  ): Promise<Record<string, unknown>>;
  generateEmbedding(texts: readonly string[]): Promise<number[][]>;

  listProviders(): readonly ProviderInfo[];
  listTools(): readonly ToolInfo[];

  dispose(): Promise<void>;
}

// @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-004 @pseudocode agents-projection.md line 95
export type { ApprovalMode };
export type { McpOAuthStatus };
