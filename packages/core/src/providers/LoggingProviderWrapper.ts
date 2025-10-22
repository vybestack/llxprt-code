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
} from '../telemetry/loggers.js';
import {
  ConversationRequestEvent,
  ConversationResponseEvent,
  TokenUsageEvent,
} from '../telemetry/types.js';
import { getConversationFileWriter } from '../storage/ConversationFileWriter.js';
import { ProviderPerformanceTracker } from './logging/ProviderPerformanceTracker.js';
import type { SettingsService } from '../settings/SettingsService.js';

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
 * A minimal logging wrapper that acts as a transparent passthrough to the wrapped provider.
 * Only intercepts generateChatCompletion to log conversations while forwarding all other
 * methods directly to the wrapped provider without modification.
 */
export class LoggingProviderWrapper implements IProvider {
  private conversationId: string;
  private turnNumber: number = 0;
  private redactor: ConversationDataRedactor;
  private performanceTracker: ProviderPerformanceTracker;

  constructor(
    private readonly wrapped: IProvider,
    private readonly config: Config,
    redactor?: ConversationDataRedactor,
  ) {
    this.conversationId = this.generateConversationId();
    this.redactor =
      redactor || new ConfigBasedRedactor(config.getRedactionConfig());
    this.performanceTracker = new ProviderPerformanceTracker(wrapped.name);

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
   * @requirement REQ-SP2-001
   * @pseudocode base-provider-call-contract.md lines 3-4
   * @plan PLAN-20250218-STATELESSPROVIDER.P04
   * @requirement REQ-SP-001
   * @pseudocode base-provider.md lines 7-15
   * @pseudocode provider-invocation.md lines 11-15
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
    const normalizedOptions: GenerateChatOptions = Array.isArray(
      contentOrOptions,
    )
      ? { contents: contentOrOptions, tools: maybeTools }
      : { ...contentOrOptions };

    normalizedOptions.config = normalizedOptions.config ?? this.config;
    const activeConfig = normalizedOptions.config;

    const promptId = this.generatePromptId();
    this.turnNumber++;

    // Log request if logging is enabled
    if (activeConfig?.getConversationLoggingEnabled()) {
      await this.logRequest(
        activeConfig,
        normalizedOptions.contents,
        normalizedOptions.tools,
        promptId,
      );
    }

    // Get stream from wrapped provider using normalized options object
    const stream = this.wrapped.generateChatCompletion(normalizedOptions);

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
      // Apply redaction to content and tools
      const redactedContent = content.map((item) =>
        this.redactor.redactMessage(item, this.wrapped.name),
      );
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
      const redactedContent = this.redactor.redactResponseContent(
        content,
        this.wrapped.name,
      );

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

  private async logToolCall(
    config: Config,
    toolName: string,
    params: unknown,
    result: unknown,
    startTime: number,
    success: boolean,
    error?: unknown,
  ): Promise<void> {
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

      // Write to disk
      const fileWriter = getConversationFileWriter(
        config.getConversationLogPath(),
      );
      fileWriter.writeToolCall(this.wrapped.name, toolName, {
        conversationId: this.conversationId,
        turnNumber: this.turnNumber,
        params: this.redactor.redactToolCall({
          type: 'function',
          function: { name: toolName, parameters: params as object },
        }).function.parameters,
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
      candidate?.(config);
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

    try {
      const result = await this.wrapped.invokeServerTool(
        toolName,
        params,
        config,
      );

      // Log tool call if logging is enabled and result has metadata
      if (this.config.getConversationLoggingEnabled()) {
        await this.logToolCall(
          this.config,
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
      if (this.config.getConversationLoggingEnabled()) {
        await this.logToolCall(
          this.config,
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
