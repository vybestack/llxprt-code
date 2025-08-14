/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { IProvider, IModel, ITool, IMessage } from './IProvider.js';
import { Config, RedactionConfig } from '../config/config.js';
import {
  logConversationRequest,
  logConversationResponse,
} from '../telemetry/loggers.js';
import {
  ConversationRequestEvent,
  ConversationResponseEvent,
} from '../telemetry/types.js';
import { getConversationFileWriter } from '../storage/ConversationFileWriter.js';

export interface ConversationDataRedactor {
  redactMessage(message: IMessage, provider: string): IMessage;
  redactToolCall(tool: ITool): ITool;
  redactResponseContent(content: string, provider: string): string;
}

// Simple redactor that works with RedactionConfig
class ConfigBasedRedactor implements ConversationDataRedactor {
  constructor(private redactionConfig: RedactionConfig) {}

  redactMessage(message: IMessage, providerName: string): IMessage {
    if (!this.shouldRedact()) {
      return message;
    }

    const redactedMessage = { ...message };

    if (typeof redactedMessage.content === 'string') {
      redactedMessage.content = this.redactContent(
        redactedMessage.content,
        providerName,
      );
    }

    // Redact tool_calls if present
    if (redactedMessage.tool_calls) {
      redactedMessage.tool_calls = redactedMessage.tool_calls.map((call) => ({
        ...call,
        function: {
          ...call.function,
          arguments: this.redactContent(call.function.arguments, providerName),
        },
      }));
    }

    return redactedMessage;
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
 * A minimal logging wrapper that acts as a transparent passthrough to the wrapped provider.
 * Only intercepts generateChatCompletion to log conversations while forwarding all other
 * methods directly to the wrapped provider without modification.
 */
export class LoggingProviderWrapper implements IProvider {
  private conversationId: string;
  private turnNumber: number = 0;
  private redactor: ConversationDataRedactor;

  constructor(
    private readonly wrapped: IProvider,
    private readonly config: Config,
    redactor?: ConversationDataRedactor,
  ) {
    this.conversationId = this.generateConversationId();
    this.redactor =
      redactor || new ConfigBasedRedactor(config.getRedactionConfig());
  }

  /**
   * Access to the wrapped provider for unwrapping if needed
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

  // Only method that includes logging - everything else is passthrough
  async *generateChatCompletion(
    messages: IMessage[],
    tools?: ITool[],
    toolFormat?: string,
  ): AsyncIterableIterator<unknown> {
    const promptId = this.generatePromptId();
    this.turnNumber++;

    // Log request if logging is enabled
    if (this.config.getConversationLoggingEnabled()) {
      await this.logRequest(messages, tools, toolFormat, promptId);
    }

    // Get stream from wrapped provider
    const stream = this.wrapped.generateChatCompletion(
      messages,
      tools,
      toolFormat,
    );

    // If logging not enabled, just pass through
    if (!this.config.getConversationLoggingEnabled()) {
      yield* stream;
      return;
    }

    // Log the response stream
    yield* this.logResponseStream(stream, promptId);
  }

  private async logRequest(
    messages: IMessage[],
    tools?: ITool[],
    toolFormat?: string,
    promptId?: string,
  ): Promise<void> {
    try {
      // Apply redaction to messages and tools
      const redactedMessages = messages.map((msg) =>
        this.redactor.redactMessage(msg, this.wrapped.name),
      );
      const redactedTools = tools?.map((tool) =>
        this.redactor.redactToolCall(tool),
      );

      const event = new ConversationRequestEvent(
        this.wrapped.name,
        this.conversationId,
        this.turnNumber,
        promptId || this.generatePromptId(),
        redactedMessages,
        redactedTools,
        toolFormat,
      );

      logConversationRequest(this.config, event);

      // Also write to disk
      const fileWriter = getConversationFileWriter(
        this.config.getConversationLogPath(),
      );
      fileWriter.writeRequest(this.wrapped.name, redactedMessages, {
        conversationId: this.conversationId,
        turnNumber: this.turnNumber,
        promptId: promptId || this.generatePromptId(),
        tools: redactedTools,
        toolFormat,
      });
    } catch (error) {
      // Log error but don't fail the request
      console.warn('Failed to log conversation request:', error);
    }
  }

  private async *logResponseStream(
    stream: AsyncIterableIterator<unknown>,
    promptId: string,
  ): AsyncIterableIterator<unknown> {
    const startTime = performance.now();
    let responseContent = '';
    let responseComplete = false;

    try {
      for await (const chunk of stream) {
        // Simple content extraction - just try to get text from common chunk formats
        const content = this.extractSimpleContent(chunk);
        if (content) {
          responseContent += content;
        }

        yield chunk;
      }
      responseComplete = true;
    } catch (error) {
      const errorTime = performance.now();
      await this.logResponse('', promptId, errorTime - startTime, false, error);
      throw error;
    }

    if (responseComplete) {
      const totalTime = performance.now() - startTime;
      await this.logResponse(responseContent, promptId, totalTime, true);
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
    content: string,
    promptId: string,
    duration: number,
    success: boolean,
    error?: unknown,
  ): Promise<void> {
    try {
      const redactedContent = this.redactor.redactResponseContent(
        content,
        this.wrapped.name,
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

      logConversationResponse(this.config, event);

      // Also write to disk
      const fileWriter = getConversationFileWriter(
        this.config.getConversationLogPath(),
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

  private async logToolCall(
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
        this.config.getConversationLogPath(),
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
  setModel?(modelId: string): void {
    this.wrapped.setModel?.(modelId);
  }

  getCurrentModel?(): string {
    return this.wrapped.getCurrentModel?.() ?? '';
  }

  setApiKey?(apiKey: string): void {
    this.wrapped.setApiKey?.(apiKey);
  }

  setBaseUrl?(baseUrl?: string): void {
    this.wrapped.setBaseUrl?.(baseUrl);
  }

  getToolFormat?(): string {
    return this.wrapped.getToolFormat?.() ?? '';
  }

  setToolFormatOverride?(format: string | null): void {
    this.wrapped.setToolFormatOverride?.(format);
  }

  isPaidMode?(): boolean {
    return this.wrapped.isPaidMode?.() ?? false;
  }

  clearState?(): void {
    this.wrapped.clearState?.();
    // Reset conversation logging state
    this.conversationId = this.generateConversationId();
    this.turnNumber = 0;
  }

  setConfig?(config: unknown): void {
    this.wrapped.setConfig?.(config);
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
        await this.logToolCall(toolName, params, result, startTime, true);
      }

      return result;
    } catch (error) {
      // Log failed tool call if logging is enabled
      if (this.config.getConversationLoggingEnabled()) {
        await this.logToolCall(toolName, params, null, startTime, false, error);
      }
      throw error;
    }
  }

  setModelParams?(params: Record<string, unknown> | undefined): void {
    this.wrapped.setModelParams?.(params);
  }

  getModelParams?(): Record<string, unknown> | undefined {
    return this.wrapped.getModelParams?.();
  }
}
