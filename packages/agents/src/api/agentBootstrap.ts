/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P15
 * @requirement:REQ-001
 * @requirement:REQ-003
 *
 * Helper functions extracted from the createAgent bootstrap to keep each
 * function within the project's max-lines-per-function and cognitive-complexity
 * limits.
 */

import { randomUUID } from 'node:crypto';
import type { PartListUnion, Part } from '@google/genai';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type {
  ToolSchedulerFactory,
  ToolSchedulerFactoryOptions,
  ToolSchedulerContract,
} from '@vybestack/llxprt-code-core/core/toolSchedulerContract.js';
import type { ToolConfirmationOutcome } from '@vybestack/llxprt-code-tools';
import { AgentClient } from '../core/client.js';
import type {
  AgentConfig,
  AgentSchedulerFactory,
  AgentSchedulerHandle,
  EditorCallbacks,
} from './config-types.js';
import type { AgentInput, AgentResult } from './agent.js';
import type {
  ApprovalHandler,
  DisplayCallbacks,
} from '../core/agenticLoop/types.js';
import type { AgentEvent, AgentToolCall, DoneReason } from './event-types.js';
import type { ProviderInfo, ToolInfo, SessionStats } from './agent.js';

/**
 * Error raised when the createAgent bootstrap cannot produce a ready Agent.
 * @pseudocode createAgent.md steps 115-118
 */
export class AgentBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentBootstrapError';
    Object.setPrototypeOf(this, AgentBootstrapError.prototype);
  }
}

/** Resolved auth fields derived from AgentConfig.auth. */
export interface ResolvedAuth {
  readonly authMethod: string | undefined;
  readonly apiKey: string | undefined;
  readonly baseUrl: string | undefined;
}

/**
 * Maps AgentConfig.auth to the bootstrap auth fields.
 * @pseudocode createAgent.md step 12
 *
 * For a provider-scoped key/keyfile use 'provider' (matches the CLI
 * zedIntegration + non-gemini path). When no key/keyfile/perProvider is
 * present, authMethod is undefined (default).
 */
export function resolveAuthType(auth: AgentConfig['auth']): ResolvedAuth {
  if (auth === undefined) {
    return { authMethod: undefined, apiKey: undefined, baseUrl: undefined };
  }
  const hasKey =
    auth.apiKey !== undefined ||
    auth.apiKeyFile !== undefined ||
    auth.keyName !== undefined ||
    auth.perProvider !== undefined;
  return {
    authMethod: hasKey ? 'provider' : undefined,
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl,
  };
}

/** Generates a fresh runtimeId for agents without an explicit sessionId. */
export function generateRuntimeId(): string {
  return `agent-${randomUUID()}`;
}

/**
 * Validate a caller-visible agent runtime/session id before it reaches the
 * providers runtime registry, where runtime ids must be deterministic keys.
 */
export function validateAgentRuntimeId(runtimeId: unknown): void {
  if (
    typeof runtimeId !== 'string' ||
    runtimeId.length === 0 ||
    runtimeId.trim() === ''
  ) {
    throw new AgentBootstrapError(
      `Invalid runtimeId: expected a non-empty string but received ${
        typeof runtimeId === 'string'
          ? JSON.stringify(runtimeId)
          : String(runtimeId)
      }.`,
    );
  }
}

/**
 * Returns an AgentClientFactory that constructs the agents-owned AgentClient.
 * @pseudocode createAgent.md step 21
 */
export function buildAgentClientFactory(): (
  config: Config,
  runtimeState: AgentRuntimeState,
) => AgentClientContract {
  return (
    config: Config,
    runtimeState: AgentRuntimeState,
  ): AgentClientContract => new AgentClient(config, runtimeState);
}

/**
 * Wraps a caller-provided scheduler factory so the Agent owns the created
 * scheduler instances (for disposal). Each per-turn scheduler the core
 * requests is built by {@link buildRealScheduler} (a fully functioning
 * {@link ToolSchedulerContract}); in parallel the caller's
 * {@link AgentSchedulerFactory} is invoked with the same session/interactive
 * context and the {@link AgentSchedulerHandle} it returns is retained in
 * {@link createdHandles} so Agent.dispose() can tear it down (dispose.md
 * lines 40-47). The caller-owned factory FUNCTION is never disposed — only the
 * handle instances it creates.
 * @plan:PLAN-20260617-COREAPI.P23
 * @requirement:REQ-006
 * @requirement:REQ-016
 * @pseudocode createAgent.md steps 24-26
 */
export function wrapSchedulerFactory(
  factory: AgentSchedulerFactory,
  buildRealScheduler: ToolSchedulerFactory,
  createdHandles: AgentSchedulerHandle[],
): ToolSchedulerFactory {
  return (options: ToolSchedulerFactoryOptions): ToolSchedulerContract => {
    const scheduler = buildRealScheduler(options);
    const handle = factory({
      sessionId: options.config.getSessionId(),
      ...(options.toolContextInteractiveMode !== undefined
        ? { interactiveMode: options.toolContextInteractiveMode }
        : {}),
    });
    createdHandles.push(handle);
    return scheduler;
  };
}

/**
 * Wraps a config-level ApprovalHandler (takes a simple confirmation object) as
 * the AgenticLoop's ApprovalHandler (takes a ToolConfirmationRequest and returns
 * an ApprovalResult). Maps the confirmation request into the simple shape.
 */
export function wrapApprovalHandler(
  handler: (confirmation: {
    readonly confirmationId: string;
    readonly toolCallId: string;
    readonly name: string;
    readonly details: unknown;
  }) => Promise<ToolConfirmationOutcome> | ToolConfirmationOutcome,
): ApprovalHandler {
  return async (request) => {
    const callId = request.toolCall.id ?? '';
    const outcome = await handler({
      confirmationId: request.correlationId,
      toolCallId: callId,
      name: request.toolCall.name ?? '',
      details: request.details,
    });
    return { outcome };
  };
}

/**
 * Derives DisplayCallbacks from EditorCallbacks for the AgenticLoop.
 * @pseudocode createAgent.md step 147
 */
export function deriveDisplayCallbacks(
  editorCallbacks: EditorCallbacks | undefined,
): DisplayCallbacks | undefined {
  if (editorCallbacks === undefined) {
    return undefined;
  }
  const cbs: DisplayCallbacks = {};
  if (editorCallbacks.getPreferredEditor !== undefined) {
    cbs.getPreferredEditor = () =>
      editorCallbacks.getPreferredEditor?.() as
        | ReturnType<NonNullable<DisplayCallbacks['getPreferredEditor']>>
        | undefined;
  }
  if (editorCallbacks.onEditorOpen !== undefined) {
    cbs.onEditorOpen = editorCallbacks.onEditorOpen;
  }
  if (editorCallbacks.onEditorClose !== undefined) {
    cbs.onEditorClose = editorCallbacks.onEditorClose;
  }
  return cbs;
}

/**
 * Maps an AgentInput (string | readonly Part[] | structured {text, role?})
 * to a PartListUnion for run().
 */
function isPartArray(input: AgentInput): input is readonly Part[] {
  return Array.isArray(input);
}

export function toPartListUnion(input: AgentInput): PartListUnion {
  if (typeof input === 'string') {
    return input;
  }
  if (isPartArray(input)) {
    return [...input];
  }
  return input.text;
}

/**
 * A session/recording lock the facade owns and releases on dispose. The
 * headless harness acquires none, so {@link OwnershipRecord.sessionLocks} is
 * empty by default and the release loop is a vacuous no-op (dispose.md lines
 * 81-83).
 * @plan:PLAN-20260617-COREAPI.P24
 * @requirement:REQ-016
 */
export interface SessionLock {
  release: () => Promise<void> | void;
}

/** Ownership record retained on the facade for disposal + T13 harness probes. */
export interface OwnershipRecord {
  disposed: boolean;
  runtimeHandle: {
    cleanup: () => Promise<void> | void;
  };
  config: Config;
  messageBus: unknown;
  loopHolder: {
    current?: unknown;
    activeRunController?: AbortController;
    subscriptions?: ReadonlyArray<() => void>;
  };
  runtimeState: AgentRuntimeState;
  /**
   * Scheduler handles created through a caller-injected
   * {@link AgentSchedulerFactory} and retained by the facade. Agent.dispose()
   * disposes each handle (dispose.md lines 40-47). Empty when no injected
   * factory was supplied (the common case). The caller-owned factory FUNCTION
   * is never disposed — only these created handle instances.
   * @plan:PLAN-20260617-COREAPI.P23
   * @requirement:REQ-016
   */
  injectedSchedulerHandles: AgentSchedulerHandle[];
  /**
   * Session/recording locks the facade owns; each is released on dispose
   * (dispose.md lines 81-83). Empty in headless mode.
   * @plan:PLAN-20260617-COREAPI.P24
   * @requirement:REQ-016
   */
  sessionLocks: SessionLock[];
  /**
   * Completion marker set true after the NET-NEW LSP shutdown step succeeds
   * (dispose.md line 70). The real LspState has no boolean and the harness never
   * starts LSP, so this is the GREEN-reachable disposed-observable T13 reads.
   * @plan:PLAN-20260617-COREAPI.P24
   * @requirement:REQ-016
   */
  lspShutDown?: boolean;
  /**
   * Completion marker set true after the NET-NEW extensions teardown step
   * succeeds (dispose.md line 80). Config has no extensionsManager field and the
   * harness creates none, so this is the GREEN-reachable disposed-observable.
   * @plan:PLAN-20260617-COREAPI.P24
   * @requirement:REQ-016
   */
  extensionsDisposed?: boolean;
  /**
   * Completion marker set true after the NET-NEW session-lock release loop
   * completes (dispose.md lines 81-83). With zero locks the marker still flips
   * true (vacuously "all released"); this is the GREEN-reachable observable.
   * @plan:PLAN-20260617-COREAPI.P24
   * @requirement:REQ-016
   */
  sessionLocksReleased?: boolean;
  /**
   * The Config ownership origin. 'agent' when createAgent constructed the
   * Config (Agent.dispose() tears it down); 'caller' when fromConfig adopted
   * an external Config (Agent.dispose() SKIPS the Config.dispose() +
   * shutdownLspService() teardown so the caller retains the lifecycle).
   * @plan:PLAN-20260621-COREAPIREMED.P09
   * @requirement:REQ-001.3
   */
  configOwnership: 'agent' | 'caller';
}

/**
 * Builds the ownership record retained on the facade.
 * @pseudocode createAgent.md steps 150-153
 */
export function recordOwnership(deps: {
  runtimeHandle: OwnershipRecord['runtimeHandle'];
  config: Config;
  messageBus: unknown;
  loopHolder: OwnershipRecord['loopHolder'];
  runtimeState: AgentRuntimeState;
  injectedSchedulerHandles: AgentSchedulerHandle[];
  sessionLocks?: SessionLock[];
  // @plan:PLAN-20260621-COREAPIREMED.P09 @requirement:REQ-001.3
  // Optional for backward compatibility with existing callers that construct
  // an agent-owned Config (the historical default); defaults to 'agent'.
  configOwnership?: 'agent' | 'caller';
}): OwnershipRecord {
  return {
    disposed: false,
    runtimeHandle: deps.runtimeHandle,
    config: deps.config,
    messageBus: deps.messageBus,
    loopHolder: deps.loopHolder,
    runtimeState: deps.runtimeState,
    injectedSchedulerHandles: deps.injectedSchedulerHandles,
    // @plan:PLAN-20260617-COREAPI.P24 @requirement:REQ-016
    // Headless agents acquire no session locks; the release loop is a vacuous
    // no-op that still flips sessionLocksReleased true (dispose.md lines 81-83).
    sessionLocks: deps.sessionLocks ?? [],
    // @plan:PLAN-20260617-COREAPI.P24 @requirement:REQ-016
    // NET-NEW teardown completion markers (dispose.md lines 70/80/83). Each is
    // set true inside dispose()'s safe() closure AFTER its teardown await
    // succeeds; pre-dispose they read false (not-yet-torn-down).
    lspShutDown: false,
    extensionsDisposed: false,
    sessionLocksReleased: false,
    // @plan:PLAN-20260621-COREAPIREMED.P09 @requirement:REQ-001.3
    configOwnership: deps.configOwnership ?? 'agent',
  };
}

/** Result of draining stream() into a chat result. */
interface DrainedResult {
  readonly text: string;
  readonly toolCalls: AgentToolCall[];
  readonly finishReason: DoneReason;
  readonly error: unknown;
  readonly usage: unknown;
}

/**
 * Drains an AgentEvent stream into an AgentResult-shaped object.
 *
 * Collects text (concatenated), toolCalls, finishReason (from `done.reason`),
 * usage (from `done.finished.usageMetadata` or a `usage` event) and error (from
 * an `error` event) — the complete non-interactive-parity surface so chat() can
 * return an AgentResult sufficient to drive runNonInteractive.
 * @plan:PLAN-20260617-COREAPI.P15
 * @plan:PLAN-20260617-COREAPI.P26
 * @requirement:REQ-003
 * @requirement:REQ-021
 */
export async function drainToResult(
  stream: AsyncIterable<AgentEvent>,
): Promise<DrainedResult> {
  const textParts: string[] = [];
  const toolCalls: AgentToolCall[] = [];
  let finishReason: DoneReason = 'stop';
  let error: unknown;
  let usage: unknown;
  for await (const event of stream) {
    switch (event.type) {
      case 'text':
        textParts.push(event.text);
        break;
      case 'tool-call':
        toolCalls.push(event.call);
        break;
      case 'done':
        finishReason = event.reason;
        if (event.finished?.usageMetadata !== undefined) {
          usage = event.finished.usageMetadata;
        }
        break;
      case 'error':
        error = event.error;
        break;
      case 'usage':
        usage = event.usage;
        break;
      default:
        break;
    }
  }
  return {
    text: textParts.join(''),
    toolCalls,
    finishReason,
    error,
    usage,
  };
}

/**
 * Builds an AgentResult from a drained stream result.
 *
 * `error` and `usage` are INDEPENDENT optional surfaces: an errored turn that
 * still consumed tokens carries BOTH, so runNonInteractive can choose a
 * non-zero exit (error) AND render stats / `--output-format json` (usage). They
 * are spread independently (exactOptionalPropertyTypes-safe) — never set to
 * undefined and never mutually exclusive.
 * @plan:PLAN-20260617-COREAPI.P15
 * @plan:PLAN-20260617-COREAPI.P26
 * @requirement:REQ-003
 * @requirement:REQ-021
 */
export function buildAgentResult(drained: DrainedResult): AgentResult {
  return {
    text: drained.text,
    toolCalls: drained.toolCalls,
    finishReason: drained.finishReason,
    ...(drained.error !== undefined
      ? { error: drained.error as AgentResult['error'] }
      : {}),
    ...(drained.usage !== undefined
      ? { usage: drained.usage as SessionStats }
      : {}),
  };
}

/**
 * Builds the ProviderInfo[] array from the runtime provider manager.
 * @plan:PLAN-20260617-COREAPI.P15
 * @requirement:REQ-017
 */
export function buildProviderInfos(
  providerNames: readonly string[],
  configuredSet: ReadonlySet<string>,
): readonly ProviderInfo[] {
  return providerNames.map((name) => ({
    name,
    configured: configuredSet.has(name),
  }));
}

/**
 * Builds the ToolInfo[] array from the tool registry tool list.
 * @plan:PLAN-20260617-COREAPI.P15
 * @requirement:REQ-017
 */
export function buildToolInfos(
  tools: ReadonlyArray<{
    readonly name: string;
    readonly serverName?: string;
  }>,
  enabledSet: ReadonlySet<string>,
): readonly ToolInfo[] {
  return tools.map((tool) => {
    const isMcp = tool.serverName !== undefined;
    return {
      name: tool.name,
      source: isMcp ? 'mcp' : 'builtin',
      ...(isMcp ? { server: tool.serverName } : {}),
      enabled: enabledSet.has(tool.name),
    };
  });
}
