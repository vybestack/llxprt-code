/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// GeminiChat — thin coordinator that wires up the decomposed modules.

import type {
  Content,
  GenerateContentConfig,
  GenerateContentResponse,
  SendMessageParameters,
  Tool,
  PartListUnion,
} from '@google/genai';
import type { CompletedToolCall } from './coreToolScheduler.js';
import type { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import type { IProvider } from '../providers/IProvider.js';
import { DebugLogger } from '../debug/index.js';
import type { AgentRuntimeState } from '../runtime/AgentRuntimeState.js';
import type {
  AgentRuntimeContext,
  ToolRegistryView,
} from '../runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import { triggerPreCompressHook } from './lifecycleHookTriggers.js';
import { PreCompressTrigger } from '../hooks/types.js';
import type { ContentGenerator } from './contentGenerator.js';

// Decomposed modules
import { CompressionHandler } from './compression/CompressionHandler.js';
import { ConversationManager } from './ConversationManager.js';
import { TurnProcessor } from './TurnProcessor.js';
import { StreamProcessor } from './StreamProcessor.js';
import { DirectMessageProcessor } from './DirectMessageProcessor.js';
import {
  convertPartListUnionToIContent,
  convertIContentToResponse,
  validateHistory,
} from './MessageConverter.js';

// Re-exports for backward compatibility — consumers import from './geminiChat.js'
export { StreamEventType, StreamEvent } from './geminiChatTypes.js';
export {
  InvalidStreamError,
  EmptyStreamError,
  isSchemaDepthError,
} from './geminiChatTypes.js';
export {
  aggregateTextWithSpacing,
  isValidNonThoughtTextPart,
} from './MessageConverter.js';

import type { StreamEvent } from './geminiChatTypes.js';
import type { CompressionContext } from './compression/types.js';
import type { Config } from '../config/config.js';
import { PerformCompressionResult } from './turn.js';

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
    super(`Agent execution stopped: ${systemMessage || reason}`);
    this.name = 'AgentExecutionStoppedError';
    this.reason = reason;
    this.systemMessage = systemMessage;
    this.contextCleared = contextCleared;
  }
}

/**
 * Error thrown when agent execution is blocked by a hook.
 */
export class AgentExecutionBlockedError extends Error {
  readonly reason: string;
  readonly systemMessage?: string;
  readonly syntheticResponse?: GenerateContentResponse;
  readonly contextCleared?: boolean;

  constructor(
    reason: string,
    syntheticResponse?: GenerateContentResponse,
    systemMessage?: string,
    contextCleared?: boolean,
  ) {
    super(`Agent execution blocked: ${systemMessage || reason}`);
    this.name = 'AgentExecutionBlockedError';
    this.reason = reason;
    this.systemMessage = systemMessage;
    this.syntheticResponse = syntheticResponse;
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
export class GeminiChat {
  private logger = new DebugLogger('llxprt:gemini:chat');
  private readonly runtimeState: AgentRuntimeState;
  private readonly historyService: HistoryService;
  private readonly runtimeContext: AgentRuntimeContext;
  private readonly generationConfig: GenerateContentConfig;

  // Composed modules
  private readonly compressionHandler: CompressionHandler;
  private readonly conversationManager: ConversationManager;
  private readonly turnProcessor: TurnProcessor;
  private readonly streamProcessor: StreamProcessor;
  private readonly directMessageProcessor: DirectMessageProcessor;

  constructor(
    view: AgentRuntimeContext,
    contentGenerator: ContentGenerator,
    generationConfig: GenerateContentConfig = {},
    initialHistory: Content[] = [],
  ) {
    if (!view) {
      throw new Error('AgentRuntimeContext is required for GeminiChat');
    }

    this.runtimeContext = view;
    this.runtimeState = view.state;
    this.historyService = view.history;
    this.generationConfig = generationConfig;
    void contentGenerator;

    // Wire density-dirty tracking on historyService.add
    this._installDensityWrapper();

    validateHistory(initialHistory);

    const model = this.runtimeState.model;
    this.logger.debug('GeminiChat initialized:', {
      model,
      initialHistoryLength: initialHistory.length,
      hasHistoryService: !!this.historyService,
      hasRuntimeState: true,
    });

    // Create composed modules
    const providerResolver = (ctx: string) =>
      this.resolveProviderForRuntime(ctx);
    const providerRuntimeBuilder = (s: string, m?: Record<string, unknown>) =>
      this.buildProviderRuntime(s, m);
    const makePositionMatcher = () => this._makePositionMatcher();
    const resolveBaseUrl = (p: IProvider) => this.resolveProviderBaseUrl(p);

    this.compressionHandler = new CompressionHandler(
      view,
      this.historyService,
      this.generationConfig,
      providerResolver,
      async (context: CompressionContext) => {
        const config = view.providerRuntime?.config;
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

    this.turnProcessor = new TurnProcessor(
      view,
      this.compressionHandler,
      providerResolver,
      providerRuntimeBuilder,
      this.generationConfig,
      this.historyService,
      this.streamProcessor,
      makePositionMatcher,
      resolveBaseUrl,
    );

    this.directMessageProcessor = new DirectMessageProcessor(
      view,
      providerResolver,
      providerRuntimeBuilder,
      this.historyService,
      makePositionMatcher,
    );
  }

  // ── Density wrapper ──────────────────────────────────────────────

  private static readonly DENSITY_WRAPPED = Symbol('densityWrapped');

  private _installDensityWrapper(): void {
    if (typeof this.historyService.add !== 'function') return;
    const hs = this.historyService as unknown as Record<symbol, unknown>;
    if (hs[GeminiChat.DENSITY_WRAPPED]) return;
    const originalAdd = this.historyService.add.bind(this.historyService);
    this.historyService.add = (...args: Parameters<typeof originalAdd>) => {
      const result = originalAdd(...args);
      this.compressionHandler?.markDensityDirty();
      return result;
    };
    hs[GeminiChat.DENSITY_WRAPPED] = true;
  }

  // ── Provider resolution (stays on coordinator) ───────────────────

  private getActiveProvider(): IProvider | undefined {
    try {
      return this.runtimeContext.provider.getActiveProvider();
    } catch {
      return undefined;
    }
  }

  resolveProviderForRuntime(contextLabel: string): IProvider {
    const desiredProviderName = this.runtimeState.provider?.trim();
    const adapter = this.runtimeContext.provider;

    if (desiredProviderName) {
      try {
        const candidate =
          typeof adapter.getProviderByName === 'function'
            ? adapter.getProviderByName(desiredProviderName)
            : undefined;
        if (candidate) {
          const active = this.getActiveProvider();
          if (active && active.name !== desiredProviderName) {
            this.logger.debug(
              () =>
                `[GeminiChat] selected provider '${desiredProviderName}' via getProviderByName (active remains '${active.name}') [${contextLabel}]`,
            );
          }
          return candidate;
        }
      } catch (error) {
        this.logger.debug(
          () =>
            `[GeminiChat] provider lookup skipped (${contextLabel}): ${error instanceof Error ? error.message : String(error)}`,
        );
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
        const updatedProvider = adapter.getActiveProvider();
        if (updatedProvider) {
          provider = updatedProvider;
        }
        this.logger.debug(
          () =>
            `[GeminiChat] enforced provider switch to '${desiredProviderName}' (previous '${previousProviderName}') [${contextLabel}]`,
        );
      } catch (error) {
        this.logger.debug(
          () =>
            `[GeminiChat] provider switch skipped (${contextLabel}, read-only context): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return provider;
  }

  providerSupportsIContent(provider: IProvider | undefined): boolean {
    if (!provider) return false;
    return (
      typeof (provider as { generateChatCompletion?: unknown })
        .generateChatCompletion === 'function'
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
    const runtimeId =
      baseRuntime.runtimeId ?? this.runtimeState.runtimeId ?? 'geminiChat';

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

  // ── Position matcher (used by multiple modules) ──────────────────

  private _makePositionMatcher():
    | (() => { historyId: string; toolName?: string })
    | undefined {
    return this.conversationManager.makePositionMatcher();
  }

  // ── Public API — thin delegation ─────────────────────────────────

  async sendMessage(
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<GenerateContentResponse> {
    return this.turnProcessor.sendMessage(params, prompt_id);
  }

  async sendMessageStream(
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<AsyncGenerator<StreamEvent>> {
    return this.turnProcessor.sendMessageStream(params, prompt_id);
  }

  async generateDirectMessage(
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<GenerateContentResponse> {
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

  setTools(tools: Tool[]): void {
    this.generationConfig.tools = tools;
  }

  clearTools(): void {
    this.generationConfig.tools = undefined;
  }

  getHistory(curated: boolean = false): Content[] {
    return this.conversationManager.getHistory(curated);
  }

  clearHistory(): void {
    this.conversationManager.clearHistory();
  }

  addHistory(content: Content): void {
    this.conversationManager.addHistory(content);
  }

  setHistory(history: Content[]): void {
    this.conversationManager.setHistory(history);
  }

  setActiveTodosProvider(provider: () => Promise<string | undefined>): void {
    this.compressionHandler.setActiveTodosProvider(provider);
  }

  async performCompression(
    prompt_id: string,
    options?: { bypassCooldown?: boolean },
  ): Promise<PerformCompressionResult> {
    return this.compressionHandler.performCompression(prompt_id, options);
  }

  wasRecentlyCompressed(): boolean {
    return this.compressionHandler.wasRecentlyCompressed();
  }

  getLastPromptTokenCount(): number {
    return this.compressionHandler.lastPromptTokenCount ?? 0;
  }

  recordCompletedToolCalls(
    _model: string,
    _toolCalls: CompletedToolCall[],
  ): void {
    // No-op stub for compatibility
  }

  // Public conversion methods — delegated to standalone functions
  convertPartListUnionToIContent(input: PartListUnion): IContent {
    return convertPartListUnionToIContent(input);
  }

  convertIContentToResponse(input: IContent): GenerateContentResponse {
    return convertIContentToResponse(input);
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

  get _suppressDensityDirty(): boolean {
    return this.compressionHandler._suppressDensityDirty;
  }

  set _suppressDensityDirty(value: boolean) {
    this.compressionHandler._suppressDensityDirty = value;
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
    return this.runtimeContext.providerRuntime?.config;
  }
}
