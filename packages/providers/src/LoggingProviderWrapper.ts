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
import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
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
  extractTokenCountsFromResponse,
} from './logging/tokenCounts.js';
import { writeResponseLog as writeResponseLogEntry } from './logging/conversationResponseLogger.js';
import { logApiRequestTelemetry as logApiRequestTelemetryEntry } from './logging/apiRequestLogger.js';
import {
  normalizeChatCompletionOptions,
  ensureRuntimeContext,
} from './logging/optionsNormalizer.js';
import { resolveAndValidateConfig } from './logging/configValidator.js';
import {
  setupRedactor,
  checkConversationLoggingEnabled,
  logRequestIfEnabled,
} from './logging/requestSetupHelpers.js';
import {
  processStreamWithRecorderGen,
  logResponseStreamWithRecorderGen,
} from './logging/streamProcessor.js';
import {
  delegateGetStats,
  delegateGetLoadBalancerConfig,
} from './loadBalancing/wrappedProviderDelegation.js';
import {
  ATTEMPT_LIFECYCLE_KEY,
  type AttemptLifecycleObserver,
} from './logging/attemptLifecycle.js';
import { AttemptRecorder } from './logging/attemptRecorder.js';
import { isWrapperLifecycleOwner } from './logging/lifecycleOwnership.js';
import { invokeServerToolWithLogging } from './logging/serverToolLogger.js';
import { safeGetDefaultModel } from './utils/safeDefaultModel.js';

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
    return safeGetDefaultModel(this.wrapped);
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
    const conversationLoggingEnabled =
      this.checkConversationLoggingEnabled(activeConfig);

    if (conversationLoggingEnabled) {
      await this.logRequestIfEnabled(activeConfig, normalizedOptions, promptId);
    }

    this.logApiRequestTelemetry(activeConfig, normalizedOptions, promptId);

    const resolvedModelName =
      normalizedOptions.resolved?.model ?? this.getDefaultModel();

    // Inner retry/load-balancer transports own their attempts; a direct
    // provider leaves lifecycle ownership to this wrapper.
    const wrapperOwned = this.isWrapperLifecycleOwner();

    // Install the recorder so an inner lifecycle owner can invoke it.
    const recorder = new AttemptRecorder({
      providerName: this.wrapped.name,
      defaultModelName: this.getDefaultModel(),
      config: activeConfig,
      logicalRequestId: promptId,
      wrapperOwned,
    });
    const optionsWithLifecycle: GenerateChatOptions = {
      ...normalizedOptions,
      metadata: {
        ...(normalizedOptions.metadata ?? {}),
        [ATTEMPT_LIFECYCLE_KEY]: recorder satisfies AttemptLifecycleObserver,
      },
    };

    // Start direct attempts before invocation so synchronous failures finalize.
    if (wrapperOwned) {
      recorder.ensureAttemptStarted();
    }

    let stream: AsyncIterableIterator<IContent>;
    // performance.now() is monotonic and unaffected by wall-clock
    // adjustments (NTP, DST), making elapsed-time measurement correct
    // even across a system clock change.
    const requestStartTime = performance.now();
    try {
      stream = this.wrapped.generateChatCompletion(optionsWithLifecycle);
    } catch (syncError) {
      // Synchronous throw from the provider — record performance, finalize
      // as error, and re-throw. Stream errors also call recordError, so this
      // closes the observability gap for synchronous failures.
      const elapsedMs = performance.now() - requestStartTime;
      this.performanceTracker.recordError(
        elapsedMs,
        String(syncError),
        null,
        0,
      );
      recorder.finalizeAttempt(
        'error',
        resolvedModelName,
        undefined,
        syncError instanceof Error ? syncError.message : String(syncError),
      );
      throw syncError;
    }
    this.debug.log(() => `Wrapped provider call completed, processing stream`);

    if (!activeConfig.getConversationLoggingEnabled()) {
      yield* this.processStreamWithRecorder(
        activeConfig,
        stream,
        resolvedModelName,
        promptId,
        recorder,
      );
      return;
    }
    yield* this.logResponseStreamWithRecorder(
      activeConfig,
      stream,
      promptId,
      resolvedModelName,
      recorder,
    );
  }

  /**
   * Determine whether this wrapper is the canonical lifecycle owner.
   * Delegates to the standalone helper for chain inspection logic.
   */
  private isWrapperLifecycleOwner(): boolean {
    return isWrapperLifecycleOwner(this.wrapped);
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
    this.redactor = setupRedactor(normalizedOptions, activeConfig, {
      providerName: this.wrapped.name,
      conversationId: this.conversationId,
      turnNumber: this.turnNumber,
      defaultModelName: this.getDefaultModel(),
      generatePromptId: () => this.generatePromptId(),
      injectedRedactor: this.injectedRedactor,
      debug: this.debug,
    });
  }

  /** Check whether conversation logging is enabled, re-throwing on failure. */
  private checkConversationLoggingEnabled(activeConfig: Config): boolean {
    return checkConversationLoggingEnabled(activeConfig, this.debug);
  }

  /** Log the request if conversation logging is enabled. */
  private async logRequestIfEnabled(
    activeConfig: Config,
    normalizedOptions: GenerateChatOptions,
    promptId: string,
  ): Promise<void> {
    await logRequestIfEnabled(
      activeConfig,
      normalizedOptions,
      promptId,
      this.redactor,
      {
        providerName: this.wrapped.name,
        conversationId: this.conversationId,
        turnNumber: this.turnNumber,
        defaultModelName: this.getDefaultModel(),
        generatePromptId: () => this.generatePromptId(),
        injectedRedactor: this.injectedRedactor,
        debug: this.debug,
      },
    );
  }

  /** Log API request telemetry event. */
  private logApiRequestTelemetry(
    activeConfig: Config,
    normalizedOptions: GenerateChatOptions,
    promptId: string,
  ): void {
    logApiRequestTelemetryEntry(
      activeConfig,
      normalizedOptions,
      promptId,
      this.getDefaultModel(),
      this.debug,
    );
  }

  /** Write a conversation response log entry to telemetry and disk (fail-open). */
  private async writeResponseLog(
    config: Config,
    content: string,
    promptId: string,
    duration: number,
    success: boolean,
    error: unknown,
  ): Promise<void> {
    await writeResponseLogEntry(
      config,
      content,
      promptId,
      duration,
      success,
      error,
      {
        providerName: this.wrapped.name,
        conversationId: this.conversationId,
        turnNumber: this.turnNumber,
        defaultModelName: this.getDefaultModel(),
        generatePromptId: () => this.generatePromptId(),
        redactor: this.redactor,
        debug: this.debug,
      },
    );
  }

  private async *processStreamWithRecorder(
    config: Config | undefined,
    stream: AsyncIterableIterator<IContent>,
    modelName: string,
    promptId: string,
    recorder: AttemptRecorder,
  ): AsyncIterableIterator<IContent> {
    yield* processStreamWithRecorderGen(
      config,
      stream,
      modelName,
      promptId,
      recorder,
      {
        providerName: this.wrapped.name,
        debug: this.debug,
        performanceTracker: this.performanceTracker,
      },
    );
  }

  private async *logResponseStreamWithRecorder(
    config: Config,
    stream: AsyncIterableIterator<IContent>,
    promptId: string,
    modelName: string,
    recorder: AttemptRecorder,
  ): AsyncIterableIterator<IContent> {
    yield* logResponseStreamWithRecorderGen(
      config,
      stream,
      promptId,
      modelName,
      recorder,
      {
        providerName: this.wrapped.name,
        debug: this.debug,
        performanceTracker: this.performanceTracker,
      },
      (content, pid, duration, success, error) =>
        this.writeResponseLog(config, content, pid, duration, success, error),
    );
  }

  private generateConversationId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generatePromptId(): string {
    return `prompt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  /**
   * Extract token counts from response object or headers
   */
  extractTokenCountsFromResponse(response: unknown): TokenCounts {
    return extractTokenCountsFromResponse(response);
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
    return invokeServerToolWithLogging(this.wrapped, toolName, params, config, {
      providerName: this.wrapped.name,
      conversationId: this.conversationId,
      turnNumber: this.turnNumber,
      generatePromptId: () => this.generatePromptId(),
      redactor: this.redactor,
      debug: this.debug,
    });
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

  /** Delegate getStats() to the wrapped provider (e.g., LoadBalancingProvider). */
  getStats(): unknown {
    return delegateGetStats(this.wrapped);
  }

  /** Delegate getLoadBalancerConfig() down the wrapper chain (issue #2479). */
  getLoadBalancerConfig(): unknown {
    return delegateGetLoadBalancerConfig(this.wrapped);
  }
}
