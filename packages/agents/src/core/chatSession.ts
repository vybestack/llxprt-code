/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// ChatSession — thin coordinator that wires up the decomposed modules.

import type {
  ModelGenerationSettings,
  ModelOutput,
  AgentMessageInput,
  ToolDeclaration,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ToolGroupArray } from './streamRequestHelpers.js';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { StructuredError } from '@vybestack/llxprt-code-core/core/turn.js';

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
  providerRequestContext?: Record<string, unknown>;
  tools?: ToolGroupArray;
  toolConfig?: unknown;
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
  message: AgentMessageInput;
  config?: ChatSessionConfig;
}
import type { CompletedToolCall } from './coreToolScheduler.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type {
  AgentRuntimeContext,
  AgentRuntimeProviderAdapter,
  ToolRegistryView,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { triggerPreCompressHook } from '@vybestack/llxprt-code-core/core/lifecycleHookTriggers.js';
import { PreCompressTrigger } from '@vybestack/llxprt-code-core/hooks/types.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';

// Decomposed modules
import { CompressionHandler } from '../compression/CompressionHandler.js';
import { ConversationManager } from './ConversationManager.js';
import { TurnProcessor } from './TurnProcessor.js';
import { StreamProcessor } from './StreamProcessor.js';
import { DirectMessageProcessor } from './DirectMessageProcessor.js';
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
import type {
  CompressionContext,
  CompressionProviderResult,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import { CompressionProfileNotFoundError } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { PerformCompressionResult } from './turn.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

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
  private readonly historyService: HistoryService;
  private readonly runtimeContext: AgentRuntimeContext;
  private readonly generationConfig: ChatSessionConfig;

  // Composed modules
  private readonly compressionHandler: CompressionHandler;
  private readonly conversationManager: ConversationManager;
  private readonly turnProcessor: TurnProcessor;
  private readonly streamProcessor: StreamProcessor;
  private readonly directMessageProcessor: DirectMessageProcessor;
  private readonly compressionLoadBalancerRoundRobinIndexes = new Map<
    string,
    number
  >();

  constructor(
    view: AgentRuntimeContext,
    contentGenerator: ContentGenerator,
    generationConfig: ChatSessionConfig = {},
    initialHistory: IContent[] = [],
  ) {
    this.runtimeContext = view;
    this.runtimeState = view.state;
    this.historyService = view.history;
    this.generationConfig = generationConfig;
    void contentGenerator;

    // Wire density-dirty tracking on historyService.add
    this._installDensityWrapper();

    validateHistory(initialHistory);

    const model = this.runtimeState.model;
    this.logger.debug('ChatSession initialized:', {
      model,
      initialHistoryLength: initialHistory.length,
      hasHistoryService: true,
      hasRuntimeState: true,
    });

    // Create composed modules
    const providerResolver = (ctx: string) =>
      this.resolveProviderForRuntime(ctx);
    const providerRuntimeBuilder = (s: string, m?: Record<string, unknown>) =>
      this.buildProviderRuntime(s, m);
    const resolveBaseUrl = (p: IProvider) => this.resolveProviderBaseUrl(p);

    this.compressionHandler = new CompressionHandler(
      view,
      this.historyService,
      this.generationConfig,
      this.resolveCompressionProvider.bind(this),
      async (context: CompressionContext) => {
        const config = view.providerRuntime.config;
        if (config) {
          await triggerPreCompressHook(
            config,
            context.trigger === 'auto'
              ? PreCompressTrigger.Auto
              : PreCompressTrigger.Manual,
          );
        }
      },
    );

    this.conversationManager = new ConversationManager(
      this.historyService,
      view,
      model,
    );

    this.conversationManager.importInitialHistory(initialHistory, model);

    this.streamProcessor = new StreamProcessor(
      view,
      this.conversationManager,
      this.compressionHandler,
      providerResolver,
      providerRuntimeBuilder,
      this.historyService,
      this.generationConfig,
    );

    const { turnProcessor, directMessageProcessor } =
      this._buildMessageProcessors(
        view,
        providerResolver,
        providerRuntimeBuilder,
        resolveBaseUrl,
      );
    this.turnProcessor = turnProcessor;
    this.directMessageProcessor = directMessageProcessor;
  }

  private _buildMessageProcessors(
    view: AgentRuntimeContext,
    providerResolver: (ctx: string) => IProvider,
    providerRuntimeBuilder: (
      s: string,
      m?: Record<string, unknown>,
    ) => ProviderRuntimeContext,
    resolveBaseUrl: (p: IProvider) => string | undefined,
  ): {
    turnProcessor: TurnProcessor;
    directMessageProcessor: DirectMessageProcessor;
  } {
    const turnProcessor = new TurnProcessor(
      view,
      this.compressionHandler,
      providerResolver,
      providerRuntimeBuilder,
      this.generationConfig,
      this.historyService,
      this.streamProcessor,
      resolveBaseUrl,
    );

    const directMessageProcessor = new DirectMessageProcessor(
      view,
      providerResolver,
      providerRuntimeBuilder,
      this.generationConfig,
      this.historyService,
    );

    return { turnProcessor, directMessageProcessor };
  }

  // ── Density wrapper ──────────────────────────────────────────────

  private static readonly DENSITY_WRAPPED = Symbol('densityWrapped');

  private _installDensityWrapper(): void {
    if (typeof this.historyService.add !== 'function') return;
    const hs = this.historyService as unknown as Record<symbol, unknown>;
    if (hs[ChatSession.DENSITY_WRAPPED] === true) return;
    const originalAdd = this.historyService.add.bind(this.historyService);
    this.historyService.add = (...args: Parameters<typeof originalAdd>) => {
      const result = originalAdd(...args);
      this.compressionHandler.markDensityDirty();
      return result;
    };
    hs[ChatSession.DENSITY_WRAPPED] = true;
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
      providerRuntime: this.runtimeContext.providerRuntime,
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

  private resolveProviderBaseUrl(_provider: IProvider): string | undefined {
    return this.runtimeState.baseUrl;
  }

  private buildProviderRuntime(
    source: string,
    metadata: Record<string, unknown> = {},
  ): ProviderRuntimeContext {
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

  async sendMessage(
    params: SendMessageParams,
    prompt_id: string,
  ): Promise<ModelOutput> {
    return this.turnProcessor.sendMessage(params, prompt_id);
  }

  async sendMessageStream(
    params: SendMessageParams,
    prompt_id: string,
  ): Promise<AsyncGenerator<StreamEvent>> {
    return this.turnProcessor.sendMessageStream(params, prompt_id);
  }

  async generateDirectMessage(
    params: SendMessageParams,
    prompt_id: string,
  ): Promise<ModelOutput> {
    return this.directMessageProcessor.generateDirectMessage(params, prompt_id);
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
    this.generationConfig.tools = [{ functionDeclarations: tools }];
  }

  clearTools(): void {
    this.generationConfig.tools = undefined;
  }

  getHistory(curated: boolean = false): IContent[] {
    return this.conversationManager.getHistory(curated);
  }

  clearHistory(): void {
    this.conversationManager.clearHistory();
  }

  addHistory(content: IContent): void {
    this.conversationManager.addHistory(content);
  }

  setHistory(history: IContent[]): void {
    this.conversationManager.setHistory(history);
  }

  setActiveTodosProvider(provider: () => Promise<string | undefined>): void {
    this.compressionHandler.setActiveTodosProvider(provider);
  }

  async performCompression(
    prompt_id: string,
    options?: { bypassCooldown?: boolean; trigger?: 'manual' | 'auto' },
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
  ): Promise<void> {
    return this.compressionHandler.enforceContextWindow(
      pendingTokens,
      promptId,
    );
  }

  shouldCompress(pendingTokens?: number): boolean {
    return this.compressionHandler.shouldCompress(pendingTokens);
  }

  /**
   * Returns the Config instance from the provider runtime.
   * Used by Turn and other consumers to access ephemeral settings.
   */
  getConfig(): Config | undefined {
    return this.runtimeContext.providerRuntime.config;
  }
}
