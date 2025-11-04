/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P08
 */

import {
  IProvider,
  IModel,
  ITool,
  GenerateChatOptions,
  ProviderToolset,
} from './IProvider.js';
import { IContent, UsageStats } from '../services/history/IContent.js';
import { Config, RedactionConfig } from '../config/config.js';
import {
  logConversationRequest,
  logConversationResponse,
  logTokenUsage,
  logApiRequest,
} from '../telemetry/loggers.js';
import {
  ConversationRequestEvent,
  ConversationResponseEvent,
  TokenUsageEvent,
  ApiRequestEvent,
} from '../telemetry/types.js';
import { getConversationFileWriter } from '../storage/ConversationFileWriter.js';
import { ProviderPerformanceTracker } from './logging/ProviderPerformanceTracker.js';
import { DebugLogger } from '../debug/DebugLogger.js';
import type { SettingsService } from '../settings/SettingsService.js';
import type { ProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import { MissingProviderRuntimeError } from './errors.js';

export interface ConversationDataRedactor {
  redactMessage(content: IContent, provider: string): IContent;
  redactToolCall(tool: ITool): ITool;
  redactResponseContent(content: string, provider: string): string;
}

// Simple redactor that works with RedactionConfig
class ConfigBasedRedactor implements ConversationDataRedactor {
  constructor(private redactionConfig: RedactionConfig) {}

  redactMessage(content: IContent, providerName: string): IContent {
    if (!this.shouldRedact()) {
      return content;
    }

    const redactedContent = { ...content };

    // Redact text blocks
    redactedContent.blocks = redactedContent.blocks.map((block) => {
      if (block.type === 'text') {
        return {
          ...block,
          text: this.redactContent(block.text, providerName),
        };
      } else if (block.type === 'tool_call') {
        // For tool calls, we'll redact the parameters as JSON strings then parse back
        const redactedParams = this.redactContent(
          JSON.stringify(block.parameters),
          providerName,
        );
        return {
          ...block,
          parameters: JSON.parse(redactedParams),
        };
      }
      return block;
    });

    return redactedContent;
  }

  redactToolCall(tool: ITool): ITool {
    if (!this.shouldRedact()) {
      return tool;
    }

    const redactedTool = { ...tool };

    if (redactedTool.function.parameters && tool.function.name) {
      const redactedParams = this.redactContent(
        JSON.stringify(redactedTool.function.parameters),
        'global',
      );
      try {
        redactedTool.function.parameters = JSON.parse(redactedParams);
      } catch {
        // If parsing fails, keep original parameters
        redactedTool.function.parameters = tool.function.parameters;
      }
    }

    return redactedTool;
  }

  redactResponseContent(content: string, providerName: string): string {
    if (!this.shouldRedact()) {
      return content;
    }

    return this.redactContent(content, providerName);
  }

  private shouldRedact(): boolean {
    return (
      this.redactionConfig.redactApiKeys ||
      this.redactionConfig.redactCredentials ||
      this.redactionConfig.redactFilePaths ||
      this.redactionConfig.redactUrls ||
      this.redactionConfig.redactEmails ||
      this.redactionConfig.redactPersonalInfo
    );
  }

  private redactContent(content: string, _providerName: string): string {
    let redacted = content;

    // Apply basic API key redaction if enabled
    if (this.redactionConfig.redactApiKeys) {
      redacted = redacted.replace(/sk-[a-zA-Z0-9]{32,}/g, '[REDACTED-API-KEY]');
      redacted = redacted.replace(
        /sk-proj-[a-zA-Z0-9]{48}/g,
        '[REDACTED-OPENAI-PROJECT-KEY]',
      );
      redacted = redacted.replace(
        /sk-ant-[a-zA-Z0-9\-_]{95}/g,
        '[REDACTED-ANTHROPIC-KEY]',
      );
      redacted = redacted.replace(
        /AIza[0-9A-Za-z\-_]{35}/g,
        '[REDACTED-GOOGLE-KEY]',
      );
    }

    // Apply credential redaction if enabled
    if (this.redactionConfig.redactCredentials) {
      redacted = redacted.replace(
        /(?:password|pwd|pass)[=:\s]+[^\s\n\r]+/gi,
        'password=[REDACTED]',
      );
      redacted = redacted.replace(
        /bearer [a-zA-Z0-9-_.]{16,}/gi,
        'bearer [REDACTED-BEARER-TOKEN]',
      );
    }

    // Apply file path redaction if enabled
    if (this.redactionConfig.redactFilePaths) {
      redacted = redacted.replace(
        /\/[^"\s]*\.ssh\/[^"\s]*/g,
        '[REDACTED-SSH-PATH]',
      );
      redacted = redacted.replace(
        /\/[^"\s]*\.env[^"\s]*/g,
        '[REDACTED-ENV-FILE]',
      );
      redacted = redacted.replace(/\/home\/[^/\s"]+/g, '[REDACTED-HOME-DIR]');
      redacted = redacted.replace(/\/Users\/[^/\s"]+/g, '[REDACTED-USER-DIR]');
    }

    // Apply email redaction if enabled
    if (this.redactionConfig.redactEmails) {
      redacted = redacted.replace(
        /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
        '[REDACTED-EMAIL]',
      );
    }

    // Apply personal info redaction if enabled
    if (this.redactionConfig.redactPersonalInfo) {
      redacted = redacted.replace(/\b\d{3}-\d{3}-\d{4}\b/g, '[REDACTED-PHONE]');
      redacted = redacted.replace(
        /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
        '[REDACTED-CC-NUMBER]',
      );
    }

    return redacted;
  }
}

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
    legacyRedactor?: ConversationDataRedactor,
  ) {
    this.conversationId = this.generateConversationId();

    // Handle legacy constructor signature for backward compatibility
    // New usage should NOT pass config here - config comes per-call
    if (configOrRedactor && 'redactMessage' in configOrRedactor) {
      this.redactor = configOrRedactor as ConversationDataRedactor;
    } else if (
      configOrRedactor &&
      'getConversationLoggingEnabled' in configOrRedactor
    ) {
      // Legacy usage - create redactor from config
      const config = configOrRedactor as Config;
      this.redactor = new ConfigBasedRedactor(config.getRedactionConfig());
    }

    if (legacyRedactor) {
      this.redactor = legacyRedactor;
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
    let normalizedOptions: GenerateChatOptions = Array.isArray(contentOrOptions)
      ? { contents: contentOrOptions, tools: maybeTools }
      : { ...contentOrOptions };

    // REQ-SP4-004: Runtime context push - inject runtime from resolver if available
    const injectedRuntime = this.runtimeContextResolver?.();
    const providedRuntime = normalizedOptions.runtime;

    if (injectedRuntime) {
      const mergedMetadata: Record<string, unknown> = {
        ...(this.statelessRuntimeMetadata ?? {}),
        ...(injectedRuntime.metadata ?? {}),
        ...(providedRuntime?.metadata ?? {}),
        ...(normalizedOptions.metadata ?? {}),
        source: 'LoggingProviderWrapper.generateChatCompletion',
        requirement: 'REQ-SP4-001',
      };

      normalizedOptions.runtime = {
        ...injectedRuntime,
        ...providedRuntime,
        settingsService:
          providedRuntime?.settingsService ?? injectedRuntime.settingsService,
        config: providedRuntime?.config ?? injectedRuntime.config,
        metadata: mergedMetadata,
      };

      normalizedOptions.settings =
        normalizedOptions.settings ?? normalizedOptions.runtime.settingsService;
      normalizedOptions.metadata = mergedMetadata;
    }

    if (!injectedRuntime && this.statelessRuntimeMetadata) {
      normalizedOptions.metadata = {
        ...(this.statelessRuntimeMetadata ?? {}),
        ...(normalizedOptions.metadata ?? {}),
      };
    }

    if (this.optionsNormalizer) {
      normalizedOptions = this.optionsNormalizer(
        normalizedOptions,
        this.wrapped.name,
      );
    }

    // REQ-SP4-004: Guard - ensure runtime context is present for stateless hardening
    const runtimeId = normalizedOptions.runtime?.runtimeId ?? 'unknown';
    this.debug.log(
      () =>
        `Checking runtime context: runtimeId=${runtimeId}, hasRuntime=${!!normalizedOptions.runtime}, hasSettings=${!!normalizedOptions.runtime?.settingsService}, hasConfig=${!!normalizedOptions.runtime?.config}`,
    );
    this.debug.log(
      () =>
        `Contents length at entry: ${normalizedOptions.contents?.length ?? 'undefined'}`,
    );

    if (!normalizedOptions.runtime?.settingsService) {
      this.debug.error(
        () =>
          `Missing settingsService in runtime context for runtimeId=${runtimeId}`,
      );
      throw new MissingProviderRuntimeError({
        providerKey: `LoggingProviderWrapper[${this.wrapped.name}]`,
        missingFields: ['settings'],
        requirement: 'REQ-SP4-004',
        stage: 'generateChatCompletion',
        metadata: {
          hint: 'Runtime context must include settingsService for stateless hardening.',
          runtimeId,
        },
      });
    }

    if (!normalizedOptions.runtime?.config) {
      this.debug.error(
        () => `Missing config in runtime context for runtimeId=${runtimeId}`,
      );
      throw new MissingProviderRuntimeError({
        providerKey: `LoggingProviderWrapper[${this.wrapped.name}]`,
        missingFields: ['config'],
        requirement: 'REQ-SP4-004',
        stage: 'generateChatCompletion',
        metadata: {
          hint: 'Runtime context must include config for stateless hardening.',
          runtimeId,
        },
      });
    }

    // Resolve config from runtime or legacy fallback
    normalizedOptions.config =
      normalizedOptions.config ?? normalizedOptions.runtime?.config;
    const activeConfig = normalizedOptions.config;
    this.debug.log(
      () =>
        `After config resolution: hasConfig=${!!activeConfig}, configType=${activeConfig?.constructor?.name}, hasMethod=${typeof activeConfig?.getConversationLoggingEnabled}`,
    );

    // REQ-SP4-004: Validate that config is a proper Config instance with required methods
    // FAST FAIL: Throw immediately if config is a plain object instead of a Config instance
    if (activeConfig) {
      let configHasLoggingMethod =
        typeof activeConfig.getConversationLoggingEnabled === 'function';

      if (!configHasLoggingMethod) {
        // Gather diagnostic info about the config object
        const configKeys = Object.keys(activeConfig);
        const prototypeChain: string[] = [];
        let proto = Object.getPrototypeOf(activeConfig);
        while (proto && proto !== Object.prototype) {
          prototypeChain.push(proto.constructor?.name || 'unknown');
          proto = Object.getPrototypeOf(proto);
        }

        this.debug.warn(
          () =>
            `Config instance missing getConversationLoggingEnabled() (type=${activeConfig?.constructor?.name ?? 'unknown'}, frozen=${Object.isFrozen(activeConfig)}, proto=${prototypeChain.length > 0 ? prototypeChain.join(' -> ') : 'Object'}). Attempting to restore prototype.`,
        );

        try {
          Object.setPrototypeOf(activeConfig, Config.prototype);
        } catch (error) {
          this.debug.error(
            () =>
              `Failed to restore Config prototype: ${error instanceof Error ? error.message : String(error)}`,
          );
        }

        configHasLoggingMethod =
          typeof activeConfig.getConversationLoggingEnabled === 'function';

        if (!configHasLoggingMethod) {
          throw new Error(
            `[REQ-SP4-004] FAST FAIL: Invalid config instance - missing getConversationLoggingEnabled() method.\n` +
              `Config appears to be a plain object instead of a Config class instance.\n` +
              `This typically happens when the Config is serialized (e.g., Object.freeze with spread, JSON.stringify/parse) and loses its prototype chain.\n` +
              `Diagnostics:\n` +
              `- Type: ${activeConfig?.constructor?.name ?? 'unknown'}\n` +
              `- Has method: ${typeof activeConfig?.getConversationLoggingEnabled}\n` +
              `- Is frozen: ${Object.isFrozen(activeConfig)}\n` +
              `- Property count: ${configKeys.length}\n` +
              `- Prototype chain: ${prototypeChain.length > 0 ? prototypeChain.join(' -> ') : 'Object (direct)'}\n` +
              `- From runtime: ${!!normalizedOptions.runtime}\n` +
              `- Runtime ID: ${normalizedOptions.runtime?.runtimeId ?? 'unknown'}\n` +
              `Fix: Ensure Config instances are passed by reference, not serialized/deserialized.`,
          );
        }
      }
    }

    const invocation = normalizedOptions.invocation;

    // Prefer per-call redaction config from invocation context when available
    if (invocation?.redaction) {
      this.redactor = new ConfigBasedRedactor({
        ...invocation.redaction,
      });
    } else if (!this.redactor && activeConfig) {
      // REQ-SP4-004: Create per-call redactor if not already set
      this.redactor = new ConfigBasedRedactor(
        activeConfig.getRedactionConfig(),
      );
    }
    this.debug.log(
      () => `After redactor setup: hasRedactor=${!!this.redactor}`,
    );

    const promptId = this.generatePromptId();
    this.turnNumber++;
    this.debug.log(
      () =>
        `After promptId generation: promptId=${promptId}, turnNumber=${this.turnNumber}`,
    );

    // Log request if logging is enabled
    let conversationLoggingEnabled = false;
    try {
      this.debug.log(() => `About to call getConversationLoggingEnabled()`);
      conversationLoggingEnabled =
        activeConfig?.getConversationLoggingEnabled() ?? false;
      this.debug.log(
        () =>
          `getConversationLoggingEnabled() returned: ${conversationLoggingEnabled}`,
      );
    } catch (error) {
      this.debug.error(
        () =>
          `getConversationLoggingEnabled() threw exception: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
    this.debug.log(
      () =>
        `Conversation logging check: enabled=${conversationLoggingEnabled}, contents length=${normalizedOptions.contents?.length}`,
    );

    if (conversationLoggingEnabled) {
      try {
        this.debug.log(
          () =>
            `Before logRequest: contents length = ${normalizedOptions.contents?.length}`,
        );
        await this.logRequest(
          activeConfig!,
          normalizedOptions.contents,
          normalizedOptions.tools,
          promptId,
        );
        this.debug.log(
          () =>
            `After logRequest: contents length = ${normalizedOptions.contents?.length}`,
        );
      } catch (error) {
        this.debug.error(
          () =>
            `logRequest failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    }

    this.debug.log(() => `Before API request telemetry section`);

    // Log API request telemetry event
    if (activeConfig) {
      this.debug.log(
        () =>
          `Before JSON.stringify: contents length=${normalizedOptions.contents?.length}`,
      );
      const requestText = JSON.stringify(normalizedOptions.contents);
      this.debug.log(
        () => `After JSON.stringify: requestText length=${requestText.length}`,
      );
      const modelName =
        normalizedOptions.resolved?.model || this.wrapped.getDefaultModel();
      this.debug.log(
        () => `Logging API request: model=${modelName}, promptId=${promptId}`,
      );
      logApiRequest(
        activeConfig,
        new ApiRequestEvent(modelName, promptId, requestText),
      );
      this.debug.log(
        () =>
          `After API request logged: contents length=${normalizedOptions.contents?.length}`,
      );
    } else {
      this.debug.error(() => `Cannot log API request: activeConfig is null`);
    }

    this.debug.log(
      () =>
        `About to call wrapped provider: ${this.wrapped.name}, contentsLength=${normalizedOptions.contents?.length}`,
    );

    // Get stream from wrapped provider using normalized options object
    const stream = this.wrapped.generateChatCompletion(normalizedOptions);

    this.debug.log(() => `Wrapped provider call completed, processing stream`);

    // Always process stream to extract token metrics
    // If logging not enabled, process for metrics only
    if (!activeConfig?.getConversationLoggingEnabled()) {
      yield* this.processStreamForMetrics(activeConfig, stream);
      return;
    }

    // Log the response stream (which also processes metrics)
    yield* this.logResponseStream(activeConfig, stream, promptId);
  }

  private async logRequest(
    config: Config,
    content: IContent[],
    tools?: ProviderToolset,
    promptId?: string,
  ): Promise<void> {
    try {
      // Apply redaction to content and tools (use redactor if available)
      const redactedContent = this.redactor
        ? content.map((item) =>
            this.redactor!.redactMessage(item, this.wrapped.name),
          )
        : content;
      // Note: tools format is different now, keeping minimal logging for now
      const redactedTools = tools;

      const event = new ConversationRequestEvent(
        this.wrapped.name,
        this.conversationId,
        this.turnNumber,
        promptId || this.generatePromptId(),
        redactedContent,
        redactedTools,
        'default', // toolFormat is no longer passed in
      );

      logConversationRequest(config, event);

      // Also write to disk
      const fileWriter = getConversationFileWriter(
        config.getConversationLogPath(),
      );
      fileWriter.writeRequest(this.wrapped.name, redactedContent, {
        conversationId: this.conversationId,
        turnNumber: this.turnNumber,
        promptId: promptId || this.generatePromptId(),
        tools: redactedTools,
        toolFormat: 'default',
      });
    } catch (error) {
      // Log error but don't fail the request
      console.warn('Failed to log conversation request:', error);
    }
  }

  /**
   * Process stream to extract token metrics without logging
   * @plan PLAN-20250909-TOKTRACK
   */
  private async *processStreamForMetrics(
    config: Config | undefined,
    stream: AsyncIterableIterator<IContent>,
  ): AsyncIterableIterator<IContent> {
    const startTime = performance.now();
    let latestTokenUsage: UsageStats | undefined;

    try {
      for await (const chunk of stream) {
        // Extract token usage from IContent metadata
        if (chunk && typeof chunk === 'object') {
          const content = chunk as IContent;
          if (content.metadata?.usage) {
            latestTokenUsage = content.metadata.usage;
          }
        }

        yield chunk;
      }

      // Process metrics if we have token usage
      if (latestTokenUsage) {
        const duration = performance.now() - startTime;
        const tokenCounts =
          this.extractTokenCountsFromTokenUsage(latestTokenUsage);

        // Accumulate token usage for session tracking
        this.accumulateTokenUsage(tokenCounts, config);

        // Record performance metrics (TPM tracks output tokens only)
        const outputTokens = tokenCounts.output_token_count;
        this.performanceTracker.recordCompletion(
          duration,
          null,
          outputTokens,
          0,
        );
      }
    } catch (error) {
      // Record error in performance tracker
      const duration = performance.now() - startTime;
      this.performanceTracker.recordError(duration, String(error));
      throw error;
    }
  }

  private async *logResponseStream(
    config: Config,
    stream: AsyncIterableIterator<IContent>,
    promptId: string,
  ): AsyncIterableIterator<IContent> {
    const startTime = performance.now();
    let responseContent = '';
    let responseComplete = false;
    let latestTokenUsage: UsageStats | undefined;

    try {
      for await (const chunk of stream) {
        // Simple content extraction - just try to get text from common chunk formats
        const content = this.extractSimpleContent(chunk);
        if (content) {
          responseContent += content;
        }

        // Extract token usage from IContent metadata
        if (chunk && typeof chunk === 'object') {
          const content = chunk as IContent;
          if (content.metadata?.usage) {
            latestTokenUsage = content.metadata.usage;
          }
        }

        yield chunk;
      }
      responseComplete = true;
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
      );
      throw error;
    }

    if (responseComplete) {
      const totalTime = performance.now() - startTime;
      await this.logResponse(
        config,
        responseContent,
        promptId,
        totalTime,
        true,
        undefined,
        latestTokenUsage,
      );
    }
  }

  // Simple content extraction without complex provider-specific logic
  private extractSimpleContent(chunk: unknown): string {
    if (!chunk || typeof chunk !== 'object') {
      return '';
    }

    const obj = chunk as Record<string, unknown>;

    // Try common content paths
    if (obj.choices && Array.isArray(obj.choices)) {
      const choice = obj.choices[0] as Record<string, unknown>;
      if (choice?.delta && typeof choice.delta === 'object') {
        const delta = choice.delta as Record<string, unknown>;
        if (typeof delta.content === 'string') {
          return delta.content;
        }
      }
    }

    return '';
  }

  private async logResponse(
    config: Config,
    content: string,
    promptId: string,
    duration: number,
    success: boolean,
    error?: unknown,
    tokenUsage?: UsageStats,
  ): Promise<void> {
    try {
      const redactedContent = this.redactor
        ? this.redactor.redactResponseContent(content, this.wrapped.name)
        : content;

      // Extract token counts from the response or use provided tokenUsage
      const tokenCounts = tokenUsage
        ? this.extractTokenCountsFromTokenUsage(tokenUsage)
        : this.extractTokenCountsFromResponse(content);

      // Accumulate token usage for session tracking
      this.accumulateTokenUsage(tokenCounts, config);

      // Record performance metrics (TPM tracks output tokens only)
      const outputTokens = tokenCounts.output_token_count;
      this.performanceTracker.recordCompletion(duration, null, outputTokens, 0);

      // Calculate total for telemetry event
      const totalTokens =
        tokenCounts.input_token_count +
        tokenCounts.output_token_count +
        tokenCounts.cached_content_token_count +
        tokenCounts.thoughts_token_count +
        tokenCounts.tool_token_count;

      // Log token usage to telemetry
      logTokenUsage(
        config,
        new TokenUsageEvent(
          this.wrapped.name,
          this.conversationId,
          tokenCounts.input_token_count,
          tokenCounts.output_token_count,
          tokenCounts.cached_content_token_count,
          tokenCounts.tool_token_count,
          tokenCounts.thoughts_token_count,
          totalTokens,
        ),
      );

      const event = new ConversationResponseEvent(
        this.wrapped.name,
        this.conversationId,
        this.turnNumber,
        promptId,
        redactedContent,
        duration,
        success,
        error ? String(error) : undefined,
      );

      logConversationResponse(config, event);

      // Also write to disk
      const fileWriter = getConversationFileWriter(
        config.getConversationLogPath(),
      );
      fileWriter.writeResponse(this.wrapped.name, redactedContent, {
        conversationId: this.conversationId,
        turnNumber: this.turnNumber,
        promptId,
        duration,
        success,
        error: error ? String(error) : undefined,
      });
    } catch (logError) {
      console.warn('Failed to log conversation response:', logError);
    }
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
  private extractTokenCountsFromTokenUsage(tokenUsage: UsageStats): {
    input_token_count: number;
    output_token_count: number;
    cached_content_token_count: number;
    thoughts_token_count: number;
    tool_token_count: number;
  } {
    return {
      input_token_count: Number(tokenUsage.promptTokens) || 0,
      output_token_count: Number(tokenUsage.completionTokens) || 0,
      cached_content_token_count: 0, // Not available in basic UsageStats
      thoughts_token_count: 0, // Not available in basic UsageStats
      tool_token_count: 0, // Not available in basic UsageStats
    };
  }

  /**
   * Extract token counts from response object or headers
   */
  extractTokenCountsFromResponse(response: unknown): {
    input_token_count: number;
    output_token_count: number;
    cached_content_token_count: number;
    thoughts_token_count: number;
    tool_token_count: number;
  } {
    // Initialize token counts as zeros
    let input_token_count = 0;
    let output_token_count = 0;
    let cached_content_token_count = 0;
    let thoughts_token_count = 0;
    let tool_token_count = 0;

    try {
      // Check if response is a string and try to parse it as JSON
      if (typeof response === 'string') {
        const parsed = JSON.parse(response);
        // Extract token usage from response object
        if (parsed.usage) {
          input_token_count = Number(parsed.usage.prompt_tokens) || 0;
          output_token_count = Number(parsed.usage.completion_tokens) || 0;
          cached_content_token_count =
            Number(parsed.usage.cached_content_tokens) || 0;
          thoughts_token_count = Number(parsed.usage.thoughts_tokens) || 0;
          tool_token_count = Number(parsed.usage.tool_tokens) || 0;
        }
      } else if (response && typeof response === 'object') {
        // Extract token usage from response object
        const obj = response as Record<string, unknown>;
        if (obj.usage && typeof obj.usage === 'object') {
          const usage = obj.usage as Record<string, unknown>;
          input_token_count = Number(usage.prompt_tokens) || 0;
          output_token_count = Number(usage.completion_tokens) || 0;
          cached_content_token_count = Number(usage.cached_content_tokens) || 0;
          thoughts_token_count = Number(usage.thoughts_tokens) || 0;
          tool_token_count = Number(usage.tool_tokens) || 0;
        }

        // Check for anthropic-style headers
        if (obj.headers && typeof obj.headers === 'object') {
          const headers = obj.headers as Record<string, string>;
          if (headers['anthropic-input-tokens']) {
            const parsedValue = parseInt(headers['anthropic-input-tokens'], 10);
            input_token_count =
              !isNaN(parsedValue) && parsedValue >= 0
                ? parsedValue
                : input_token_count;
          }
          if (headers['anthropic-output-tokens']) {
            const parsedValue = parseInt(
              headers['anthropic-output-tokens'],
              10,
            );
            output_token_count =
              !isNaN(parsedValue) && parsedValue >= 0
                ? parsedValue
                : output_token_count;
          }
        }
      }

      // Ensure we return valid numbers, not NaN or negative values
      return {
        input_token_count: Math.max(0, input_token_count),
        output_token_count: Math.max(0, output_token_count),
        cached_content_token_count: Math.max(0, cached_content_token_count),
        thoughts_token_count: Math.max(0, thoughts_token_count),
        tool_token_count: Math.max(0, tool_token_count),
      };
    } catch (_error) {
      // Return zero counts if extraction fails
      return {
        input_token_count: 0,
        output_token_count: 0,
        cached_content_token_count: 0,
        thoughts_token_count: 0,
        tool_token_count: 0,
      };
    }
  }

  /**
   * Accumulate token usage for session tracking
   */
  private accumulateTokenUsage(
    tokenCounts: {
      input_token_count: number;
      output_token_count: number;
      cached_content_token_count: number;
      thoughts_token_count: number;
      tool_token_count: number;
    },
    config: Config | undefined,
  ): void {
    // Map token counts to expected format
    const usage = {
      input: tokenCounts.input_token_count || 0,
      output: tokenCounts.output_token_count || 0,
      cache: tokenCounts.cached_content_token_count || 0,
      thought: tokenCounts.thoughts_token_count || 0,
      tool: tokenCounts.tool_token_count || 0,
    };

    // Call accumulateSessionTokens if providerManager is available
    const providerManager = config?.getProviderManager();
    if (providerManager) {
      try {
        console.debug(
          `[TokenTracking] Accumulating ${usage.input + usage.output + usage.cache + usage.tool + usage.thought} tokens for provider ${this.wrapped.name}`,
        );
        providerManager.accumulateSessionTokens(this.wrapped.name, usage);
      } catch (error) {
        console.warn('Failed to accumulate session tokens:', error);
      }
    } else {
      console.warn(
        `[TokenTracking] No provider manager found in config - tokens not accumulated for ${this.wrapped.name}`,
      );
    }
  }

  private resolveLoggingConfig(candidate?: unknown): Config | undefined {
    if (
      candidate &&
      typeof candidate === 'object' &&
      'getConversationLoggingEnabled' in candidate &&
      typeof (candidate as { getConversationLoggingEnabled?: unknown })
        .getConversationLoggingEnabled === 'function'
    ) {
      return candidate as Config;
    }
    return undefined;
  }

  private async logToolCall(
    config: Config | undefined,
    toolName: string,
    params: unknown,
    result: unknown,
    startTime: number,
    success: boolean,
    error?: unknown,
  ): Promise<void> {
    if (!config) {
      return;
    }
    try {
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Extract git stats from result metadata if available
      let gitStats = null;
      if (result && typeof result === 'object' && 'metadata' in result) {
        const metadata = (result as { metadata?: { gitStats?: unknown } })
          .metadata;
        if (metadata && metadata.gitStats) {
          gitStats = metadata.gitStats;
        }
      }

      // Redact tool parameters if redactor available
      const redactedParams = this.redactor
        ? this.redactor.redactToolCall({
            type: 'function',
            function: { name: toolName, parameters: params as object },
          }).function.parameters
        : (params as object);

      // Write to disk
      const fileWriter = getConversationFileWriter(
        config.getConversationLogPath(),
      );
      fileWriter.writeToolCall(this.wrapped.name, toolName, {
        conversationId: this.conversationId,
        turnNumber: this.turnNumber,
        params: redactedParams,
        result,
        duration,
        success,
        error: error ? String(error) : undefined,
        gitStats,
      });
    } catch (logError) {
      console.warn('Failed to log tool call:', logError);
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
      if (loggingConfig?.getConversationLoggingEnabled()) {
        await this.logToolCall(
          loggingConfig,
          toolName,
          params,
          result,
          startTime,
          true,
        );
      }

      return result;
    } catch (error) {
      // Log failed tool call if logging is enabled
      if (loggingConfig?.getConversationLoggingEnabled()) {
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

  /**
   * Get the latest performance metrics from the tracker
   * @plan PLAN-20250909-TOKTRACK
   */
  getPerformanceMetrics() {
    return this.performanceTracker.getLatestMetrics();
  }
}
