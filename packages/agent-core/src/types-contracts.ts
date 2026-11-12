/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentEvent, JournalRecord } from './types-events.js';

export type AgentId = string;
export type SessionId = string;
export type TurnId = string;
export type AttemptId = string;
export type CallId = string;
export type RequestId = string;
export type CommandId = string;
export type CheckpointId = string;
export type Sequence = number;
export type RuleId = string;
export type GrantId = string;
export type PreparedToken = string;
export type BlobRef = string;
export type ToolId = string;
export type ModelRef = { readonly provider: string; readonly model: string };
export type Effect = 'read' | 'write' | 'execute' | 'network' | 'spawn';
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
export type JsonSchema = Readonly<Record<string, JsonValue>>;

export interface InstructionBlock {
  readonly id: string;
  readonly source: string;
  readonly text: string;
}
export type ContentPart =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'image' | 'audio';
      readonly mediaType: string;
      readonly data: Uint8Array | { readonly ref: BlobRef };
    }
  | {
      readonly kind: 'file';
      readonly name: string;
      readonly mediaType: string;
      readonly text?: string;
      readonly ref?: BlobRef;
    }
  | {
      readonly kind: 'resource';
      readonly uri: string;
      readonly title?: string;
      readonly parts: readonly ContentPart[];
    };
export interface UserInput {
  readonly parts: readonly ContentPart[];
}
export interface ContextItem {
  readonly id: string;
  readonly source: string;
  readonly trust: 'trusted' | 'untrusted';
  readonly lifetime: 'next-turn' | 'until-replaced' | 'session';
  readonly parts: readonly ContentPart[];
}
export interface ContextStrategy {
  readonly compactAtRatio: number;
  readonly keepRecentTurns: number;
  readonly summarizer: 'active-model' | { readonly ref: ModelRef };
}
export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly backoffMs: readonly number[];
}
export interface LoopDetection {
  readonly maxIdenticalCalls: number;
  readonly maxStepsWithoutProgress: number;
}
export interface ModelParameters {
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly reasoning?: {
    readonly effort?: 'low' | 'medium' | 'high';
    readonly budgetTokens?: number;
  };
  readonly extra?: Readonly<Record<string, string | number | boolean>>;
}
export interface ModelChoice {
  readonly ref: ModelRef;
  readonly parameters: ModelParameters;
}
export interface ModelSelection {
  readonly primary: ModelChoice;
  readonly fallbacks: readonly ModelChoice[];
  readonly fallbackOn: readonly ModelErrorKind[];
}
export interface Limits {
  readonly maxStepsPerTurn: number;
  readonly turnTokenBudget?: number;
  readonly turnCostBudget?: number;
  readonly turnTimeoutMs?: number;
  readonly maxParallelChildren: number;
  readonly decisionTimeoutMs?: number;
}
export interface ToolOutputLimits {
  readonly maxResultBytes: number;
  readonly maxStepResultBytes: number;
  readonly truncation: 'head' | 'tail' | 'head-and-tail';
}
export interface PolicyMatch {
  readonly tools?: readonly string[];
  readonly effects?: readonly Effect[];
  readonly args?: readonly ArgMatcher[];
}
export type ArgMatcher =
  | { readonly arg: string; readonly pathUnder: string }
  | { readonly arg: string; readonly commandPrefix: readonly string[] }
  | {
      readonly arg: string;
      readonly equals: string | number | boolean;
    }
  | { readonly arg: string; readonly urlHost: readonly string[] };
export interface PolicyRule {
  readonly id: RuleId;
  readonly match: PolicyMatch;
  readonly outcome: 'allow' | 'deny' | 'ask';
  readonly reason?: string;
}
export interface PolicyLayer {
  readonly name: string;
  readonly rules: readonly PolicyRule[];
}
export interface PolicyDocument {
  readonly authority: readonly PolicyRule[];
  readonly preferences: readonly PolicyLayer[];
  readonly fallback: 'allow' | 'deny' | 'ask';
}
export interface SubagentTemplate {
  readonly name: string;
  readonly instructions: readonly InstructionBlock[];
  readonly tools: readonly ToolId[];
  readonly policy: PolicyDocument;
  readonly limits: Limits;
}
export interface AgentDefinition {
  readonly name: string;
  readonly instructions: readonly InstructionBlock[];
  readonly model: ModelSelection;
  readonly tools: readonly ToolId[];
  readonly policy: PolicyDocument;
  readonly limits: Limits;
  readonly context: ContextStrategy;
  readonly retry: RetryPolicy;
  readonly loop: LoopDetection;
  readonly subagents: readonly SubagentTemplate[];
  readonly toolOutput: ToolOutputLimits;
}

export interface ReplayScope {
  readonly provider: string;
  readonly model: string;
  readonly endpoint: string;
  readonly principal: string;
  readonly connection?: string;
}
export interface ProviderReplayData {
  readonly id: string;
  readonly scope: ReplayScope;
  readonly format: string;
  readonly target:
    | { readonly kind: 'entry' }
    | { readonly kind: 'part'; readonly id: string };
  readonly data: JsonValue;
}
export type ToolOutcome =
  | { readonly status: 'ok'; readonly result: ToolResult }
  | {
      readonly status: 'error';
      readonly error: ToolError;
      readonly result?: ToolResult;
    }
  | { readonly status: 'stale' };
export type TranscriptPart =
  | { readonly id: string; readonly content: ContentPart }
  | { readonly id: string; readonly thinking: string }
  | {
      readonly id: string;
      readonly call: {
        readonly id: CallId;
        readonly tool: ToolId;
        readonly args: JsonValue;
      };
    }
  | {
      readonly id: string;
      readonly result: { readonly call: CallId; readonly outcome: ToolOutcome };
    };
export interface TranscriptEntry {
  readonly id: string;
  readonly role: 'user' | 'model' | 'tool';
  readonly parts: readonly TranscriptPart[];
  readonly replay?: readonly ProviderReplayData[];
}
export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheWriteInputTokens: number;
}
export type PartialUsage = Readonly<Partial<Usage>>;
export interface UsageReport {
  readonly totals: PartialUsage;
  readonly complete: boolean;
}
export interface ModelRecovery {
  readonly scope: ReplayScope;
  readonly invalidates: ReadonlyArray<{
    readonly entry: string;
    readonly replay: string;
  }>;
  readonly format: string;
  readonly data: JsonValue;
}
export type PreparedShell =
  | { readonly parsed: false; readonly command: string; readonly error: string }
  | {
      readonly parsed: true;
      readonly command: string;
      readonly segments: readonly ShellSegment[];
    };
export interface ShellSegment {
  readonly command: string;
  readonly argv: readonly string[];
  readonly hasRedirection: boolean;
}
export interface ToolResult {
  readonly parts: readonly ContentPart[];
  readonly truncated?: {
    readonly originalBytes: number;
    readonly kept: 'head' | 'tail' | 'head-and-tail';
  };
  readonly raw?: BlobRef;
}
export interface ToolProgress {
  readonly message?: string;
  readonly fraction?: number;
}
export interface ToolPreview {
  readonly title?: string;
  readonly content?: string;
}
export interface Precondition {
  readonly kind: string;
  readonly value: string;
}
export interface PreparedCall {
  readonly token: PreparedToken;
  readonly args: unknown;
  readonly preview?: ToolPreview;
  readonly preconditions?: readonly Precondition[];
  readonly shell?: PreparedShell;
}
export interface ToolDescriptor {
  readonly id: ToolId;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly effects: readonly Effect[];
  readonly concurrency: 'parallel' | 'exclusive';
  readonly resources?: readonly string[];
  readonly shell?: { readonly commandArg: string };
}
export interface ToolHandle {
  readonly descriptor: ToolDescriptor;
  prepare(args: unknown, signal: AbortSignal): Promise<PreparedCall>;
  execute(prepared: PreparedCall, context: ToolContext): Promise<ToolOutcome>;
}
export interface ToolSet {
  readonly tools: readonly ToolHandle[];
  readonly revoked: AbortSignal;
}
export interface ToolCatalog {
  pin(ids: readonly ToolId[], signal: AbortSignal): Promise<ToolSet>;
  subscribe?(onChange: (change: CatalogChange) => void): Unsubscribe;
}
export interface CatalogChange {
  readonly kind: 'added' | 'updated' | 'revoked';
  readonly tool: ToolId;
}
export type Unsubscribe = () => void;
export interface ToolContext {
  readonly signal: AbortSignal;
  readonly call: CallId;
  readonly output: BoundedWriter;
  progress(update: ToolProgress): void;
}
export interface BoundedWriter {
  write(chunk: Uint8Array): void;
  readonly bytesWritten: number;
}
export interface ModelClientInfo {
  readonly contextWindow: number;
  readonly maxOutputTokens: number;
  readonly tools: boolean;
  readonly reasoning: boolean;
  readonly modalities: ReadonlyArray<'text' | 'image' | 'audio' | 'file'>;
  readonly replayScope: ReplayScope;
}
export interface ModelRequest {
  readonly instructions: readonly InstructionBlock[];
  readonly messages: readonly TranscriptEntry[];
  readonly tools: ReadonlyArray<{
    readonly id: ToolId;
    readonly description: string;
    readonly inputSchema: JsonSchema;
  }>;
  readonly parameters: ModelParameters;
  readonly recovery?: ModelRecovery;
}
export type FinishReason = 'stop' | 'tool-calls' | 'length' | 'other';
export type ModelChunk =
  | {
      readonly kind: 'text' | 'thinking';
      readonly part: string;
      readonly delta: string;
    }
  | {
      readonly kind: 'tool-call';
      readonly id: CallId;
      readonly tool: ToolId;
      readonly argsDelta: string;
    }
  | { readonly kind: 'replay'; readonly value: ProviderReplayData }
  | { readonly kind: 'usage'; readonly report: UsageReport }
  | {
      readonly kind: 'finish';
      readonly reason: FinishReason;
      readonly usage: UsageReport;
    };
export type ModelErrorKind =
  | 'auth'
  | 'quota'
  | 'rate-limit'
  | 'overloaded'
  | 'invalid-request'
  | 'context-length'
  | 'network'
  | 'aborted'
  | 'other';
export interface ModelError {
  readonly kind: ModelErrorKind;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly message: string;
  readonly usage?: UsageReport;
  readonly dispatch: 'not-sent' | 'sent' | 'unknown';
  readonly recovery?: ModelRecovery;
}
export interface ModelClient {
  readonly info: ModelClientInfo;
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelChunk>;
  countTokens?(request: ModelRequest, signal: AbortSignal): Promise<number>;
  price?(usage: Usage): number;
}
export interface ModelPort {
  resolve(ref: ModelRef, signal: AbortSignal): Promise<ModelClient>;
}
export interface ToolError {
  readonly kind:
    | 'invalid-args'
    | 'failed'
    | 'aborted'
    | 'revoked'
    | 'unavailable';
  readonly message: string;
}
export interface StoreError {
  readonly kind: 'unavailable' | 'corrupt' | 'aborted';
  readonly message: string;
}
export interface SessionStore {
  append(
    session: SessionId,
    records: readonly JournalRecord[],
    signal: AbortSignal,
  ): Promise<void>;
  load(
    session: SessionId,
    signal: AbortSignal,
  ): Promise<readonly JournalRecord[]>;
  readonly blob?: {
    put(data: Uint8Array, signal: AbortSignal): Promise<BlobRef>;
    get(ref: BlobRef, signal: AbortSignal): Promise<Uint8Array>;
  };
}
export type GrantScope =
  | { readonly kind: 'exact'; readonly tool: ToolId; readonly args: unknown }
  | {
      readonly kind: 'tool-path';
      readonly tool: ToolId;
      readonly pathUnder: string;
    }
  | {
      readonly kind: 'tool-command';
      readonly tool: ToolId;
      readonly commandPrefix: readonly string[];
    }
  | { readonly kind: 'tool'; readonly tool: ToolId };
export interface Grant {
  readonly id: GrantId;
  readonly scope: GrantScope;
  readonly duration: 'turn' | 'session';
  readonly policyRevision: number;
}
export interface PreparedCallView {
  readonly tool: ToolId;
  readonly args: unknown;
  readonly preview?: ToolPreview;
  readonly shell?: PreparedShell;
}
export type DecisionRequest = {
  readonly id: RequestId;
  readonly from: AgentId;
  readonly turn: TurnId;
} & (
  | {
      readonly kind: 'tool-call';
      readonly call: PreparedCallView;
      readonly effects: readonly Effect[];
      readonly rule: RuleId;
      readonly scopes: readonly GrantScope[];
    }
  | {
      readonly kind: 'question';
      readonly prompt: string;
      readonly choices?: readonly string[];
    }
  | { readonly kind: 'plan'; readonly plan: string }
);
export type ToolCallResponse =
  | {
      readonly outcome: 'approve';
      readonly scope?: GrantScope;
      readonly duration?: 'turn' | 'session';
    }
  | { readonly outcome: 'approve-edited'; readonly args: unknown }
  | { readonly outcome: 'reject'; readonly message?: string };
export type QuestionResponse =
  | { readonly outcome: 'answer'; readonly text: string }
  | { readonly outcome: 'decline' };
export type PlanResponse =
  | { readonly outcome: 'approve' }
  | { readonly outcome: 'revise'; readonly feedback: string }
  | { readonly outcome: 'reject' };
export interface Unavailable {
  readonly outcome: 'unavailable';
}
export type ResponseFor<R extends DecisionRequest> = R extends {
  readonly kind: 'tool-call';
}
  ? ToolCallResponse
  : R extends { readonly kind: 'question' }
    ? QuestionResponse
    : R extends { readonly kind: 'plan' }
      ? PlanResponse
      : never;
export interface DecisionPort {
  readonly presence: 'human' | 'none';
  decide<R extends DecisionRequest>(
    request: R,
    signal: AbortSignal,
  ): Promise<ResponseFor<R> | Unavailable>;
}
export type DecidedBy =
  | 'policy'
  | 'human'
  | 'headless-rule'
  | 'timeout'
  | 'cancelled';
export type Resolution =
  | ToolCallResponse
  | QuestionResponse
  | PlanResponse
  | Unavailable;
export interface Clock {
  now(): number;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}
export interface DiagnosticRecord {
  readonly name: string;
  readonly at: number;
  readonly agent?: AgentId;
  readonly fields?: Readonly<Record<string, JsonValue>>;
}
export interface DiagnosticSink {
  emit(record: DiagnosticRecord): void;
}
export interface Interceptors {
  readonly deadlineMs: number;
  beforeTurn?(
    input: UserInput,
    signal: AbortSignal,
  ): Promise<
    Continue | Block | { readonly addContext: readonly ContextItem[] }
  >;
  beforeModel?(
    view: ModelRequestView,
    signal: AbortSignal,
  ): Promise<
    Continue | Block | { readonly addContext: readonly ContextItem[] }
  >;
  beforeTool?(
    call: PreparedCallView,
    signal: AbortSignal,
  ): Promise<Continue | Block | { readonly patchArgs: JsonPatch }>;
  afterTool?(
    call: PreparedCallView,
    result: ToolResult,
    signal: AbortSignal,
  ): Promise<
    Continue | { readonly redact: readonly Redaction[]; readonly note?: string }
  >;
  beforeCompact?(signal: AbortSignal): Promise<Continue | Block>;
  afterTurn?(
    view: AfterTurnView,
    signal: AbortSignal,
  ): Promise<Continue | { readonly continueWith: UserInput }>;
}
export interface TurnResult {
  readonly outcome: 'done' | 'cancelled' | 'limit' | 'failed';
  readonly reason?:
    | 'decision-unavailable'
    | 'auth'
    | 'model'
    | 'loop'
    | 'closing'
    | 'max-steps'
    | 'token-budget'
    | 'cost-budget'
    | 'timeout';
  readonly finalText: string;
  readonly usage: Usage;
  readonly checkpoint: CheckpointId;
  readonly droppedSteers: number;
}
export interface AfterTurnView {
  readonly result: TurnResult;
  readonly continuationPass: number;
  readonly thinkingOnly: boolean;
  readonly tools: ReadonlyArray<{
    readonly call: CallId;
    readonly tool: ToolId;
    readonly outcome: ToolOutcome;
  }>;
}
export interface Continue {
  readonly action: 'continue';
}
export interface Block {
  readonly action: 'block';
  readonly reason: string;
}
export type JsonPatch = ReadonlyArray<{
  readonly op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  readonly path: string;
  readonly value?: JsonValue;
  readonly from?: string;
}>;
export interface Redaction {
  readonly start: number;
  readonly end: number;
  readonly replacement: string;
}
export interface ModelRequestView {
  readonly instructions: readonly InstructionBlock[];
  readonly messages: readonly TranscriptEntry[];
  readonly tools: ModelRequest['tools'];
  readonly parameters: ModelParameters;
}
export interface Turn {
  readonly id: TurnId;
  readonly events: AsyncIterable<AgentEvent>;
  readonly result: Promise<TurnResult>;
}
export type AgentCommand = { readonly id?: CommandId } & (
  | { readonly type: 'set-model'; readonly selection: ModelSelection }
  | {
      readonly type: 'set-preferences';
      readonly layers: readonly PolicyLayer[];
    }
  | { readonly type: 'set-authority'; readonly rules: readonly PolicyRule[] }
  | { readonly type: 'set-limits'; readonly limits: Limits }
  | { readonly type: 'set-mode'; readonly mode: 'normal' | 'plan' }
  | {
      readonly type: 'set-instructions';
      readonly instructions: readonly InstructionBlock[];
    }
  | { readonly type: 'set-context'; readonly items: readonly ContextItem[] }
  | { readonly type: 'remove-context'; readonly ids: readonly string[] }
  | { readonly type: 'revoke-grant'; readonly grant: GrantId }
  | { readonly type: 'compact' }
  | { readonly type: 'rewind'; readonly to: CheckpointId }
  | { readonly type: 'clear' }
);
export type CommandResult =
  | { readonly status: 'applied'; readonly at: Sequence }
  | { readonly status: 'rejected'; readonly reason: string };
export interface AgentSnapshot {
  readonly cursor: Sequence;
  readonly status:
    | 'idle'
    | 'running'
    | 'awaiting-decision'
    | 'cancelling'
    | 'closing'
    | 'closed';
  readonly mode: 'normal' | 'plan';
  readonly turn?: { readonly id: TurnId; readonly step: number };
  readonly model: { readonly active: ModelRef; readonly contextWindow: number };
  readonly tools: readonly ToolSummary[];
  readonly policy: PolicySummary;
  readonly pendingDecisions: readonly DecisionRequest[];
  readonly queued: { readonly steers: number; readonly commands: number };
  readonly context: readonly ContextItemSummary[];
  readonly usage: { readonly session: Usage; readonly turn?: Usage };
  readonly history: {
    readonly entries: number;
    readonly estimatedTokens: number;
    readonly head: CheckpointId;
  };
  readonly children: readonly ChildSummary[];
}
export interface ToolSummary {
  readonly id: ToolId;
  readonly description: string;
  readonly effects: readonly Effect[];
}
export interface PolicySummary {
  readonly revision: number;
  readonly authorityRules: number;
  readonly preferenceLayers: readonly string[];
  readonly grants: number;
}
export interface ContextItemSummary {
  readonly id: string;
  readonly source: string;
  readonly lifetime: ContextItem['lifetime'];
}
export interface ChildSummary {
  readonly id: AgentId;
  readonly template: string;
  readonly status: AgentSnapshot['status'];
}
export interface CloseReport {
  readonly cancelledTurn?: TurnId;
  readonly portFailures: readonly string[];
  readonly finalized: boolean;
}
export interface CreateError {
  readonly kind: 'definition' | 'model' | 'store' | 'recovery';
  readonly message: string;
  readonly cause?: unknown;
}
export interface AgentEventBase {
  readonly seq: Sequence;
  readonly at: number;
  readonly agent: AgentId;
  readonly turn?: TurnId;
}
export interface AgentHost {
  readonly models: ModelPort;
  readonly tools: ToolCatalog;
  readonly decisions: DecisionPort;
  readonly interceptors?: Interceptors;
  readonly store?: SessionStore;
  readonly clock?: Clock;
  readonly diagnostics?: DiagnosticSink;
}
export interface Agent {
  readonly id: AgentId;
  readonly session: SessionId;
  submit(input: UserInput): Turn;
  steer(input: UserInput): void;
  cancel(reason?: string): void;
  command(command: AgentCommand): Promise<CommandResult>;
  snapshot(): AgentSnapshot;
  events(options?: { readonly after?: Sequence }): AsyncIterable<AgentEvent>;
  transcript(range?: {
    readonly from?: CheckpointId;
    readonly to?: CheckpointId;
  }): Promise<readonly TranscriptEntry[]>;
  close(options?: {
    readonly finalizeTimeoutMs?: number;
  }): Promise<CloseReport>;
}
export type CreateStart =
  | { readonly resume: SessionId }
  | { readonly fork: { readonly from: SessionId; readonly at: CheckpointId } };
export type DefinitionProblem = {
  readonly code: string;
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
};
export interface UnsubscribeCatalog {
  (): void;
}
export type ClockPort = Clock;
