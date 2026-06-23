/**
 * @plan:PLAN-20260617-COREAPI.P05
 * @requirement:REQ-001, REQ-017
 * @plan:PLAN-20260621-COREAPIREMED.P06
 */

import type { Content } from '@google/genai';
import type { UserTierId } from '@vybestack/llxprt-code-core/code_assist/types.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  ApprovalMode,
  Config,
  MCPServerConfig,
} from '@vybestack/llxprt-code-core/config/config.js';
import type {
  HookEventName,
  HookInput,
  HookOutput,
} from '@vybestack/llxprt-code-core/hooks/types.js';
import type { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
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

export interface McpServerAuthStatus {
  readonly server: string;
  readonly authenticated: boolean;
  readonly requiresAuth: boolean;
  readonly authUrl?: string;
}

export interface McpStatus {
  readonly discoveryState: McpDiscoveryState;
  readonly servers: readonly McpServerInfo[];
}

export interface AuthBucket {
  readonly name: string;
  readonly provider?: string;
  readonly baseUrl?: string;
  readonly active: boolean;
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

export interface AgentToolControl {
  list(): readonly ToolInfo[];
  setEnabled(names: readonly string[]): Promise<void>;
  onConfirmationRequest(cb: (req: ToolConfirmation) => void): Unsubscribe;
  respondToConfirmation(confirmationId: string, decision: ToolDecision): void;
  onToolUpdate(cb: (u: ToolUpdate) => void): Unsubscribe;
  setEditorCallbacks(cbs: EditorCallbacks): void;
}

export interface AgentMcpControl {
  listServers(): readonly McpServerInfo[];
  status(): McpStatus;
  toolsByServer(): Readonly<Record<string, readonly ToolInfo[]>>;
  auth(server: string): Promise<McpServerAuthStatus>;
  discoveryState(): McpDiscoveryState;
  refresh(server?: string): Promise<void>;
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
   * Returns the bound runtime-context runtimeId (REQ-005.1).
   * @plan:PLAN-20260621-COREAPIREMED.P18
   * @requirement:REQ-005
   */
  getRuntimeId(): string;
  getConfig(): Config;
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

export type { ApprovalMode };
