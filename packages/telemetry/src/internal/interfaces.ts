/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Structural interfaces owned by the telemetry package to avoid
 * circular dependencies on core. Core's Config structurally satisfies
 * TelemetryConfig; consumers may also implement TelemetryConfig directly.
 */

// ---------------------------------------------------------------------------
// TelemetryConfig — subset of core Config used by telemetry loggers/metrics
// ---------------------------------------------------------------------------

/**
 * Minimal config for session-scoped telemetry. Only `getSessionId` is required.
 */
export interface SessionConfig {
  getSessionId(): string;
}

/**
 * Config needed for functions that conditionally log prompts.
 */
export interface TelemetryPromptConfig extends SessionConfig {
  getTelemetryLogPromptsEnabled(): boolean;
}

/**
 * Config for tool-call telemetry (session id + prompt logging).
 */
export interface ToolLoggingConfig extends SessionConfig {
  getTelemetryLogPromptsEnabled(): boolean;
}

/**
 * Full telemetry config. Core's `Config` satisfies this interface structurally.
 * Adding new methods here is safe as long as the implementing class provides them.
 */
export interface TelemetryConfig extends SessionConfig {
  getTelemetryEnabled(): boolean;
  getTelemetryLogPromptsEnabled(): boolean;
  getTelemetryOutfile(): string | undefined;
  getTelemetryTarget(): string;
  getTelemetryOtlpEndpoint(): string;
  getDebugMode(): boolean;
  getConversationLoggingEnabled(): boolean;
  getSessionId(): string;
  getModel(): string;
  getEmbeddingModel(): string | undefined;
  getSandbox(): unknown;
  getCoreTools(): string[] | undefined;
  getApprovalMode(): string;
  getContentGeneratorConfig(): ContentGeneratorConfig | undefined;
  getFileFilteringRespectGitIgnore(): boolean;
  getMcpServers(): Record<string, unknown> | undefined;
}

/**
 * Subset of content generator config used by StartSessionEvent.
 */
export interface ContentGeneratorConfig {
  model?: string;
  apiKey?: string;
  vertexai?: boolean;
}

// ---------------------------------------------------------------------------
// DiffStat — structural equivalent of core's DiffStat
// ---------------------------------------------------------------------------

export interface DiffStat {
  ai_added_lines: number;
  ai_removed_lines: number;
  user_added_lines: number;
  user_removed_lines: number;
}

// ---------------------------------------------------------------------------
// ToolConfirmationOutcome — structural equivalent
// ---------------------------------------------------------------------------

export enum ToolConfirmationOutcome {
  ProceedOnce = 'proceed_once',
  ProceedAlways = 'proceed_always',
  ProceedAlwaysAndSave = 'proceed_always_and_save',
  ProceedAlwaysServer = 'proceed_always_server',
  ProceedAlwaysTool = 'proceed_always_tool',
  ModifyWithEditor = 'modify_with_editor',
  SuggestEdit = 'suggest_edit',
  Cancel = 'cancel',
}

// ---------------------------------------------------------------------------
// ToolCall types — structural interfaces for telemetry event construction
// ---------------------------------------------------------------------------

export interface ToolCallRequest {
  name: string;
  args: Record<string, unknown>;
  callId: string;
  isClientInitiated: boolean;
  prompt_id: string;
  agentId?: string;
}

export interface ToolCallError {
  name?: string;
  message?: string;
}

export interface ToolCallResponse {
  callId: string;
  responseParts?: unknown[];
  resultDisplay?: unknown;
  error?: ToolCallError;
  errorType?: string;
  agentId?: string;
}

export interface ToolLike {
  serverName?: unknown;
  serverToolName?: unknown;
  [key: string]: unknown;
}

export interface CompletedToolCallShape {
  status: string;
  request: ToolCallRequest;
  response: ToolCallResponse;
  tool?: ToolLike | unknown;
  durationMs?: number;
  outcome?: ToolConfirmationOutcome;
}

// ---------------------------------------------------------------------------
// Hook types — structural equivalents for HookCallEvent
// ---------------------------------------------------------------------------

export enum HookEventName {
  BeforeTool = 'BeforeTool',
  AfterTool = 'AfterTool',
  BeforeAgent = 'BeforeAgent',
  Notification = 'Notification',
  AfterAgent = 'AfterAgent',
  SessionStart = 'SessionStart',
  SessionEnd = 'SessionEnd',
  PreCompress = 'PreCompress',
  BeforeModel = 'BeforeModel',
  AfterModel = 'AfterModel',
  BeforeToolSelection = 'BeforeToolSelection',
}

export interface HookInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: string;
  timestamp: string;
}

export interface HookConfig {
  type: string;
  command: string;
  name?: string;
}

export interface HookExecutionResult {
  hookConfig: HookConfig;
  eventName: HookEventName;
  success: boolean;
  output?: Record<string, unknown> | unknown;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  duration: number;
  error?: Error;
}
