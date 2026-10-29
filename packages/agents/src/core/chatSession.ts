import type { ProviderFileLifecycle } from '@vybestack/llxprt-code-providers';
import {
  ChatHistoryAdmissions,
  appendGenerationHistory,
} from './generation-history.js';
import type { RuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { ProviderRetryOperations } from '@vybestack/llxprt-code-core/runtime/contracts/ProviderRetryOperations.js';
import {
  chatResolvedBaseUrl,
  buildChatProviderRuntime,
  supportsChatCompletion,
  completedToolResponseIds,
  cleanupChatSessionProviderFiles,
  initialProviderBaseUrl,
  resolveProviderBaseUrl,
  completedToolResponses,
  logChatInitialization,
} from './chatSessionProviderRuntime.js';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ChatSession — thin coordinator that wires up the decomposed modules.

import type { AgentHistoryAdmission as SessionHistoryAdmission } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { triggerPreCompressHook } from '@vybestack/llxprt-code-core/core/lifecycleHookTriggers.js';
import type { StructuredError } from '@vybestack/llxprt-code-core/core/turn.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type {
  AgentMessageInput,
  ModelGenerationSettings,
  ModelOutput,
  ToolDeclaration,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import type { ToolRegistryView } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type {
  ProviderFileBindingStore,
  ProviderRequestCollaborators,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createHistoryProviderFileBindingStore } from '@vybestack/llxprt-code-core/services/history/provider-file-binding.js';
import type { RequestMediaResolutionService } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { StreamLivenessEvent } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import { installHistoryDensityTracking } from './chatHistoryDensity.js';
import type { CompletedToolCall } from './coreToolScheduler.js';
import { createTokenUsageLogger } from './TokenUsageLogger.js';

/**
 * Neutral generation config carried by ChatSession. Extends the neutral
 * {@link ModelGenerationSettings} with the request-scoped fields the
 * turn/stream pipeline references (abortSignal, tools, toolConfig).
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P27
 * @requirement:REQ-005.5c
 */
export interface ChatSessionConfig extends ModelGenerationSettings {
  abortSignal?: AbortSignal;
  onProviderError?: (error: StructuredError) => void;
  /**
   * Optional provider-neutral transport-liveness listener (issue #2607).
   * Threaded down to the provider stream parser so a raw lifecycle SSE event
   * (e.g. response.created) can satisfy the first-response watchdog without
   * requiring visible semantic content.
   */
  onStreamLiveness?: (event: StreamLivenessEvent) => void;
  providerRequestContext?: Record<string, unknown>;
  tools?: ToolDeclaration[];
  toolConfig?: unknown;
  /**
   * Caller-supplied re-renderer carried onto provider options so a router
   * provider (e.g. a load balancer) can re-render the assembled prompt for the
   * sub-profile model it selects (issue #3157). Assembly stays owned by
   * ChatSession; this port only re-invokes it.
   */
  systemPromptAssembler?: SystemPromptAssembler;
}

/**
 * Neutral send-message DTO replacing the provider-shaped
 * `SendMessageParameters`. Carries a neutral {@link AgentMessageInput}
 * message and an optional per-request config — never a provider Part/role
 * shape.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P27
 * @requirement:REQ-005.5c
 */
export interface SendMessageParams {
  invocation?: RuntimeInvocationContext;
  historyPrefix?: (
    tail: IContent[],
    signal?: AbortSignal,
  ) => AsyncIterable<IContent>;
  modelParameters?: AdmittedModelParameters;
  message: AgentMessageInput;
  config?: ChatSessionConfig;
  hookOwner?: AgentChatRecordingExecution['hookOwner'];
  recordingExecution?: AgentChatRecordingExecution;
}

// Decomposed modules
import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { CompressionHandler } from '../compression/CompressionHandler.js';
import {
  beginSemanticMediaPurge,
  createSemanticMediaPurgeSession,
  semanticPurgeRuntime,
} from './chatSessionMediaLifecycle.js';
import { createCompressionHookTrigger } from './compressionHookWiring.js';
import { resolveCompressionProvider } from './CompressionProfileResolver.js';
import { ConversationManager } from './ConversationManager.js';
import { DirectMessageProcessor } from './DirectMessageProcessor.js';
import {
  rebindChatSessionPorts,
  type ChatSessionPorts,
} from './chatSessionPorts.js';
import {
  convertPartListUnionToIContent,
  validateHistory,
} from './MessageConverter.js';
import type { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';
import { StreamProcessor } from './StreamProcessor.js';
import type { TokenUsageLogger } from './TokenUsageLogger.js';
import { TurnProcessor } from './TurnProcessor.js';

// Re-exports — consumers import from './chatSession.js'
export {
  EmptyStreamError,
  InvalidStreamError,
  isSchemaDepthError,
  StreamEventType,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
export type { StreamEvent } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
export {
  aggregateTextWithSpacing,
  isValidNonThoughtTextPart,
} from './MessageConverter.js';

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { StreamEvent } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import type { CompressionProviderResult } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { ChatSessionProviderResolution } from './chatSessionProviderResolution.js';
import { resolveSystemPromptForTurn } from './systemPromptModel.js';
import type { PerformCompressionResult } from './turn.js';
import type { TurnReceipt } from '@vybestack/llxprt-code-core/core/turnReceipt.js';
export type { TurnReceipt } from '@vybestack/llxprt-code-core/core/turnReceipt.js';

/**
 * Assembles the complete system prompt for a turn, given the freshly-resolved
 * model name. Injected optionally into {@link ChatSession} so the session can
 * rebuild the prompt once per turn — before delegating to any processor —
 * ensuring the rendered model always matches `body.model` on the wire even
 * after a mid-session `/model` change (issue #3136).
 *
 * When absent, ChatSession leaves `generationConfig.systemInstruction` exactly
 * as seeded at construction time.
 */
export interface SystemPromptAssembler {
  assemble(request: {
    provider: string | undefined;
    model: string;
  }): Promise<string>;
}

/**
 * Error thrown when agent execution is stopped by a hook.
 */
export class AgentExecutionStoppedError extends Error {
  readonly reason: string;
  readonly systemMessage?: string;
  readonly contextCleared?: boolean;

  constructor(
    reason: string,
    systemMessage?: string,
    contextCleared?: boolean,
  ) {
    // Intentional falsy coalescing: empty systemMessage must fall through to reason.
    const message =
      systemMessage && systemMessage.length > 0 ? systemMessage : reason;
    super(`Agent execution stopped: ${message}`);
    this.name = 'AgentExecutionStoppedError';
    this.reason = reason;
    this.systemMessage = systemMessage;
    this.contextCleared = contextCleared;
  }
}

/**
 * Error thrown when agent execution is blocked by a hook.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-002.6
 */
export class AgentExecutionBlockedError extends Error {
  readonly reason: string;
  readonly systemMessage?: string;
  readonly blockedOutput?: ModelOutput;
  readonly contextCleared?: boolean;

  constructor(
    reason: string,
    blockedOutput?: ModelOutput,
    systemMessage?: string,
    contextCleared?: boolean,
  ) {
    // Intentional falsy coalescing: empty systemMessage must fall through to reason.
    const message =
      systemMessage && systemMessage.length > 0 ? systemMessage : reason;
    super(`Agent execution blocked: ${message}`);
    this.name = 'AgentExecutionBlockedError';
    this.reason = reason;
    this.systemMessage = systemMessage;
    this.blockedOutput = blockedOutput;
    this.contextCleared = contextCleared;
  }
}

/**
 * Chat session that enables sending messages to the model with previous
 * conversation context.
 *
 * @remarks
 * The session maintains all the turns between user and model.
 * Delegates to focused modules: CompressionHandler, ConversationManager,
 * TurnProcessor, StreamProcessor, DirectMessageProcessor.
 */
export class ChatSession {
  private readonly providerResolution = new ChatSessionProviderResolution(
    () => this.ports.runtime.provider,
    () => this.runtimeState.provider,
    new DebugLogger('llxprt:gemini:chat'),
  );
  resolveProviderForRuntime(profile: string): IProvider {
    return this.providerResolution.resolveForRuntime(profile);
  }

  private logger = new DebugLogger('llxprt:gemini:chat');

  private readonly runtimeState: AgentRuntimeState;
  private historyService: HistoryService;
  private readonly generationConfig: ChatSessionConfig;

  // Composed modules
  private readonly compressionHandler: CompressionHandler;
  private readonly conversationManager: ConversationManager;
  private readonly turnProcessor: TurnProcessor;
  private readonly streamProcessor: StreamProcessor;
  private readonly directProcessor: DirectMessageProcessor;
  private readonly tokenUsageLogger: TokenUsageLogger;
  private semanticMediaPurge: SemanticMediaPurgeSession;
  private readonly compressionLoadBalancerRoundRobinIndexes = new Map<
    string,
    number
  >();
  /** Serializes per-turn system-prompt resolution against send hand-off. */
  private systemPromptTurnChain: Promise<void> = Promise.resolve();
  private readonly historyAdmissions = new ChatHistoryAdmissions();
  private removeDensityWrapper?: () => void;

  constructor(
    private ports: ChatSessionPorts,
    private readonly config: Config | undefined,
    private readonly mediaResolver: RequestMediaResolutionService | undefined,
    private readonly requestMediaBudgetBytes: number | undefined,
    private providerFileBindings: ProviderFileBindingStore | undefined,
    private readonly providerFileLifecycle: ProviderFileLifecycle | undefined,
    tryBucketFailover: ProviderRetryOperations['tryBucketFailover'],
    readCurrentBucket: ProviderRetryOperations['readCurrentBucket'],
    _contentGenerator: ContentGenerator,
    generationConfig: ChatSessionConfig = {},
    initialHistory: readonly IContent[] = [],
    triggerCompressionHook: typeof triggerPreCompressHook = triggerPreCompressHook,
    private readonly systemPromptAssembler?: SystemPromptAssembler,
  ) {
    this.runtimeState = this.ports.runtime.state;
    this.historyService = this.ports.runtime.history;
    this.generationConfig = generationConfig;
    this.semanticMediaPurge = createSemanticMediaPurgeSession(
      () => this.ports.runtime.ephemerals.semanticMediaPurge(),
      this.historyService,
    );
    // Carry the assembler onto the generation config so the three send seams
    // (TurnProcessor/StreamProcessor/DirectMessageProcessor) thread it onto
    // the provider options alongside systemInstruction. A router provider
    // re-invokes it after sub-profile selection (issue #3157).
    if (systemPromptAssembler !== undefined) {
      this.generationConfig.systemPromptAssembler = systemPromptAssembler;
    }

    // Wire density-dirty tracking on historyService.add
    this._installDensityWrapper();

    validateHistory(initialHistory);

    const model = this.runtimeState.model;
    logChatInitialization(this.logger, model, initialHistory.length);

    // Create composed modules
    const resolveBaseUrl = (p: IProvider) =>
      resolveProviderBaseUrl(p, this.runtimeState.baseUrl);

    this.compressionHandler = this.createCompression(triggerCompressionHook);

    this.tokenUsageLogger = this.createTokenUsageLogger();
    this.compressionHandler.tokenUsageLogger = this.tokenUsageLogger;

    // Resolve the Anthropic default base URL at construction time so that
    // streaming turns from native Anthropic are stamped with an explicit
    // endpoint. Load balancer endpoints are resolved per-request in
    // resolveProviderBaseUrl (see TurnProcessor._commitSendResult).
    const initialBaseUrl = initialProviderBaseUrl(
      this.runtimeState.provider,
      this.runtimeState.baseUrl,
    );

    this.conversationManager = new ConversationManager(
      this.historyService,
      this.ports.conversation,
      initialBaseUrl,
    );

    this.conversationManager.importInitialHistory(initialHistory, model);

    this.streamProcessor = new StreamProcessor(
      this.ports.stream,
      this.config,
      this.mediaResolver,
      this.requestMediaBudgetBytes,
      this.providerFileBindings,
      this.providerFileLifecycle,
      tryBucketFailover,
      readCurrentBucket,
      this.conversationManager,
      this.compressionHandler,
      this.resolveProviderForRuntime.bind(this),
      this.buildProviderRuntime.bind(this),
      this.historyService,
      this.generationConfig,
    );

    this.turnProcessor = new TurnProcessor(
      this.ports.turn,
      this.config,
      this.mediaResolver,
      this.requestMediaBudgetBytes,
      this.providerFileBindings,
      this.providerFileLifecycle,
      this.compressionHandler,
      (contextLabel) => this.resolveProviderForRuntime(contextLabel),
      (source, extras) => this.buildProviderRuntime(source, extras),
      this.generationConfig,
      this.historyService,
      this.streamProcessor,
      resolveBaseUrl,
    );
    this.directProcessor = this.createDirectMessageProcessor();
  }

  private createTokenUsageLogger(): TokenUsageLogger {
    return createTokenUsageLogger(
      this.ports.runtime.tokenUsageLoggingEnabled,
      this.ports.runtime.state.sessionId,
      this.config,
    );
  }

  private createDirectMessageProcessor(): DirectMessageProcessor {
    return new DirectMessageProcessor(
      this.ports.direct,
      this.config,
      this.mediaResolver,
      this.requestMediaBudgetBytes,
      this.providerFileBindings,
      this.providerFileLifecycle,
      (contextLabel) => this.resolveProviderForRuntime(contextLabel),
      (source, extras) => this.buildProviderRuntime(source, extras),
      this.generationConfig,
      this.historyService,
    );
  }

  takeHistoryAdmissions(): readonly SessionHistoryAdmission[] {
    const admissions = this.historyAdmissions.all;
    this.historyAdmissions.all = [];
    return admissions;
  }

  prepareHistoryRebind(
    history: HistoryService,
    previousChat?: Pick<ChatSession, 'takeHistoryAdmissions'>,
  ): () => void {
    const providerFileBindings = createHistoryProviderFileBindingStore(history);
    const ports = rebindChatSessionPorts(this.ports, history);
    const semanticMediaPurge = createSemanticMediaPurgeSession(
      () => ports.runtime.ephemerals.semanticMediaPurge(),
      history,
    );
    return () => {
      this.historyAdmissions.all = [
        ...this.historyAdmissions.all,
        ...(previousChat?.takeHistoryAdmissions() ?? []),
      ];
      this.removeDensityWrapper?.();
      this.removeDensityWrapper = undefined;
      this.ports = ports;
      this.historyService = history;
      this.providerFileBindings = providerFileBindings;
      this.compressionHandler.rebindHistory(
        ports.compression,
        providerFileBindings,
      );
      this.conversationManager.rebindHistory(ports.conversation);
      this.streamProcessor.rebindHistory(ports.stream, providerFileBindings);
      this.turnProcessor.rebindHistory(ports.turn, providerFileBindings);
      this.directProcessor.rebindHistory(ports.direct, providerFileBindings);
      this.semanticMediaPurge = semanticMediaPurge;
      this._installDensityWrapper();
    };
  }

  private createCompression(
    triggerCompressionHook: typeof triggerPreCompressHook,
  ): CompressionHandler {
    return new CompressionHandler(
      this.ports.compression,
      this.config,
      this.historyService,
      this.mediaResolver,
      this.requestMediaBudgetBytes,
      this.providerFileBindings,
      this.providerFileLifecycle,
      this.generationConfig,
      this.resolveCompressionProvider.bind(this),
      createCompressionHookTrigger(triggerCompressionHook),
    );
  }

  // ── Density wrapper ──────────────────────────────────────────────

  private static readonly DENSITY_WRAPPED = Symbol('densityWrapped');

  private _installDensityWrapper(): void {
    this.removeDensityWrapper = installHistoryDensityTracking(
      this.historyService,
      () => this.compressionHandler.markDensityDirty(),
      ChatSession.DENSITY_WRAPPED,
    );
  }

  providerSupportsIContent(provider: IProvider | undefined): boolean {
    return supportsChatCompletion(provider);
  }

  // ── Compression profile resolution (delegated to CompressionProfileResolver) ──

  private async resolveCompressionProvider(
    profileName: string | undefined,
  ): Promise<CompressionProviderResult> {
    return resolveCompressionProvider(
      {
        profileDefinitions: this.ports.runtime.profileDefinitions,
        providerRuntime: this.ports.runtime.providerRuntime,
        prepareProviderInvocation: this.ports.runtime.prepareProviderInvocation,
        runtimeState: this.runtimeState,
        readProviderKeys: () => this.ports.runtime.provider.getProviderKeys(),
        resolveExplicitCompressionProvider:
          this.providerResolution.resolveExplicitCompression.bind(
            this.providerResolution,
          ),
        roundRobinIndexes: this.compressionLoadBalancerRoundRobinIndexes,
      },
      profileName,
      () =>
        this.resolveProviderForRuntime(
          'ChatSession.resolveCompressionProvider.default',
        ),
      this.mediaResolver,
      this.requestMediaBudgetBytes,
      this.providerFileBindings,
      this.providerFileLifecycle,
      this.getConfig(),
    );
  }

  private buildProviderRuntime(
    source: string,
    metadata: Record<string, unknown> = {},
  ): ProviderRequestCollaborators {
    return buildChatProviderRuntime(
      this.ports.runtime.providerRuntime,
      this.runtimeState.runtimeId,
      source,
      metadata,
    );
  }

  // ── Public API — thin delegation ─────────────────────────────────

  private _beginSemanticMediaPurge(
    execution?: AgentChatRecordingExecution,
    signal?: AbortSignal,
  ): ReturnType<SemanticMediaPurgeSession['begin']> {
    return beginSemanticMediaPurge(
      this.semanticMediaPurge,
      semanticPurgeRuntime(this.ports.runtime),
      this.runtimeState.provider,
      execution,
      signal,
    );
  }

  /**
   * Resolves the complete system prompt once per turn using the
   * provider's current model, then writes it onto
   * {@link ChatSession.generationConfig.systemInstruction} and recomputes the
   * base token offset. This guarantees the rendered model name matches
   * `body.model` on the wire even after a mid-session `/model` change
   * (issue #3136). Returns the prompt resolved for this turn so the turn can
   * transmit it even after a later turn overwrites the shared copy. No-op
   * (returns undefined) when no assembler was injected.
   */
  private async _resolveSystemPromptForTurn(
    model: string,
  ): Promise<string | undefined> {
    const published: { instruction?: string } = {};
    await resolveSystemPromptForTurn(
      this.systemPromptAssembler,
      this.runtimeState.provider,
      model,
      this.historyService,
      (instruction) => {
        published.instruction = instruction;
        this.generationConfig.systemInstruction = instruction;
      },
    );
    return published.instruction;
  }

  /**
   * Wraps a send entry point so the system prompt is always resolved first.
   * Every public send path must go through this: a path that forgets would
   * silently transmit a stale prompt, which is the class of bug #3136 fixed.
   *
   * Resolution and hand-off are serialized against each other. Resolution
   * mutates shared state (`generationConfig.systemInstruction` and the history
   * base token offset), and it runs BEFORE `TurnProcessor`'s own `sendPromise`
   * barrier. Without this chain two concurrent sends could both resolve, the
   * second overwriting the first, and the first turn would then transmit the
   * second turn's prompt — defeating the per-turn model guarantee this exists
   * to provide.
   *
   * The send receives the params carrying the prompt resolved for ITS turn.
   * Resolution is serialized but the send is not, so by the time a send builds
   * its request a later turn may already have replaced the shared
   * `generationConfig.systemInstruction`; the send must read its own copy.
   */
  private async _withResolvedSystemPrompt<T>(
    params: SendMessageParams,
    send: (turnParams: SendMessageParams) => Promise<T>,
    parameters: AdmittedModelParameters | undefined,
  ): Promise<T> {
    // Only the RESOLUTION is serialized, never the send. Concurrent sends are
    // intended behavior (see chatSession.runtime.timeout.test.ts: "two
    // simultaneous sends timeout independently without signal leakage"), so
    // chaining the send itself would break a documented invariant.
    //
    // Serializing resolution alone keeps the shared-state mutation
    // (generationConfig.systemInstruction + base token offset) atomic, so two
    // turns cannot resolve interleaved and produce a torn prompt.
    const resolved = this.systemPromptTurnChain.then(() =>
      this._resolveSystemPromptForTurn(
        parameters?.route?.model ?? this.runtimeState.model,
      ),
    );
    // Keep the chain alive after a failed resolution; a rejection must not
    // permanently wedge every later send.
    this.systemPromptTurnChain = resolved.then(
      () => undefined,
      () => undefined,
    );
    const systemInstruction = await resolved;
    return send(
      systemInstruction === undefined ||
        params.config?.systemInstruction !== undefined
        ? params
        : { ...params, config: { ...params.config, systemInstruction } },
    );
  }

  async sendMessage(
    params: SendMessageParams,
    prompt_id: string,
    execution:
      | AgentChatRecordingExecution
      | undefined = params.recordingExecution,
  ): Promise<TurnReceipt> {
    return this._withResolvedSystemPrompt(
      params,
      (turnParams) =>
        this.turnProcessor.sendMessage(
          { ...turnParams, recordingExecution: execution },
          prompt_id,
          () =>
            this._beginSemanticMediaPurge(
              execution,
              params.config?.abortSignal,
            ),
        ),
      params.modelParameters,
    );
  }

  async sendMessageStream(
    params: SendMessageParams,
    prompt_id: string,
    execution?: AgentChatRecordingExecution,
  ): Promise<AsyncGenerator<StreamEvent>> {
    return this._withResolvedSystemPrompt(
      params,
      (turnParams) =>
        this.turnProcessor.sendMessageStream(
          { ...turnParams, recordingExecution: execution },
          prompt_id,
          () =>
            this._beginSemanticMediaPurge(
              execution,
              params.config?.abortSignal,
            ),
        ),
      params.modelParameters,
    );
  }

  async generateDirectMessage(
    params: SendMessageParams,
    prompt_id: string,
    execution?: AgentChatRecordingExecution,
  ): Promise<ModelOutput> {
    return this._withResolvedSystemPrompt(
      params,
      (turnParams) =>
        this.directProcessor.generateDirectMessage(
          turnParams,
          prompt_id,
          execution,
        ),
      params.modelParameters,
    );
  }

  async waitForIdle(): Promise<void> {
    return this.turnProcessor.waitForIdle();
  }

  setSystemInstruction(sysInstr: string) {
    this.generationConfig.systemInstruction = sysInstr;
  }

  getHistoryService(): HistoryService {
    return this.historyService;
  }

  getToolsView(): ToolRegistryView {
    return this.ports.runtime.tools;
  }

  setTools(tools: ToolDeclaration[]): void {
    this.generationConfig.tools = tools;
  }

  clearTools(): void {
    this.generationConfig.tools = undefined;
  }

  streamHistory(signal?: AbortSignal): AsyncGenerator<IContent, void, unknown> {
    return this.conversationManager.streamHistory(signal);
  }

  getHistory(
    curated: boolean = false,
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    return this.conversationManager.getHistory(curated, signal);
  }

  private admitSetHistory(
    history: readonly IContent[],
  ): Promise<SessionHistoryAdmission | undefined> {
    return this.historyAdmissions.admit(
      history,
      this.ports.runtime.mediaAdmission,
    );
  }

  private releaseSessionHistoryAdmissions(
    admissions: readonly SessionHistoryAdmission[],
  ): Promise<readonly unknown[]> {
    return this.historyAdmissions.release(admissions);
  }

  async clearHistory(): Promise<void> {
    await cleanupChatSessionProviderFiles(
      this.providerFileLifecycle,
      this.runtimeState.runtimeId,
    );
    await this.clearHistoryRows();
  }

  /**
   * Retires history while the runtime context is being disposed. The runtime
   * context owns session provider-file cleanup and runs it once, so a failed
   * remote deletion stays retained for an explicit retry instead of being
   * retried here as a side effect of clearing rows.
   */
  async clearHistoryForDisposal(): Promise<void> {
    await this.releaseHistoryAdmissions();
    await this.historyService.releaseMediaForDisposal();
    // Disposal retires the journal without publishing a clear into a recorder
    // that still owns it. The recorded conversation must remain resumable.
    await this.historyService.dispose();
  }

  private async clearHistoryRows(): Promise<void> {
    await this.releaseHistoryAdmissions();
    await this.conversationManager.clearHistory();
  }

  private async releaseHistoryAdmissions(): Promise<void> {
    const releaseFailures = await this.releaseSessionHistoryAdmissions(
      this.historyAdmissions.all,
    );
    if (releaseFailures.length > 0) {
      throw new AggregateError(
        releaseFailures,
        'Chat history media cleanup was incomplete',
      );
    }
  }

  addHistory(content: IContent): void {
    this.conversationManager.addHistory(content);
  }

  async appendGeneration(
    input: readonly IContent[],
    response: ModelOutput,
    model: string,
    signal: AbortSignal,
    historyOrigin?: object,
  ): Promise<void> {
    return appendGenerationHistory(
      this.historyService,
      (contents) => this.admitSetHistory(contents),
      (admissions) => this.releaseSessionHistoryAdmissions(admissions),
      input,
      response,
      model,
      signal,
      historyOrigin,
    );
  }

  async admitAndAddHistory(content: IContent): Promise<void> {
    const mediaAdmission = this.ports.runtime.mediaAdmission;
    const admitted =
      mediaAdmission === undefined
        ? content
        : await mediaAdmission.admitContent(content, {
            turnId:
              content.metadata?.turnId ?? this.historyService.generateTurnKey(),
            source: 'external-history',
          });
    this.conversationManager.addHistory(admitted);
  }

  async verifyHistoryMedia(history: readonly IContent[]): Promise<void> {
    await this.ports.runtime.mediaAdmission?.verifyHistory(history);
  }

  async setHistory(
    history: readonly IContent[],
    historyOrigin?: object,
  ): Promise<void> {
    const ownership = await this.admitSetHistory(history);
    try {
      await this.conversationManager.setHistory(
        ownership?.rows ?? history,
        historyOrigin,
      );
    } catch (error: unknown) {
      if (ownership === undefined) throw error;
      const cleanupFailures = await this.releaseSessionHistoryAdmissions([
        ownership,
      ]);
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          [error, ...cleanupFailures],
          'Chat history update failed and media cleanup was incomplete',
        );
      }
      throw error;
    }
    const releaseFailures = await this.releaseSessionHistoryAdmissions(
      ownership === undefined ? [] : [ownership],
    );
    if (releaseFailures.length > 0) {
      throw new AggregateError(
        releaseFailures,
        'Replaced chat history media cleanup was incomplete',
      );
    }
  }

  setActiveTodosProvider(provider: () => Promise<string | undefined>): void {
    this.compressionHandler.setActiveTodosProvider(provider);
  }

  setTranscriptPathProvider(provider: () => string | undefined): void {
    this.compressionHandler.setTranscriptPathProvider(provider);
  }

  async performCompression(
    prompt_id: string,
    options?: Parameters<CompressionHandler['performCompression']>[1],
  ): Promise<PerformCompressionResult> {
    return this.compressionHandler.performCompression(prompt_id, options);
  }

  wasRecentlyCompressed(): boolean {
    return this.compressionHandler.wasRecentlyCompressed();
  }

  getLastPromptTokenCount(): number {
    return this.compressionHandler.lastPromptTokenCount ?? 0;
  }

  /**
   * Returns the most recent pre-send prompt-envelope estimate produced at the
   * final per-attempt send seam (issue #2817). Checks both non-streaming and
   * streaming processors for the latest estimate. Returns null when the
   * provider does not implement projectPromptEnvelope.
   */
  getPromptEnvelopeEstimate(): PromptEnvelopeEstimate | null {
    const fromTurn = this.turnProcessor.getPromptEnvelopeEstimate();
    if (fromTurn !== null) return fromTurn;
    return this.streamProcessor.getPromptEnvelopeEstimate();
  }

  getTokenUsageLogger(): TokenUsageLogger {
    return this.compressionHandler.tokenUsageLogger ?? this.tokenUsageLogger;
  }

  setTokenUsageLoggerForTesting(logger: TokenUsageLogger): void {
    this.compressionHandler.tokenUsageLogger = logger;
  }

  /**
   * Baseline prompt tokens for projection: prefer the API-observed count,
   * falling back to the history-derived estimate. Mirrors
   * CompressionHandler.getProjectedPromptBaseline() so callers that re-check
   * capacity right after compression (which nulls lastPromptTokenCount) get an
   * accurate baseline instead of 0.
   */
  getProjectedPromptBaseline(): Promise<number> {
    return this.compressionHandler.getProjectedPromptBaseline();
  }

  recordCompletedToolCalls(
    _model: string,
    toolCalls: CompletedToolCall[],
  ): void {
    const functionResponses = completedToolResponses(toolCalls, this.logger);
    // Only persist the tool-response side eagerly. The assistant tool_call is
    // already recorded by the preceding model stream, and any non-tool-response
    // continuation text can be recorded by the normal next-turn finalization
    // path. Eagerly persisting only function responses makes tool outcomes
    // durable across next-stream failures/retries without duplicating model
    // turns or continuation text when the next stream succeeds.
    if (functionResponses.length > 0) {
      this.addHistory({
        speaker: 'tool',
        blocks: functionResponses,
      });
      const responseCallIds = completedToolResponseIds(functionResponses);
      this.turnProcessor.markToolResponsesRecorded(responseCallIds);
      this.streamProcessor.markToolResponsesRecorded(responseCallIds);
    }
  }

  // Public conversion methods — delegated to standalone functions
  convertPartListUnionToIContent(input: AgentMessageInput): IContent {
    return convertPartListUnionToIContent(input);
  }

  async estimatePendingTokens(contents: IContent[]): Promise<number> {
    return this.turnProcessor.estimatePendingTokens(contents);
  }

  // ── Internal compat pass-throughs (used by tests via `as never` casts) ──

  get densityDirty(): boolean {
    return this.compressionHandler.densityDirty;
  }

  set densityDirty(value: boolean) {
    this.compressionHandler.densityDirty = value;
  }

  async ensureDensityOptimized(): Promise<void> {
    return this.compressionHandler.ensureDensityOptimized();
  }

  async ensureCompressionBeforeSend(
    promptId: string,
    pendingTokens: number,
    source: 'send' | 'stream',
    trigger: 'manual' | 'auto' = 'auto',
  ): Promise<void> {
    return this.compressionHandler.ensureCompressionBeforeSend(
      promptId,
      pendingTokens,
      source,
      trigger,
    );
  }

  async enforceContextWindow(
    pendingTokens: number,
    promptId: string,
    transcriptPathProvider?: () => string | undefined,
    historyOrigin?: object,
    hookOwner?: AgentChatRecordingExecution['hookOwner'],
    modelParameters?: AdmittedModelParameters,
  ): Promise<void> {
    return this.compressionHandler.enforceContextWindow(
      pendingTokens,
      promptId,
      undefined,
      transcriptPathProvider,
      historyOrigin,
      hookOwner,
      modelParameters,
    );
  }

  shouldCompress(pendingTokens?: number): Promise<boolean> {
    return this.compressionHandler.shouldCompress(pendingTokens);
  }

  /**
   * Resolves the effective context-window token limit through the three-tier
   * precedence (user override → provider limit → model-name lookup) via the
   * runtime context's ephemerals.contextLimit(). This is the single source
   * of truth for the agents layer — callers must use this instead of reaching
   * through Config.getContentGeneratorConfig().providerManager (issue #2815).
   */
  getContextLimit(): number {
    return this.ports.runtime.ephemerals.contextLimit();
  }

  /**
   * Resolves the base URL of the endpoint that would service the next provider
   * request: the load balancer's last-selected sub-profile URL when active,
   * otherwise the runtime base URL (native Anthropic default included).
   * Returns undefined when no endpoint is resolvable. Used for error
   * reporting so failures name the actual endpoint (@issue #2231); note that
   * provider resolution follows the same path a send would (including an
   * enforced active-provider switch). Only the absence of an active provider
   * yields undefined; any other resolution failure propagates to the caller.
   */
  getResolvedBaseUrl(): string | undefined {
    return chatResolvedBaseUrl(
      () => this.resolveProviderForRuntime('ChatSession.getResolvedBaseUrl'),
      this.runtimeState.baseUrl,
    );
  }

  /**
   * Returns the Config instance from the provider runtime.
   * Used by Turn and other consumers to access ephemeral settings.
   */
  getStreamTimeoutPolicy() {
    return this.ports.runtime.readStreamTimeoutPolicy();
  }

  shouldShowCitations(): boolean {
    return this.ports.runtime.showCitations();
  }

  getConfig(): Config | undefined {
    return this.config;
  }
}
