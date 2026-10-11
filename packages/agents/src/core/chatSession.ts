/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ChatSession — thin coordinator that wires up the decomposed modules.

import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import { createTokenUsageLogger } from './TokenUsageLogger.js';
import type {
  ModelGenerationSettings,
  ModelOutput,
  AgentMessageInput,
  ToolDeclaration,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { StructuredError } from '@vybestack/llxprt-code-core/core/turn.js';
import type { StreamLivenessEvent } from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';

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
  modelParameters?: AdmittedModelParameters;
  message: AgentMessageInput;
  config?: ChatSessionConfig;
  hookOwner?: AgentChatRecordingExecution['hookOwner'];
  recordingExecution?: AgentChatRecordingExecution;
}
import type { CompletedToolCall } from './coreToolScheduler.js';
import type { AgentHistoryAdmission as SessionHistoryAdmission } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { installHistoryDensityTracking } from './chatHistoryDensity.js';
import { createHistoryProviderFileBindingStore } from '@vybestack/llxprt-code-core/services/history/provider-file-binding.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { PromptEnvelopeEstimate } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type {
  AgentRuntimeContext,
  AgentRuntimeProviderAdapter,
  ToolRegistryView,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ProviderRequestCollaborators } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { triggerPreCompressHook } from '@vybestack/llxprt-code-core/core/lifecycleHookTriggers.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { MediaAdmissionContext } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';

// Decomposed modules
import { CompressionHandler } from '../compression/CompressionHandler.js';
import { ConversationManager } from './ConversationManager.js';
import { TurnProcessor } from './TurnProcessor.js';
import { StreamProcessor } from './StreamProcessor.js';
import { DirectMessageProcessor } from './DirectMessageProcessor.js';
import { createCompressionHookTrigger } from './compressionHookWiring.js';
import type { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';
import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import {
  createSemanticMediaPurgeSession,
  requiresObservedSemanticPurgeCacheWrite,
} from './chatSessionMediaLifecycle.js';
import type { TokenUsageLogger } from './TokenUsageLogger.js';
import {
  cleanupChatSessionProviderFiles,
  initialProviderBaseUrl,
  resolveProviderBaseUrl,
} from './chatSessionProviderRuntime.js';
import {
  convertPartListUnionToIContent,
  validateHistory,
} from './MessageConverter.js';
import { splitPartsByRole } from './agenticLoop/loopHelpers.js';
import { resolveCompressionProvider } from './CompressionProfileResolver.js';
import type { CompressionProfileResolverContext } from './CompressionProfileResolver.js';

// Re-exports — consumers import from './chatSession.js'
export { StreamEventType } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
export type { StreamEvent } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
export {
  InvalidStreamError,
  EmptyStreamError,
  isSchemaDepthError,
} from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
export {
  aggregateTextWithSpacing,
  isValidNonThoughtTextPart,
} from './MessageConverter.js';

import type { StreamEvent } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import type { CompressionProviderResult } from '@vybestack/llxprt-code-core/core/compression/types.js';
import { CompressionProfileNotFoundError } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { PerformCompressionResult } from './turn.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { resolveSystemPromptForTurn } from './systemPromptModel.js';

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
  private logger = new DebugLogger('llxprt:gemini:chat');
  private readonly runtimeState: AgentRuntimeState;
  private historyService: HistoryService;
  private readonly generationConfig: ChatSessionConfig;

  // Composed modules
  private readonly compressionHandler: CompressionHandler;
  private readonly conversationManager: ConversationManager;
  private readonly turnProcessor: TurnProcessor;
  private readonly streamProcessor: StreamProcessor;
  private readonly directMessageProcessor: DirectMessageProcessor;
  private readonly tokenUsageLogger: TokenUsageLogger;
  private semanticMediaPurge: SemanticMediaPurgeSession;
  private readonly compressionLoadBalancerRoundRobinIndexes = new Map<
    string,
    number
  >();
  private readonly systemPromptAssembler?: SystemPromptAssembler;
  /** Serializes per-turn system-prompt resolution against send hand-off. */
  private systemPromptTurnChain: Promise<void> = Promise.resolve();
  private setHistoryAdmission?: SessionHistoryAdmission;
  private retainedHistoryAdmissions: readonly SessionHistoryAdmission[] = [];
  private historyAdmissionSequence = 0;
  private removeDensityWrapper?: () => void;

  constructor(
    private runtimeContext: AgentRuntimeContext,
    _contentGenerator: ContentGenerator,
    generationConfig: ChatSessionConfig = {},
    initialHistory: readonly IContent[] = [],
    triggerCompressionHook: typeof triggerPreCompressHook = triggerPreCompressHook,
    systemPromptAssembler?: SystemPromptAssembler,
  ) {
    this.runtimeState = this.runtimeContext.state;
    this.historyService = this.runtimeContext.history;
    this.generationConfig = generationConfig;
    this.semanticMediaPurge = this._createSemanticMediaPurgeSession();
    this.systemPromptAssembler = systemPromptAssembler;
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
    this.logInitialization(initialHistory.length);

    // Create composed modules
    const providerResolver = (ctx: string) =>
      this.resolveProviderForRuntime(ctx);
    const providerRuntimeBuilder = (s: string, m?: Record<string, unknown>) =>
      this.buildProviderRuntime(s, m);
    const resolveBaseUrl = (p: IProvider) =>
      resolveProviderBaseUrl(p, this.runtimeState.baseUrl);

    this.compressionHandler = new CompressionHandler(
      this.runtimeContext,
      this.historyService,
      this.generationConfig,
      this.resolveCompressionProvider.bind(this),
      createCompressionHookTrigger(triggerCompressionHook),
    );

    this.tokenUsageLogger = createTokenUsageLogger(this.runtimeContext);
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
      this.runtimeContext,
      initialBaseUrl,
    );

    this.conversationManager.importInitialHistory(initialHistory, model);

    this.streamProcessor = new StreamProcessor(
      this.runtimeContext,
      this.conversationManager,
      this.compressionHandler,
      providerResolver,
      providerRuntimeBuilder,
      this.historyService,
      this.generationConfig,
    );

    this.turnProcessor = new TurnProcessor(
      this.runtimeContext,
      this.compressionHandler,
      providerResolver,
      providerRuntimeBuilder,
      this.generationConfig,
      this.historyService,
      this.streamProcessor,
      resolveBaseUrl,
    );
    this.directMessageProcessor = new DirectMessageProcessor(
      this.runtimeContext,
      providerResolver,
      providerRuntimeBuilder,
      this.generationConfig,
      this.historyService,
    );
  }

  private logInitialization(initialHistoryLength: number): void {
    this.logger.debug('ChatSession initialized:', {
      model: this.runtimeState.model,
      initialHistoryLength,
      hasHistoryService: true,
      hasRuntimeState: true,
    });
  }

  takeHistoryAdmissions(): readonly SessionHistoryAdmission[] {
    const admissions = this.retainedHistoryAdmissions;
    this.retainedHistoryAdmissions = [];
    this.setHistoryAdmission = undefined;
    return admissions;
  }

  prepareHistoryRebind(
    history: HistoryService,
    previousChat?: Pick<ChatSession, 'takeHistoryAdmissions'>,
  ): () => void {
    const runtimeContext: AgentRuntimeContext = Object.freeze({
      ...this.runtimeContext,
      history,
      providerRuntime: Object.freeze({
        ...this.runtimeContext.providerRuntime,
        providerFileBindings: createHistoryProviderFileBindingStore(history),
      }),
    });
    const semanticMediaPurge = createSemanticMediaPurgeSession(
      runtimeContext,
      history,
    );
    return () => {
      this.retainedHistoryAdmissions = [
        ...this.retainedHistoryAdmissions,
        ...(previousChat?.takeHistoryAdmissions() ?? []),
      ];
      this.removeDensityWrapper?.();
      this.removeDensityWrapper = undefined;
      this.runtimeContext = runtimeContext;
      this.historyService = history;
      this.compressionHandler.rebindHistory(runtimeContext);
      this.conversationManager.rebindHistory(runtimeContext);
      this.streamProcessor.rebindHistory(runtimeContext);
      this.turnProcessor.rebindHistory(runtimeContext);
      this.directMessageProcessor.rebindHistory(runtimeContext);
      this.semanticMediaPurge = semanticMediaPurge;
      this._installDensityWrapper();
    };
  }

  private _createSemanticMediaPurgeSession(): SemanticMediaPurgeSession {
    return createSemanticMediaPurgeSession(
      this.runtimeContext,
      this.historyService,
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

  // ── Provider resolution (stays on coordinator) ───────────────────

  private getActiveProvider(): IProvider | undefined {
    try {
      return this.runtimeContext.provider.getActiveProvider();
    } catch {
      return undefined;
    }
  }

  private lookupProviderByName(
    adapter: AgentRuntimeProviderAdapter,
    desiredProviderName: string,
    compressionProfileName: string,
  ): IProvider | undefined {
    if (typeof adapter.getProviderByName !== 'function') {
      return undefined;
    }
    try {
      const candidate = adapter.getProviderByName(desiredProviderName);
      if (candidate !== undefined) {
        const active = this.getActiveProvider();
        if (active !== undefined && active.name !== desiredProviderName) {
          this.logger.debug(
            () =>
              `[ChatSession] selected provider '${desiredProviderName}' via getProviderByName (active remains '${active.name}') [${compressionProfileName}]`,
          );
        }
        return candidate;
      }
    } catch (error) {
      this.logger.debug(
        () =>
          `[ChatSession] provider lookup skipped (${compressionProfileName}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return undefined;
  }

  resolveProviderForRuntime(compressionProfileName: string): IProvider {
    const desiredProviderName = this.runtimeState.provider.trim();
    const adapter = this.runtimeContext.provider;

    if (desiredProviderName) {
      const candidate = this.lookupProviderByName(
        adapter,
        desiredProviderName,
        compressionProfileName,
      );
      if (candidate) {
        return candidate;
      }
    }

    let provider = this.getActiveProvider();
    if (!provider) {
      throw new Error('No active provider configured');
    }

    if (desiredProviderName && provider.name !== desiredProviderName) {
      const previousProviderName = provider.name;
      try {
        adapter.setActiveProvider(desiredProviderName);
        provider = adapter.getActiveProvider();
        this.logger.debug(
          () =>
            `[ChatSession] enforced provider switch to '${desiredProviderName}' (previous '${previousProviderName}') [${compressionProfileName}]`,
        );
      } catch (error) {
        this.logger.debug(
          () =>
            `[ChatSession] provider switch skipped (${compressionProfileName}, read-only context): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return provider;
  }

  private resolveExplicitCompressionProvider(
    profileName: string,
    providerName: string,
    lookupProviderName: string = providerName,
  ): IProvider {
    const adapter = this.runtimeContext.provider;
    const lookupResult = this.lookupProviderByName(
      adapter,
      lookupProviderName,
      `compression.profile:${profileName}`,
    );
    if (lookupResult) {
      return lookupResult;
    }

    const activeProvider = this.getActiveProvider();
    if (
      activeProvider?.name === providerName ||
      activeProvider?.name === lookupProviderName
    ) {
      return activeProvider;
    }

    throw new CompressionProfileNotFoundError(
      profileName,
      `provider '${lookupProviderName}' is not available for compression.profile: provider lookup by name is required when it is not already active`,
    );
  }

  providerSupportsIContent(provider: IProvider | undefined): boolean {
    if (!provider) return false;
    return (
      typeof (provider as { generateChatCompletion?: unknown })
        .generateChatCompletion === 'function'
    );
  }

  // ── Compression profile resolution (delegated to CompressionProfileResolver) ──

  private getCompressionProfileResolverContext(): CompressionProfileResolverContext {
    return {
      profileDefinitions: this.runtimeContext.profileDefinitions,
      providerRuntime: this.runtimeContext.providerRuntime,
      prepareProviderInvocation: this.runtimeContext.prepareProviderInvocation,
      runtimeState: this.runtimeState,
      resolveExplicitCompressionProvider:
        this.resolveExplicitCompressionProvider.bind(this),
      roundRobinIndexes: this.compressionLoadBalancerRoundRobinIndexes,
    };
  }

  private async resolveCompressionProvider(
    profileName: string | undefined,
  ): Promise<CompressionProviderResult> {
    return resolveCompressionProvider(
      this.getCompressionProfileResolverContext(),
      profileName,
      () =>
        this.resolveProviderForRuntime(
          'ChatSession.resolveCompressionProvider.default',
        ),
    );
  }

  private buildProviderRuntime(
    source: string,
    metadata: Record<string, unknown> = {},
  ): ProviderRequestCollaborators {
    const baseRuntime = this.runtimeContext.providerRuntime;
    const runtimeId = baseRuntime.runtimeId ?? this.runtimeState.runtimeId;

    return {
      ...baseRuntime,
      runtimeId,
      metadata: {
        ...(baseRuntime.metadata ?? {}),
        source,
        ...metadata,
      },
    };
  }

  // ── Public API — thin delegation ─────────────────────────────────

  private _beginSemanticMediaPurge(
    execution?: AgentChatRecordingExecution,
  ): ReturnType<SemanticMediaPurgeSession['begin']> {
    const purge = this.semanticMediaPurge;
    if (!purge.isEnabled()) return Promise.resolve(undefined);
    const active = this.runtimeContext.provider.getActiveProvider();
    const desiredName = this.runtimeState.provider;
    const provider =
      active.name === desiredName
        ? active
        : this.runtimeContext.provider.getProviderByName?.(desiredName);
    if (provider === undefined) {
      throw new Error(
        `Provider '${desiredName}' is unavailable for semantic media purge`,
      );
    }
    return purge.begin(
      requiresObservedSemanticPurgeCacheWrite(this.runtimeContext, provider),
      execution?.persistSemanticMediaPurge,
    );
  }

  /**
   * Resolves the complete system prompt once per turn using the
   * provider's current model, then writes it onto
   * {@link ChatSession.generationConfig.systemInstruction} and recomputes the
   * base token offset. This guarantees the rendered model name matches
   * `body.model` on the wire even after a mid-session `/model` change
   * (issue #3136). No-op when no assembler was injected.
   */
  private async _resolveSystemPromptForTurn(model: string): Promise<void> {
    await resolveSystemPromptForTurn(
      this.systemPromptAssembler,
      this.runtimeState.provider,
      model,
      this.historyService,
      (instruction) => {
        this.generationConfig.systemInstruction = instruction;
      },
    );
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
   */
  private async _withResolvedSystemPrompt<T>(
    send: () => Promise<T>,
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
    await resolved;
    return send();
  }

  async sendMessage(
    params: SendMessageParams,
    prompt_id: string,
    execution:
      | AgentChatRecordingExecution
      | undefined = params.recordingExecution,
  ): Promise<ModelOutput> {
    return this._withResolvedSystemPrompt(
      () =>
        this.turnProcessor.sendMessage(
          { ...params, recordingExecution: execution },
          prompt_id,
          () => this._beginSemanticMediaPurge(execution),
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
      () =>
        this.turnProcessor.sendMessageStream(
          { ...params, recordingExecution: execution },
          prompt_id,
          () => this._beginSemanticMediaPurge(execution),
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
      () =>
        this.directMessageProcessor.generateDirectMessage(
          params,
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
    return this.runtimeContext.tools;
  }

  setTools(tools: ToolDeclaration[]): void {
    this.generationConfig.tools = tools;
  }

  clearTools(): void {
    this.generationConfig.tools = undefined;
  }

  getHistory(curated: boolean = false): readonly IContent[] {
    return this.conversationManager.getHistory(curated);
  }

  private async admitSetHistory(
    history: readonly IContent[],
  ): Promise<SessionHistoryAdmission | undefined> {
    const mediaAdmission = this.runtimeContext.mediaAdmission;
    const hasLocalMedia = history.some((content) =>
      content.blocks.some(
        (block) =>
          block.type === 'media' &&
          (block.encoding === 'base64' || block.encoding === 'reference'),
      ),
    );
    if (mediaAdmission === undefined || !hasLocalMedia) return undefined;
    this.historyAdmissionSequence += 1;
    const context: MediaAdmissionContext = {
      turnId: `set-history:${this.historyAdmissionSequence}`,
      source: `set-history:${this.historyAdmissionSequence}`,
    };
    const admitted = await mediaAdmission.admitContents(history, context);
    const ownership: SessionHistoryAdmission = {
      history: admitted,
      release: () => mediaAdmission.releaseContents(admitted, context),
    };
    this.retainedHistoryAdmissions = [
      ...this.retainedHistoryAdmissions,
      ownership,
    ];
    return ownership;
  }

  private async releaseSessionHistoryAdmissions(
    admissions: readonly SessionHistoryAdmission[],
  ): Promise<readonly unknown[]> {
    const failures: unknown[] = [];
    for (const admission of admissions) {
      try {
        await admission.release();
        this.retainedHistoryAdmissions = this.retainedHistoryAdmissions.filter(
          (candidate) => candidate !== admission,
        );
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    return failures;
  }

  async clearHistory(): Promise<void> {
    await cleanupChatSessionProviderFiles(
      this.runtimeContext.providerRuntime.providerFileLifecycle,
      this.runtimeState.runtimeId,
    );
    const releaseFailures = await this.releaseSessionHistoryAdmissions(
      this.retainedHistoryAdmissions,
    );
    if (releaseFailures.length > 0) {
      throw new AggregateError(
        releaseFailures,
        'Chat history media cleanup was incomplete',
      );
    }
    this.setHistoryAdmission = undefined;
    this.conversationManager.clearHistory();
  }

  addHistory(content: IContent): void {
    this.conversationManager.addHistory(content);
  }

  async admitAndAddHistory(content: IContent): Promise<void> {
    const mediaAdmission = this.runtimeContext.mediaAdmission;
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
    await this.runtimeContext.mediaAdmission?.verifyHistory(history);
  }

  async setHistory(
    history: readonly IContent[],
    historyOrigin?: object,
  ): Promise<void> {
    const ownership = await this.admitSetHistory(history);
    const admitted = ownership?.history ?? history;
    try {
      await this.conversationManager.setHistory(admitted, historyOrigin);
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
    const previousOwnership = this.setHistoryAdmission;
    this.setHistoryAdmission = ownership;
    const releaseFailures = await this.releaseSessionHistoryAdmissions(
      previousOwnership === undefined ? [] : [previousOwnership],
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
  getProjectedPromptBaseline(): number {
    return this.compressionHandler.getProjectedPromptBaseline();
  }

  recordCompletedToolCalls(
    _model: string,
    toolCalls: CompletedToolCall[],
  ): void {
    const allBlocks = toolCalls.flatMap((toolCall): ContentBlock[] => {
      // Defensive for deserialized/test-cast tool responses that bypass the
      // static ToolCallResponseInfo contract.
      const response = toolCall.response as
        | { responseParts?: unknown }
        | undefined;
      const responseParts = response?.responseParts;
      if (!Array.isArray(responseParts)) {
        this.logger.warn(
          () =>
            `recordCompletedToolCalls: skipping tool call '${toolCall.request.callId}' because responseParts is not an array`,
        );
        return [];
      }
      return responseParts as ContentBlock[];
    });
    const { functionResponses } = splitPartsByRole(allBlocks);

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
      const responseCallIds = functionResponses
        .map((response) =>
          response.type === 'tool_response' ? response.callId : undefined,
        )
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
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

  shouldCompress(pendingTokens?: number): boolean {
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
    return this.runtimeContext.ephemerals.contextLimit();
  }

  /**
   * Resolves the base URL of the endpoint that would service the next provider
   * request: the load balancer's last-selected sub-profile URL when active,
   * otherwise the runtime base URL (native Anthropic default included).
   * Returns undefined when no endpoint is resolvable. Used for error
   * reporting so failures name the actual endpoint (@issue #2231); note that
   * provider resolution follows the same path a send would (including an
   * enforced active-provider switch), and resolution failures must never
   * mask the error being reported.
   */
  getResolvedBaseUrl(): string | undefined {
    try {
      const provider = this.resolveProviderForRuntime(
        'ChatSession.getResolvedBaseUrl',
      );
      return resolveProviderBaseUrl(provider, this.runtimeState.baseUrl);
    } catch {
      return undefined;
    }
  }

  /**
   * Returns the Config instance from the provider runtime.
   * Used by Turn and other consumers to access ephemeral settings.
   */
  getStreamTimeoutPolicy() {
    return this.runtimeContext.readStreamTimeoutPolicy();
  }

  shouldShowCitations(): boolean {
    return this.runtimeContext.showCitations();
  }

  getConfig(): Config | undefined {
    return this.runtimeContext.providerRuntime.config;
  }
}
