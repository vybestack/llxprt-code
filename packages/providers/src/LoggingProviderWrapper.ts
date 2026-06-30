/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P08
 */

import {
  type IProvider,
  type IModel,
  type GenerateChatOptions,
  type ProviderToolset,
} from './IProvider.js';
import {
  type IContent,
  type UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  logApiRequest,
  logApiError,
} from '@vybestack/llxprt-code-core/telemetry/loggers.js';
import {
  ApiRequestEvent,
  ApiErrorEvent,
} from '@vybestack/llxprt-code-core/telemetry/types.js';
import { estimateTokens } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { ProviderPerformanceTracker } from './logging/ProviderPerformanceTracker.js';
import type { ProviderPerformanceMetrics } from './types.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  ConfigBasedRedactor,
  type ConversationDataRedactor,
} from './logging/ConfigBasedRedactor.js';
import {
  type TokenCounts,
  extractTokenCountsFromTokenUsage,
  extractTokenCountsFromResponse,
} from './logging/tokenCounts.js';
import {
  extractChunkMetadata,
  hasTokenBearingOutput,
  extractSimpleContent,
} from './logging/streamChunkUtils.js';
import {
  type ResponseTokenCounts,
  emitMetricsTelemetry,
  emitResponseTelemetry,
  writeConversationLog,
} from './logging/telemetryEmitter.js';
import {
  logConversationRequestEntry,
  logToolCallEntry,
} from './logging/conversationLogger.js';
import { resolveAndValidateConfig } from './logging/configValidator.js';
import {
  normalizeChatCompletionOptions,
  ensureRuntimeContext,
} from './logging/optionsNormalizer.js';
import {
  type AccumulableTokenCounts,
  accumulateTokenUsage,
  resolveLoggingConfig,
} from './logging/tokenAccumulator.js';

export type { ConversationDataRedactor };

/**
 * @plan PLAN-20250909-TOKTRACK.P05
 * @plan:PLAN-20251023-STATELESS-HARDENING.P08
 * @requirement:REQ-SP4-004
 * @requirement:REQ-SP4-005
 * @pseudocode provider-runtime-handling.md lines 14-16
 * @pseudocode logging-wrapper-adjustments.md lines 11-15
 *
 * A minimal logging wrapper that acts as a transparent passthrough to the wrapped provider.
 * Only intercepts generateChatCompletion to log conversations while forwarding all other
 * methods directly to the wrapped provider without modification.
 *
 * In stateless hardening mode (P08), this wrapper:
 * - Drops constructor-captured config/settings
 * - Relies on per-call runtime metadata
 * - Implements runtime context push/pop (via runtimeContextResolver)
 * - Guards against missing runtime with MissingProviderRuntimeError
 */
export class LoggingProviderWrapper implements IProvider {
  private conversationId: string;
  private turnNumber: number = 0;
  private redactor: ConversationDataRedactor | null = null;
  private readonly injectedRedactor: ConversationDataRedactor | null = null;
  private performanceTracker: ProviderPerformanceTracker;
  private runtimeContextResolver?: () => ProviderRuntimeContext;
  private statelessRuntimeMetadata: Record<string, unknown> | null = null;
  private debug: DebugLogger;
  private optionsNormalizer:
    | ((
        options: GenerateChatOptions,
        providerName: string,
      ) => GenerateChatOptions)
    | null = null;

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-004
   * Constructor no longer captures config - it's provided per-call via options.
   */
  constructor(
    private readonly wrapped: IProvider,
    configOrRedactor?: Config | ConversationDataRedactor | null,
    injectedRedactor?: ConversationDataRedactor,
  ) {
    this.conversationId = this.generateConversationId();

    // Constructor accepts either an explicit redactor or a config-derived redactor.
    // New usage should NOT pass config here - config comes per-call.
    if (configOrRedactor && 'redactMessage' in configOrRedactor) {
      this.redactor = configOrRedactor;
      this.injectedRedactor = configOrRedactor;
    } else if (
      configOrRedactor &&
      'getConversationLoggingEnabled' in configOrRedactor
    ) {
      const config = configOrRedactor;
      this.redactor = new ConfigBasedRedactor(config.getRedactionConfig());
    }

    if (injectedRedactor) {
      this.redactor = injectedRedactor;
      this.injectedRedactor = injectedRedactor;
    }

    this.performanceTracker = new ProviderPerformanceTracker(wrapped.name);
    this.debug = new DebugLogger(`llxprt:provider:${wrapped.name}:logging`);

    // Set throttle tracker callback on the wrapped provider if it supports it
    if (
      'setThrottleTracker' in wrapped &&
      typeof wrapped.setThrottleTracker === 'function'
    ) {
      const provider = wrapped as IProvider & {
        setThrottleTracker: (tracker: (waitTimeMs: number) => void) => void;
      };
      provider.setThrottleTracker((waitTimeMs: number) => {
        this.performanceTracker.trackThrottleWaitTime(waitTimeMs);
      });
    }
  }

  /* @plan:PLAN-20251023-STATELESS-HARDENING.P06 */
  /* @requirement:REQ-SP4-004 */
  attachStatelessRuntimeMetadata(metadata: Record<string, unknown>): void {
    this.statelessRuntimeMetadata = { ...metadata };
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P05
   * @requirement:REQ-SP4-001
   * @pseudocode provider-runtime-handling.md lines 10-15
   * Registers a resolver so runtime context is injected per invocation.
   */
  setRuntimeContextResolver(resolver: () => ProviderRuntimeContext): void {
    this.runtimeContextResolver = resolver;
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-002
   * Allows ProviderManager.normalizeRuntimeInputs to run per invocation.
   */
  setOptionsNormalizer(
    normalizer: (
      options: GenerateChatOptions,
      providerName: string,
    ) => GenerateChatOptions,
  ): void {
    this.optionsNormalizer = normalizer;
  }

  /**
   * @plan PLAN-20251020-STATELESSPROVIDER3.P12
   * @requirement REQ-SP3-003
   * Access to the wrapped provider for unwrapping if needed.
   */
  get wrappedProvider(): IProvider {
    return this.wrapped;
  }

  // Passthrough properties
  get name(): string {
    return this.wrapped.name;
  }

  get isDefault(): boolean | undefined {
    return this.wrapped.isDefault;
  }

  // Passthrough methods - delegate everything to wrapped provider
  async getModels(): Promise<IModel[]> {
    return this.wrapped.getModels();
  }

  getDefaultModel(): string {
    return this.wrapped.getDefaultModel();
  }

  /**
   * @plan PLAN-20251018-STATELESSPROVIDER2.P06
   * @plan:PLAN-20251023-STATELESS-HARDENING.P05
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement REQ-SP2-001
   * @requirement:REQ-SP4-001
   * @requirement:REQ-SP4-004
   * @requirement:REQ-SP4-005
   * @pseudocode base-provider-call-contract.md lines 3-4
   * @plan PLAN-20250218-STATELESSPROVIDER.P04
   * @requirement REQ-SP-001
   * @pseudocode base-provider.md lines 7-15
   * @pseudocode provider-invocation.md lines 11-15
   * @pseudocode provider-runtime-handling.md lines 14-16
   */
  // Only method that includes logging - everything else is passthrough
  generateChatCompletion(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  generateChatCompletion(
    content: IContent[],
    tools?: ProviderToolset,
  ): AsyncIterableIterator<IContent>;
  async *generateChatCompletion(
    contentOrOptions: IContent[] | GenerateChatOptions,
    maybeTools?: ProviderToolset,
  ): AsyncIterableIterator<IContent> {
    const normalizedOptions = this.normalizeChatCompletionOptions(
      contentOrOptions,
      maybeTools,
    );
    this.ensureRuntimeContext(normalizedOptions);
    const activeConfig = this.resolveAndValidateConfig(normalizedOptions);
    this.setupRedactorAndLogging(normalizedOptions, activeConfig);
    const promptId = this.generatePromptId();
    this.turnNumber++;
    this.debug.log(
      () =>
        `After promptId generation: promptId=${promptId}, turnNumber=${this.turnNumber}`,
    );

    const conversationLoggingEnabled =
      this.checkConversationLoggingEnabled(activeConfig);

    if (conversationLoggingEnabled) {
      await this.logRequestIfEnabled(activeConfig, normalizedOptions, promptId);
    }

    this.logApiRequestTelemetry(activeConfig, normalizedOptions, promptId);

    this.debug.log(
      () =>
        `About to call wrapped provider: ${this.wrapped.name}, contentsLength=${normalizedOptions.contents.length}`,
    );
    const stream = this.wrapped.generateChatCompletion(normalizedOptions);
    this.debug.log(() => `Wrapped provider call completed, processing stream`);
    const resolvedModelName =
      normalizedOptions.resolved?.model ?? this.wrapped.getDefaultModel();
    if (!activeConfig.getConversationLoggingEnabled()) {
      yield* this.processStreamForMetrics(
        activeConfig,
        stream,
        resolvedModelName,
      );
      return;
    }
    yield* this.logResponseStream(
      activeConfig,
      stream,
      promptId,
      resolvedModelName,
    );
  }

  /** REQ-SP4-004: Normalize raw args into GenerateChatOptions, inject runtime, apply normalizer. */
  private normalizeChatCompletionOptions(
    contentOrOptions: IContent[] | GenerateChatOptions,
    maybeTools: ProviderToolset | undefined,
  ): GenerateChatOptions {
    return normalizeChatCompletionOptions(contentOrOptions, maybeTools, {
      runtimeContextResolver: this.runtimeContextResolver,
      statelessRuntimeMetadata: this.statelessRuntimeMetadata,
      optionsNormalizer: this.optionsNormalizer,
      providerName: this.wrapped.name,
    });
  }

  /** REQ-SP4-004: Throw if runtime context is missing settings or config. */
  private ensureRuntimeContext(normalizedOptions: GenerateChatOptions): void {
    ensureRuntimeContext(normalizedOptions, this.wrapped.name, this.debug);
  }

  /** Resolve config and validate it has required prototype methods. */
  private resolveAndValidateConfig(
    normalizedOptions: GenerateChatOptions,
  ): Config {
    return resolveAndValidateConfig(normalizedOptions, this.debug);
  }

  /** Set up per-call redactor and check conversation logging flag. */
  private setupRedactorAndLogging(
    normalizedOptions: GenerateChatOptions,
    activeConfig: Config,
  ): void {
    const invocation = normalizedOptions.invocation;
    if (this.injectedRedactor) {
      this.redactor = this.injectedRedactor;
      this.debug.log(
        () => `After redactor setup: hasRedactor=${!!this.redactor}`,
      );
      return;
    }

    if (invocation?.redaction) {
      this.redactor = new ConfigBasedRedactor({
        ...invocation.redaction,
      });
    } else {
      this.redactor = new ConfigBasedRedactor(
        activeConfig.getRedactionConfig(),
      );
    }
    this.debug.log(
      () => `After redactor setup: hasRedactor=${!!this.redactor}`,
    );
  }

  /** Check whether conversation logging is enabled, re-throwing on failure. */
  private checkConversationLoggingEnabled(activeConfig: Config): boolean {
    try {
      this.debug.log(() => `About to call getConversationLoggingEnabled()`);
      const enabled = activeConfig.getConversationLoggingEnabled();
      this.debug.log(
        () => `getConversationLoggingEnabled() returned: ${enabled}`,
      );
      return enabled;
    } catch (error) {
      this.debug.error(
        () =>
          `getConversationLoggingEnabled() threw exception: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /** Log the request if conversation logging is enabled. */
  private async logRequestIfEnabled(
    activeConfig: Config,
    normalizedOptions: GenerateChatOptions,
    promptId: string,
  ): Promise<void> {
    try {
      this.debug.log(
        () =>
          `Before logRequest: contents length = ${normalizedOptions.contents.length}`,
      );
      await this.logRequest(
        activeConfig,
        normalizedOptions.contents,
        normalizedOptions.tools,
        promptId,
      );
      this.debug.log(
        () =>
          `After logRequest: contents length = ${normalizedOptions.contents.length}`,
      );
    } catch (error) {
      this.debug.error(
        () =>
          `logRequest failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /** Log API request telemetry event. */
  private logApiRequestTelemetry(
    activeConfig: Config,
    normalizedOptions: GenerateChatOptions,
    promptId: string,
  ): void {
    this.debug.log(() => `Before API request telemetry section`);
    this.debug.log(
      () =>
        `Before JSON.stringify: contents length=${normalizedOptions.contents.length}`,
    );
    const requestText = JSON.stringify(normalizedOptions.contents);
    this.debug.log(
      () => `After JSON.stringify: requestText length=${requestText.length}`,
    );
    const modelName =
      normalizedOptions.resolved?.model ?? this.wrapped.getDefaultModel();
    this.debug.log(
      () => `Logging API request: model=${modelName}, promptId=${promptId}`,
    );
    logApiRequest(
      activeConfig,
      new ApiRequestEvent(modelName, promptId, requestText),
    );
    this.debug.log(
      () =>
        `After API request logged: contents length=${normalizedOptions.contents.length}`,
    );
  }

  private async logRequest(
    config: Config,
    content: IContent[],
    tools: ProviderToolset | undefined,
    promptId: string | undefined,
  ): Promise<void> {
    try {
      await logConversationRequestEntry(config, content, tools, promptId, {
        providerName: this.wrapped.name,
        conversationId: this.conversationId,
        turnNumber: this.turnNumber,
        generatePromptId: () => this.generatePromptId(),
        redactor: this.redactor,
      });
    } catch (error) {
      // Log error but don't fail the request
      this.debug.warn(() => `Failed to log conversation request: ${error}`);
    }
  }

  /**
   * Process stream to extract token metrics without logging
   * @plan PLAN-20250909-TOKTRACK
   * @issue #684 - Fixed: Now logs API response telemetry for /stats model
   */
  private async *processStreamForMetrics(
    config: Config | undefined,
    stream: AsyncIterableIterator<IContent>,
    modelName: string,
  ): AsyncIterableIterator<IContent> {
    const startTime = performance.now();
    let latestTokenUsage: UsageStats | undefined;
    let lastFinishReason: string | undefined;
    let streamedText = '';
    let firstChunkTime: number | null = null;
    let chunkCount = 0;

    try {
      for await (const chunk of stream) {
        chunkCount++;
        if (firstChunkTime === null && this.hasTokenBearingOutput(chunk)) {
          firstChunkTime = performance.now() - startTime;
        }
        this.extractChunkMetadata(
          chunk,
          (usage) => {
            latestTokenUsage = usage;
          },
          (reason) => {
            lastFinishReason = reason;
          },
          latestTokenUsage === undefined,
          (text) => {
            streamedText += text;
          },
        );
        yield chunk;
      }

      const duration = performance.now() - startTime;
      const tokenCounts = this.resolveTokenCounts(
        latestTokenUsage,
        streamedText,
      );
      this.emitMetricsTelemetry(
        config,
        tokenCounts,
        modelName,
        duration,
        lastFinishReason,
      );

      if (latestTokenUsage) {
        this.accumulateTokenUsage(tokenCounts, config);
      }

      const totalTokens =
        tokenCounts.input_token_count + tokenCounts.output_token_count;
      this.performanceTracker.recordCompletion(
        duration,
        firstChunkTime,
        totalTokens,
        chunkCount,
      );
    } catch (error) {
      this.handleMetricsStreamError(
        error,
        config,
        modelName,
        startTime,
        firstChunkTime,
        chunkCount,
      );
      throw error;
    }
  }

  /** Extract token usage, finish reason, and text from a stream chunk. */
  private extractChunkMetadata(
    chunk: IContent,
    onUsage: (usage: UsageStats) => void,
    onFinishReason: (reason: string) => void,
    shouldAccumulateText: boolean,
    onText: (text: string) => void,
  ): void {
    extractChunkMetadata(
      chunk,
      onUsage,
      onFinishReason,
      shouldAccumulateText,
      onText,
    );
  }

  /** Resolve token counts from usage stats or estimate from streamed text. */
  private resolveTokenCounts(
    latestTokenUsage: UsageStats | undefined,
    streamedText: string,
  ): ResponseTokenCounts {
    return latestTokenUsage
      ? this.extractTokenCountsFromTokenUsage(latestTokenUsage)
      : {
          input_token_count: 0,
          output_token_count:
            streamedText.length > 0 ? estimateTokens(streamedText) : 0,
          cached_content_token_count: 0,
          thoughts_token_count: 0,
          tool_token_count: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: null,
        };
  }

  /** Issue #684: Emit API response telemetry for /stats model tracking. */
  private emitMetricsTelemetry(
    config: Config | undefined,
    tokenCounts: ResponseTokenCounts,
    modelName: string,
    duration: number,
    lastFinishReason: string | undefined,
  ): void {
    emitMetricsTelemetry(
      config,
      tokenCounts,
      modelName,
      duration,
      lastFinishReason,
    );
  }

  /** Handle stream error: record in performance tracker and log API error telemetry. */
  private handleMetricsStreamError(
    error: unknown,
    config: Config | undefined,
    modelName: string,
    startTime: number,
    firstChunkTime: number | null,
    chunkCount: number,
  ): void {
    const duration = performance.now() - startTime;
    this.performanceTracker.recordError(
      duration,
      String(error),
      firstChunkTime,
      chunkCount,
    );
    if (config) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logApiError(
        config,
        new ApiErrorEvent(
          modelName,
          errorMessage,
          duration,
          '',
          'stream_error',
          undefined,
        ),
      );
    }
  }

  private async *logResponseStream(
    config: Config,
    stream: AsyncIterableIterator<IContent>,
    promptId: string,
    modelName: string,
  ): AsyncIterableIterator<IContent> {
    const startTime = performance.now();
    let responseContent = '';
    let latestTokenUsage: UsageStats | undefined;
    let lastFinishReason: string | undefined;
    let firstChunkTime: number | null = null;
    let chunkCount = 0;

    try {
      for await (const chunk of stream) {
        chunkCount++;
        if (firstChunkTime === null && this.hasTokenBearingOutput(chunk)) {
          firstChunkTime = performance.now() - startTime;
        }

        const content = extractSimpleContent(chunk);
        if (content) {
          responseContent += content;
        }

        this.extractChunkMetadata(
          chunk,
          (usage) => {
            latestTokenUsage = usage;
          },
          (reason) => {
            lastFinishReason = reason;
          },
          false,
          () => {},
        );

        yield chunk;
      }
    } catch (error) {
      const errorTime = performance.now();
      await this.logResponse(
        config,
        '',
        promptId,
        errorTime - startTime,
        false,
        error,
        latestTokenUsage,
        modelName,
        lastFinishReason ? [lastFinishReason] : [],
        firstChunkTime,
        chunkCount,
      );
      throw error;
    }

    const totalTime = performance.now() - startTime;
    await this.logResponse(
      config,
      responseContent,
      promptId,
      totalTime,
      true,
      undefined,
      latestTokenUsage,
      modelName,
      lastFinishReason ? [lastFinishReason] : [],
      firstChunkTime,
      chunkCount,
    );
  }

  // Simple content extraction without complex provider-specific logic
  private hasTokenBearingOutput(chunk: unknown): boolean {
    return hasTokenBearingOutput(chunk);
  }

  private async logResponse(
    config: Config,
    content: string,
    promptId: string,
    duration: number,
    success: boolean,
    error?: unknown,
    tokenUsage?: UsageStats,
    modelName?: string,
    finishReasons?: string[],
    timeToFirstToken?: number | null,
    chunkCount?: number,
  ): Promise<void> {
    try {
      const redactedContent = this.redactor
        ? this.redactor.redactResponseContent(content, this.wrapped.name)
        : content;

      const tokenCounts = tokenUsage
        ? this.extractTokenCountsFromTokenUsage(tokenUsage)
        : this.extractTokenCountsFromResponse(content);

      this.accumulateTokenUsage(tokenCounts, config);

      const perfTotalTokens =
        tokenCounts.input_token_count + tokenCounts.output_token_count;
      if (success) {
        this.performanceTracker.recordCompletion(
          duration,
          timeToFirstToken ?? null,
          perfTotalTokens,
          chunkCount ?? 0,
        );
      } else {
        this.performanceTracker.recordError(
          duration,
          error != null ? String(error) : 'Unknown stream error',
          timeToFirstToken ?? null,
          chunkCount ?? 0,
        );
      }

      this.emitResponseTelemetry(
        config,
        tokenCounts,
        modelName,
        promptId,
        duration,
        finishReasons,
        success,
        error,
      );
      await this.writeConversationLog(
        config,
        redactedContent,
        promptId,
        duration,
        success,
        error,
      );
    } catch (logError) {
      this.debug.warn(() => `Failed to log conversation response: ${logError}`);
    }
  }

  /** Emit token usage and API response telemetry events. */
  private emitResponseTelemetry(
    config: Config,
    tokenCounts: ResponseTokenCounts,
    modelName: string | undefined,
    promptId: string,
    duration: number,
    finishReasons: string[] | undefined,
    success: boolean,
    error: unknown,
  ): void {
    emitResponseTelemetry(
      config,
      tokenCounts,
      modelName,
      promptId,
      duration,
      finishReasons,
      success,
      error,
      {
        providerName: this.wrapped.name,
        conversationId: this.conversationId,
        turnNumber: this.turnNumber,
        defaultModelName: this.wrapped.getDefaultModel(),
      },
    );
  }

  /** Write conversation response event to telemetry and disk. */
  private async writeConversationLog(
    config: Config,
    redactedContent: string,
    promptId: string,
    duration: number,
    success: boolean,
    error: unknown,
  ): Promise<void> {
    await writeConversationLog(
      config,
      redactedContent,
      promptId,
      duration,
      success,
      error,
      {
        providerName: this.wrapped.name,
        conversationId: this.conversationId,
        turnNumber: this.turnNumber,
        defaultModelName: this.wrapped.getDefaultModel(),
      },
    );
  }

  private generateConversationId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generatePromptId(): string {
    return `prompt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  /**
   * Extract token counts from tokenUsage metadata
   */
  private extractTokenCountsFromTokenUsage(
    tokenUsage: UsageStats,
  ): TokenCounts {
    return extractTokenCountsFromTokenUsage(tokenUsage, this.debug);
  }

  /**
   * Extract token counts from response object or headers
   */
  extractTokenCountsFromResponse(response: unknown): TokenCounts {
    return extractTokenCountsFromResponse(response);
  }

  /**
   * Accumulate token usage for session tracking
   */
  private accumulateTokenUsage(
    tokenCounts: AccumulableTokenCounts,
    config: Config | undefined,
  ): void {
    accumulateTokenUsage(tokenCounts, config, this.wrapped.name, this.debug);
  }

  private resolveLoggingConfig(candidate: unknown): Config | undefined {
    return resolveLoggingConfig(candidate);
  }

  private async logToolCall(
    config: Config | undefined,
    toolName: string,
    params: unknown,
    result: unknown,
    startTime: number,
    success: boolean,
    error: unknown | undefined,
  ): Promise<void> {
    try {
      await logToolCallEntry(
        config,
        toolName,
        params,
        result,
        startTime,
        success,
        error,
        {
          providerName: this.wrapped.name,
          conversationId: this.conversationId,
          turnNumber: this.turnNumber,
          generatePromptId: () => this.generatePromptId(),
          redactor: this.redactor,
        },
      );
    } catch (logError) {
      this.debug.warn(() => `Failed to log tool call: ${logError}`);
    }
  }

  // All other methods are simple passthroughs to wrapped provider
  getCurrentModel?(): string {
    return this.wrapped.getCurrentModel?.() ?? '';
  }

  setRuntimeSettingsService?(settingsService: SettingsService): void {
    /**
     * @plan PLAN-20250218-STATELESSPROVIDER.P05
     * @requirement REQ-SP-001
     * @pseudocode provider-invocation.md lines 8-15
     */
    const runtimeAware = this.wrapped as IProvider & {
      setRuntimeSettingsService?: (settings: SettingsService) => void;
    };
    runtimeAware.setRuntimeSettingsService?.(settingsService);
  }

  getToolFormat?(): string {
    return this.wrapped.getToolFormat?.() ?? '';
  }

  isPaidMode?(): boolean {
    return this.wrapped.isPaidMode?.() ?? false;
  }

  clearState?(): void {
    if ('clearState' in this.wrapped) {
      const candidate = (this.wrapped as { clearState?: () => void })
        .clearState;
      candidate?.call(this.wrapped);
    }
    // Reset conversation logging state
    this.conversationId = this.generateConversationId();
    this.turnNumber = 0;
    this.performanceTracker.reset();
  }

  setConfig?(config: unknown): void {
    if ('setConfig' in this.wrapped) {
      const candidate = (
        this.wrapped as { setConfig?: (value: unknown) => void }
      ).setConfig;
      candidate?.call(this.wrapped, config);
    }
  }

  getServerTools(): string[] {
    return this.wrapped.getServerTools();
  }

  async invokeServerTool(
    toolName: string,
    params: unknown,
    config?: unknown,
  ): Promise<unknown> {
    const startTime = Date.now();
    const loggingConfig = this.resolveLoggingConfig(config);

    try {
      const result = await this.wrapped.invokeServerTool(
        toolName,
        params,
        config,
      );

      // Log tool call if logging is enabled and result has metadata
      if (loggingConfig?.getConversationLoggingEnabled() === true) {
        await this.logToolCall(
          loggingConfig,
          toolName,
          params,
          result,
          startTime,
          true,
          undefined,
        );
      }

      return result;
    } catch (error) {
      // Log failed tool call if logging is enabled
      if (loggingConfig?.getConversationLoggingEnabled() === true) {
        await this.logToolCall(
          loggingConfig,
          toolName,
          params,
          null,
          startTime,
          false,
          error,
        );
      }
      throw error;
    }
  }

  getModelParams?(): Record<string, unknown> | undefined {
    return this.wrapped.getModelParams?.();
  }

  getContextLimit?(): number | undefined {
    return this.wrapped.getContextLimit?.();
  }

  /**
   * Get the latest performance metrics from the tracker
   * @plan PLAN-20250909-TOKTRACK
   */
  getPerformanceMetrics(): ProviderPerformanceMetrics {
    return this.performanceTracker.getLatestMetrics();
  }

  /**
   * Delegate getStats() to wrapped provider if it supports it (e.g., LoadBalancingProvider)
   * @returns Stats from the underlying provider, or undefined if not supported
   */
  getStats(): unknown {
    if (
      'getStats' in this.wrapped &&
      typeof this.wrapped.getStats === 'function'
    ) {
      return (this.wrapped as { getStats: () => unknown }).getStats();
    }
    return undefined;
  }
}
