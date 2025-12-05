/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan PLAN-20250218-STATELESSPROVIDER.P04
 * @requirement REQ-SP-001
 *
 * OpenAI provider implemented on top of Vercel AI SDK v5, using the
 * OpenAI chat completions API via @ai-sdk/openai + ai.
 */

import crypto from 'node:crypto';

import * as Ai from 'ai';
import type {
  JSONSchema7,
  ModelMessage,
  LanguageModelUsage,
  LanguageModel,
  Tool,
  TypedToolCall,
} from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import { IContent } from '../../services/history/IContent.js';
import { IProviderConfig } from '../types/IProviderConfig.js';
import { ToolFormat } from '../../tools/IToolFormatter.js';
import { isKimiModel } from '../../tools/ToolIdStrategy.js';
import {
  BaseProvider,
  NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { DebugLogger } from '../../debug/index.js';
import { OAuthManager } from '../../auth/precedence.js';
import {
  convertToolsToOpenAIVercel,
  OpenAIVercelTool,
} from './schemaConverter.js';
import {
  ToolCallBlock,
  TextBlock,
  ThinkingBlock,
} from '../../services/history/IContent.js';
import { processToolParameters } from '../../tools/doubleEscapeUtils.js';
import { IModel } from '../IModel.js';
import { IProvider } from '../IProvider.js';
import { getCoreSystemPromptAsync } from '../../core/prompts.js';
import { resolveUserMemory } from '../utils/userMemory.js';
import { convertToVercelMessages } from './messageConversion.js';
import { getToolIdStrategy } from '../../tools/ToolIdStrategy.js';
import { resolveRuntimeAuthToken } from '../utils/authToken.js';
import { filterOpenAIRequestParams } from '../openai/openaiRequestParams.js';
import { isLocalEndpoint } from '../utils/localEndpoint.js';
import { AuthenticationError, wrapError } from './errors.js';

type VercelTools = Record<string, Tool<unknown, never>>;
const streamText = Ai.streamText;
const generateText = Ai.generateText;

/**
 * Vercel OpenAI-based provider using AI SDK v5.
 *
 * NOTE:
 * - No dependency on the official `openai` SDK.
 * - Uses `openai.chat(modelId)` to talk to the Chat Completions API.
 * - Tools are configured via AI SDK `tool()` with JSON schema input.
 */
export class OpenAIVercelProvider extends BaseProvider implements IProvider {
  private getLogger(): DebugLogger {
    return new DebugLogger('llxprt:provider:openaivercel');
  }

  /**
   * @plan:PLAN-20251023-STATELESS-HARDENING.P08
   * @requirement:REQ-SP4-003
   * Constructor reduced to minimal initialization - no state captured.
   */
  constructor(
    apiKey: string | undefined,
    baseURL?: string,
    config?: IProviderConfig,
    oauthManager?: OAuthManager,
  ) {
    // Normalize empty string to undefined for proper precedence handling
    const normalizedApiKey =
      apiKey && apiKey.trim() !== '' ? apiKey : undefined;

    super(
      {
        name: 'openaivercel',
        apiKey: normalizedApiKey,
        baseURL,
        envKeyNames: ['OPENAI_API_KEY'],
        // AI SDK-based provider does not use OAuth directly here.
        isOAuthEnabled: false,
        oauthProvider: undefined,
        oauthManager,
      },
      config,
    );
  }

  protected override supportsOAuth(): boolean {
    return false;
  }

  /**
   * Create an OpenAI provider instance for this call using AI SDK v5.
   *
   * Uses the resolved runtime auth token and baseURL, and still allows
   * local endpoints without authentication (for Ollama-style servers).
   */
  private async createOpenAIClient(
    options: NormalizedGenerateChatOptions,
  ): Promise<ReturnType<typeof createOpenAI>> {
    const authToken =
      (await resolveRuntimeAuthToken(options.resolved.authToken)) ?? '';
    const baseURL = options.resolved.baseURL ?? this.baseProviderConfig.baseURL;

    // Allow local endpoints without authentication
    if (!authToken && !isLocalEndpoint(baseURL)) {
      throw new AuthenticationError(
        `Auth token unavailable for runtimeId=${options.runtime?.runtimeId} (REQ-SP4-003).`,
        this.name,
      );
    }

    const headers = this.getCustomHeaders();

    return createOpenAI({
      apiKey: authToken || undefined,
      baseURL: baseURL || undefined,
      headers: headers || undefined,
    });
  }

  /**
   * Extract model parameters from normalized options instead of settings service.
   * This mirrors OpenAIProvider but feeds AI SDK call options instead.
   */
  private extractModelParamsFromOptions(
    options: NormalizedGenerateChatOptions,
  ): Record<string, unknown> | undefined {
    const providerSettings =
      options.settings?.getProviderSettings(this.name) ?? {};
    const configEphemerals = options.invocation?.ephemerals ?? {};

    const filteredProviderParams = filterOpenAIRequestParams(providerSettings);
    const filteredEphemeralParams = filterOpenAIRequestParams(configEphemerals);

    if (!filteredProviderParams && !filteredEphemeralParams) {
      return undefined;
    }

    return {
      ...(filteredProviderParams ?? {}),
      ...(filteredEphemeralParams ?? {}),
    };
  }

  private getAiJsonSchema(): ((schema: JSONSchema7) => unknown) | undefined {
    try {
      const candidate = (Ai as { jsonSchema?: unknown }).jsonSchema;
      return typeof candidate === 'function'
        ? (candidate as (schema: JSONSchema7) => unknown)
        : undefined;
    } catch {
      return undefined;
    }
  }

  private getAiTool():
    | ((config: {
        description?: string;
        inputSchema?: unknown;
      }) => Tool<unknown, never>)
    | undefined {
    try {
      const candidate = (Ai as { tool?: unknown }).tool;
      return typeof candidate === 'function'
        ? (candidate as (config: {
            description?: string;
            inputSchema?: unknown;
          }) => Tool<unknown, never>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Normalize tool IDs from various formats to OpenAI-style format.
   * Kept for compatibility with existing history/tool logic.
   */
  private normalizeToOpenAIToolId(id: string): string {
    const sanitize = (value: string) =>
      value.replace(/[^a-zA-Z0-9_]/g, '') ||
      'call_' + crypto.randomUUID().replace(/-/g, '');
    // If already in OpenAI format, return as-is
    if (id.startsWith('call_')) {
      return sanitize(id);
    }

    // For history format, extract the UUID and add OpenAI prefix
    if (id.startsWith('hist_tool_')) {
      const uuid = id.substring('hist_tool_'.length);
      return sanitize('call_' + uuid);
    }

    // For Anthropic format, extract the UUID and add OpenAI prefix
    if (id.startsWith('toolu_')) {
      const uuid = id.substring('toolu_'.length);
      return sanitize('call_' + uuid);
    }

    // Unknown format - assume it's a raw UUID
    return sanitize('call_' + id);
  }

  /**
   * Normalize tool IDs from OpenAI-style format to history format.
   */
  private normalizeToHistoryToolId(id: string): string {
    // If already in history format, return as-is
    if (id.startsWith('hist_tool_')) {
      return id;
    }

    // For OpenAI format, extract the UUID and add history prefix
    if (id.startsWith('call_')) {
      const uuid = id.substring('call_'.length);
      return 'hist_tool_' + uuid;
    }

    // For Anthropic format, extract the UUID and add history prefix
    if (id.startsWith('toolu_')) {
      const uuid = id.substring('toolu_'.length);
      return 'hist_tool_' + uuid;
    }

    // Unknown format - assume it's a raw UUID
    return 'hist_tool_' + id;
  }

  /**
   * Convert internal history IContent[] to AI SDK ModelMessage[].
   *
   * This implementation uses textual tool replay for past tool calls/results.
   * New tool calls in the current response still use structured ToolCallBlocks.
   *
   * For Kimi K2 models, uses ToolIdStrategy to generate proper tool IDs
   * in the format functions.{name}:{index} instead of call_xxx.
   */
  private convertToModelMessages(contents: IContent[]): ModelMessage[] {
    const toolFormat = this.detectToolFormat();

    // Create a ToolIdMapper based on the tool format
    // For Kimi K2, this generates sequential IDs in the format functions.{name}:{index}
    const toolIdMapper =
      toolFormat === 'kimi'
        ? getToolIdStrategy('kimi').createMapper(contents)
        : undefined;

    return convertToVercelMessages(
      contents,
      toolIdMapper,
    ) as unknown as ModelMessage[];
  }

  /**
   * Build an AI SDK ToolSet from already-normalized OpenAI-style tool definitions.
   *
   * Input is the array produced by convertToolsToOpenAIVercel().
   */
  private buildVercelTools(
    formattedTools?: OpenAIVercelTool[] | undefined,
  ): VercelTools | undefined {
    if (!formattedTools || formattedTools.length === 0) {
      return undefined;
    }

    const jsonSchemaFn =
      this.getAiJsonSchema() ??
      ((schema: JSONSchema7) => schema as unknown as JSONSchema7);
    const toolFn =
      this.getAiTool() ??
      ((config: { description?: string; inputSchema?: unknown }) =>
        config as unknown as Tool<unknown, never>);

    const toolsRecord: VercelTools = {};

    for (const t of formattedTools) {
      if (!t || t.type !== 'function') continue;
      const fn = t.function;
      if (!fn?.name) continue;
      if (toolsRecord[fn.name]) continue;

      const inputSchema = fn.parameters
        ? jsonSchemaFn(fn.parameters as JSONSchema7)
        : jsonSchemaFn({
            type: 'object',
            properties: {},
            additionalProperties: false,
          } satisfies JSONSchema7);

      toolsRecord[fn.name] = toolFn({
        description: fn.description,
        inputSchema,
        // No execute() – we only surface tool calls back to the caller,
        // execution is handled by the existing external tool pipeline.
      });
    }

    return Object.keys(toolsRecord).length > 0 ? toolsRecord : undefined;
  }

  private mapUsageToMetadata(usage: LanguageModelUsage | undefined):
    | {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      }
    | undefined {
    if (!usage) return undefined;
    const promptTokens =
      usage.inputTokens ??
      (usage as { promptTokens?: number }).promptTokens ??
      0;
    const completionTokens =
      usage.outputTokens ??
      (usage as { completionTokens?: number }).completionTokens ??
      0;
    const totalTokens =
      usage.totalTokens ??
      (typeof promptTokens === 'number' && typeof completionTokens === 'number'
        ? promptTokens + completionTokens
        : 0);

    return {
      promptTokens,
      completionTokens,
      totalTokens,
    };
  }

  /**
   * Extract thinking content from <think>, <thinking>, or <analysis> tags
   * and return it as a ThinkingBlock. Returns null if no thinking tags found.
   *
   * This must be called BEFORE sanitizeText which strips these tags.
   *
   * Handles two formats:
   * 1. Standard: <think>Full thinking paragraph here...</think>
   * 2. Fragmented (Synthetic API): <think>word</think><think>word</think>...
   *
   * For fragmented format, joins with spaces. For standard, joins with newlines.
   */
  private extractThinkTagsAsBlock(text: string): ThinkingBlock | null {
    if (!text) {
      return null;
    }

    const thinkingParts: string[] = [];

    // Match <think>...</think>
    const thinkMatches = text.matchAll(/<think>([\s\S]*?)<\/think>/gi);
    for (const match of thinkMatches) {
      if (match[1]?.trim()) {
        thinkingParts.push(match[1].trim());
      }
    }

    // Match <thinking>...</thinking>
    const thinkingMatches = text.matchAll(/<thinking>([\s\S]*?)<\/thinking>/gi);
    for (const match of thinkingMatches) {
      if (match[1]?.trim()) {
        thinkingParts.push(match[1].trim());
      }
    }

    // Match <analysis>...</analysis>
    const analysisMatches = text.matchAll(/<analysis>([\s\S]*?)<\/analysis>/gi);
    for (const match of analysisMatches) {
      if (match[1]?.trim()) {
        thinkingParts.push(match[1].trim());
      }
    }

    if (thinkingParts.length === 0) {
      return null;
    }

    // Detect fragmented format: many short parts (likely token-by-token streaming)
    const avgPartLength =
      thinkingParts.reduce((sum, p) => sum + p.length, 0) /
      thinkingParts.length;
    const isFragmented = thinkingParts.length > 5 && avgPartLength < 15;

    // Join with space for fragmented, newlines for standard multi-paragraph thinking
    const combinedThought = isFragmented
      ? thinkingParts.join(' ')
      : thinkingParts.join('\n\n');

    const logger = this.getLogger();
    logger.debug(
      () =>
        `[OpenAIVercelProvider] Extracted thinking from tags: ${combinedThought.length} chars`,
      { tagCount: thinkingParts.length, isFragmented, avgPartLength },
    );

    return {
      type: 'thinking',
      thought: combinedThought,
      sourceField: 'think_tags',
      isHidden: false,
    };
  }

  /**
   * Sanitize text content from provider response by removing thinking tags and artifacts.
   * This prevents <think>...</think> tags from leaking into visible output.
   */
  private sanitizeText(text: string): string {
    if (!text) {
      return text;
    }

    // Check if there are any reasoning tags before modification
    const hadReasoningTags =
      /<(?:think|thinking|analysis)>|<\/(?:think|thinking|analysis)>/i.test(
        text,
      );

    let cleaned = text;

    // Remove <think>...</think> tags and their content
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '\n');

    // Remove <thinking>...</thinking> tags and their content
    cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '\n');

    // Remove <analysis>...</analysis> tags and their content
    cleaned = cleaned.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '\n');

    // Remove unclosed tags (streaming edge case)
    cleaned = cleaned.replace(/<think>[\s\S]*$/gi, '');
    cleaned = cleaned.replace(/<thinking>[\s\S]*$/gi, '');
    cleaned = cleaned.replace(/<analysis>[\s\S]*$/gi, '');

    // Also remove opening tags without closing (another streaming edge case)
    cleaned = cleaned.replace(/<think>/gi, '');
    cleaned = cleaned.replace(/<thinking>/gi, '');
    cleaned = cleaned.replace(/<analysis>/gi, '');

    // Only clean up whitespace if we had reasoning tags to strip
    // This preserves meaningful whitespace in regular text chunks during streaming
    // (e.g., " 5 Biggest" should remain " 5 Biggest", not become "5 Biggest")
    if (hadReasoningTags) {
      // Normalize multiple consecutive newlines to at most two
      cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

      // Trim leading/trailing whitespace only when we stripped tags
      cleaned = cleaned.trim();
    }

    return cleaned;
  }

  /**
   * Get a short preview of a message's content for debug logging.
   */
  private getContentPreview(
    content: ModelMessage['content'],
    maxLength = 200,
  ): string | undefined {
    if (content === null || content === undefined) {
      return undefined;
    }

    if (typeof content === 'string') {
      if (content.length <= maxLength) {
        return content;
      }
      return `${content.slice(0, maxLength)}…`;
    }

    if (Array.isArray(content)) {
      // text parts, tool-call parts, etc.
      const textParts = content.map((part) => {
        if (
          typeof part === 'object' &&
          part !== null &&
          'type' in part &&
          (part as { type?: string }).type === 'text'
        ) {
          return (part as { text?: string }).text ?? '';
        }
        try {
          return JSON.stringify(part);
        } catch {
          return '[unserializable part]';
        }
      });
      const joined = textParts.join('\n');
      if (joined.length <= maxLength) {
        return joined;
      }
      return `${joined.slice(0, maxLength)}…`;
    }

    try {
      const serialized = JSON.stringify(content);
      if (serialized.length <= maxLength) {
        return serialized;
      }
      return `${serialized.slice(0, maxLength)}…`;
    } catch {
      return '[unserializable content]';
    }
  }

  /**
   * Core chat completion implementation using AI SDK v5.
   *
   * This replaces the original OpenAI SDK v5 client usage with:
   *   - createOpenAI({ apiKey, baseURL })
   *   - openai.chat(modelId)
   *   - generateText / streamText
   */
  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const logger = this.getLogger();
    const { contents, tools, metadata } = options;
    const modelId = options.resolved.model || this.getDefaultModel();
    const abortSignal = metadata?.abortSignal as AbortSignal | undefined;
    const ephemerals = options.invocation?.ephemerals ?? {};

    const resolved = options.resolved;

    if (logger.enabled) {
      logger.debug(() => `[OpenAIVercelProvider] Resolved request context`, {
        provider: this.name,
        model: modelId,
        resolvedModel: resolved.model,
        resolvedBaseUrl: resolved.baseURL,
        authTokenPresent: Boolean(resolved.authToken),
        messageCount: contents.length,
        toolCount: tools?.length ?? 0,
        metadataKeys: Object.keys(metadata ?? {}),
      });
    }

    // Determine streaming vs non-streaming mode (default: enabled)
    const streamingSetting = ephemerals['streaming'];
    const streamingResolved = options.resolved?.streaming;
    const streamingEnabled =
      streamingResolved === false
        ? false
        : streamingResolved === true
          ? true
          : streamingSetting !== 'disabled';

    // System prompt (same core-prompt mechanism as OpenAIProvider)
    const flattenedToolNames =
      tools?.flatMap((group) =>
        group.functionDeclarations
          .map((decl) => decl.name)
          .filter((name): name is string => !!name),
      ) ?? [];
    const toolNamesArg =
      tools === undefined ? undefined : Array.from(new Set(flattenedToolNames));

    const userMemory = await resolveUserMemory(
      options.userMemory,
      () => options.invocation?.userMemory,
    );
    const systemPrompt = await getCoreSystemPromptAsync(
      userMemory,
      modelId,
      toolNamesArg,
    );

    // Convert internal history to AI SDK ModelMessages with structured tool replay.
    const messages: ModelMessage[] = this.convertToModelMessages(contents);

    if (logger.enabled) {
      logger.debug(() => `[OpenAIVercelProvider] Chat payload snapshot`, {
        messageCount: messages.length,
        messages: messages.map((msg) => ({
          role: msg.role,
          contentPreview: this.getContentPreview(msg.content),
        })),
      });
    }

    // Convert Gemini tools to OpenAI-style definitions using provider-specific converter
    const formattedTools = convertToolsToOpenAIVercel(tools);

    if (logger.enabled && formattedTools) {
      logger.debug(() => `[OpenAIVercelProvider] Tool conversion summary`, {
        hasTools: !!formattedTools,
        toolCount: formattedTools.length,
        toolNames: formattedTools.map((t) => t.function.name),
      });
    }

    // Build AI SDK ToolSet
    const aiTools = this.buildVercelTools(formattedTools);

    // Model parameters (temperature, top_p, etc.)
    const modelParams = this.extractModelParamsFromOptions(options) ?? {};
    const maxTokensMeta =
      (metadata?.maxTokens as number | undefined) ??
      (ephemerals['max-tokens'] as number | undefined);
    const maxTokensOverride =
      (modelParams['max_tokens'] as number | undefined) ?? undefined;
    const maxOutputTokens =
      typeof maxTokensMeta === 'number' && Number.isFinite(maxTokensMeta)
        ? maxTokensMeta
        : typeof maxTokensOverride === 'number' &&
            Number.isFinite(maxTokensOverride)
          ? maxTokensOverride
          : undefined;

    const temperature = modelParams['temperature'] as number | undefined;
    const topP = modelParams['top_p'] as number | undefined;
    const presencePenalty = modelParams['presence_penalty'] as
      | number
      | undefined;
    const frequencyPenalty = modelParams['frequency_penalty'] as
      | number
      | undefined;
    const stopSetting = modelParams['stop'] as string | string[] | undefined;
    const stopSequences =
      typeof stopSetting === 'string'
        ? [stopSetting]
        : Array.isArray(stopSetting)
          ? stopSetting
          : undefined;
    const seed = modelParams['seed'] as number | undefined;

    const maxRetries = (ephemerals['retries'] as number | undefined) ?? 2; // AI SDK default is 2

    // Instantiate AI SDK OpenAI provider + chat model
    const openaiProvider = await this.createOpenAIClient(options);
    const providerWithChat = openaiProvider as unknown as {
      chat?: (modelId: string) => unknown;
      (modelId: string): unknown;
    };
    const model = (
      providerWithChat.chat
        ? providerWithChat.chat(modelId)
        : providerWithChat(modelId)
    ) as LanguageModel;

    if (logger.enabled) {
      logger.debug(() => `[OpenAIVercelProvider] Sending chat request`, {
        model: modelId,
        baseURL: resolved.baseURL ?? this.getBaseURL(),
        streamingEnabled,
        hasTools: !!aiTools,
        toolCount: aiTools ? Object.keys(aiTools).length : 0,
        maxOutputTokens,
      });
    }

    if (streamingEnabled) {
      // Streaming mode via streamText()
      const streamOptions: Record<string, unknown> = {
        model,
        system: systemPrompt,
        messages,
        tools: aiTools,
        maxOutputTokens,
        temperature,
        topP,
        presencePenalty,
        frequencyPenalty,
        stopSequences,
        seed,
        maxRetries,
        abortSignal,
      };
      if (maxOutputTokens !== undefined) {
        streamOptions['maxTokens'] = maxOutputTokens;
      }

      let result;
      try {
        result = await streamText(
          streamOptions as Parameters<typeof streamText>[0],
        );
      } catch (error) {
        logger.error(
          () =>
            `[OpenAIVercelProvider] streamText failed: ${error instanceof Error ? error.message : String(error)}`,
          { error },
        );
        throw wrapError(error, this.name);
      }

      const collectedToolCalls: Array<{
        toolCallId: string;
        toolName: string;
        input: unknown;
      }> = [];
      let totalUsage: LanguageModelUsage | undefined;
      let finishReason: string | undefined;
      const hasFullStream =
        result &&
        typeof result === 'object' &&
        'fullStream' in (result as { fullStream?: unknown });

      // Buffer for accumulating text chunks for <think> tag processing
      let textBuffer = '';
      let accumulatedThinkingContent = '';
      let hasEmittedThinking = false;

      // Capture method references for use in nested functions
      const extractThinkTags = this.extractThinkTagsAsBlock.bind(this);
      const sanitizeTextFn = this.sanitizeText.bind(this);

      // Helper to check if buffer has an open think tag without closing
      const hasOpenThinkTag = (text: string): boolean => {
        const openCount = (text.match(/<think>/gi) ?? []).length;
        const closeCount = (text.match(/<\/think>/gi) ?? []).length;
        return openCount > closeCount;
      };

      // Helper to flush buffered text, extracting thinking and sanitizing
      const flushBuffer = function* (
        buffer: string,
        isEnd: boolean,
      ): Generator<IContent, string, unknown> {
        if (!buffer) return '';

        // Don't flush if we have unclosed think tags (unless this is the end)
        if (!isEnd && hasOpenThinkTag(buffer)) {
          return buffer;
        }

        // Extract thinking tags and accumulate
        const thinkBlock = extractThinkTags(buffer);
        if (thinkBlock) {
          if (accumulatedThinkingContent.length > 0) {
            accumulatedThinkingContent += ' ';
          }
          accumulatedThinkingContent += thinkBlock.thought;
          logger.debug(
            () =>
              `[OpenAIVercelProvider] Accumulated thinking: ${accumulatedThinkingContent.length} chars`,
          );
        }

        // Emit accumulated thinking block before other content
        if (
          !hasEmittedThinking &&
          accumulatedThinkingContent.length > 0 &&
          (isEnd || buffer.includes('</think>'))
        ) {
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'thinking',
                thought: accumulatedThinkingContent,
                sourceField: 'think_tags',
                isHidden: false,
              } as ThinkingBlock,
            ],
          } as IContent;
          hasEmittedThinking = true;
          logger.debug(
            () =>
              `[OpenAIVercelProvider] Emitted thinking block: ${accumulatedThinkingContent.length} chars`,
          );
        }

        // Sanitize and yield visible text
        const sanitizedText = sanitizeTextFn(buffer);
        if (sanitizedText) {
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: sanitizedText,
              } as TextBlock,
            ],
          } as IContent;
        }

        return '';
      };

      if (hasFullStream && (result as { fullStream?: unknown }).fullStream) {
        try {
          for await (const part of (
            result as {
              fullStream: AsyncIterable<{
                type: string;
                text?: string;
                toolCallId?: string;
                toolName?: string;
                input?: unknown;
                totalUsage?: LanguageModelUsage;
                finishReason?: string;
                error?: unknown;
              }>;
            }
          ).fullStream) {
            if (abortSignal?.aborted) {
              break;
            }

            switch (part.type) {
              case 'text-delta': {
                const text: string =
                  typeof part.text === 'string' ? part.text : '';
                if (text) {
                  // Check if this chunk or buffer contains think tags
                  const hasThinkContent =
                    text.includes('<think') ||
                    text.includes('</think') ||
                    textBuffer.includes('<think');

                  if (hasThinkContent) {
                    // Buffer mode: accumulate text for think tag processing
                    textBuffer += text;

                    // Flush buffer at natural break points if no open think tags
                    if (
                      !hasOpenThinkTag(textBuffer) &&
                      (textBuffer.includes('\n') ||
                        textBuffer.endsWith('. ') ||
                        textBuffer.endsWith('! ') ||
                        textBuffer.endsWith('? ') ||
                        textBuffer.length > 100)
                    ) {
                      for (const content of flushBuffer(textBuffer, false)) {
                        yield content;
                      }
                      textBuffer = '';
                    }
                  } else {
                    // Direct streaming mode: no think tags, stream text directly
                    yield {
                      speaker: 'ai',
                      blocks: [
                        {
                          type: 'text',
                          text,
                        } as TextBlock,
                      ],
                    } as IContent;
                  }
                }
                break;
              }
              case 'tool-call': {
                // Single completed tool call with already-parsed input
                if (part.toolCallId && part.toolName) {
                  collectedToolCalls.push({
                    toolCallId: String(part.toolCallId),
                    toolName: String(part.toolName),
                    input: part.input,
                  });
                }
                break;
              }
              case 'finish': {
                totalUsage = part.totalUsage as LanguageModelUsage | undefined;
                finishReason = part.finishReason;

                // Flush any remaining buffer on finish
                if (textBuffer) {
                  for (const content of flushBuffer(textBuffer, true)) {
                    yield content;
                  }
                  textBuffer = '';
                }

                if (logger.enabled) {
                  logger.debug(
                    () =>
                      `[OpenAIVercelProvider] streamText finished with reason: ${part.finishReason}`,
                    {
                      finishReason: part.finishReason,
                      hasUsage: !!totalUsage,
                      toolCallCount: collectedToolCalls.length,
                    },
                  );
                }
                break;
              }
              case 'error': {
                throw part.error ?? new Error('Streaming error from AI SDK');
              }
              case 'reasoning': {
                // Handle reasoning/thinking content from models like Kimi K2
                // Accumulate reasoning content rather than emitting immediately
                // This allows combining with <think> tags from text-delta
                const reasoning = (part as { text?: string }).text;
                if (reasoning) {
                  if (accumulatedThinkingContent.length > 0) {
                    accumulatedThinkingContent += ' ';
                  }
                  accumulatedThinkingContent += reasoning;
                  logger.debug(
                    () =>
                      `[OpenAIVercelProvider] Accumulated reasoning: ${accumulatedThinkingContent.length} chars`,
                  );
                }
                break;
              }
              default:
                // Ignore other parts: source, start-step, finish-step, etc.
                break;
            }
          }

          // Final buffer flush if not caught by finish event (e.g., aborted early)
          if (textBuffer) {
            for (const content of flushBuffer(textBuffer, true)) {
              yield content;
            }
            textBuffer = '';
          }

          // Emit any remaining accumulated thinking content that wasn't emitted yet
          if (!hasEmittedThinking && accumulatedThinkingContent.length > 0) {
            yield {
              speaker: 'ai',
              blocks: [
                {
                  type: 'thinking',
                  thought: accumulatedThinkingContent,
                  sourceField: 'reasoning_content',
                  isHidden: false,
                } as ThinkingBlock,
              ],
            } as IContent;
            hasEmittedThinking = true;
            logger.debug(
              () =>
                `[OpenAIVercelProvider] Emitted final thinking block: ${accumulatedThinkingContent.length} chars`,
            );
          }
        } catch (error) {
          if (
            abortSignal?.aborted ||
            (error &&
              typeof error === 'object' &&
              'name' in error &&
              (error as { name?: string }).name === 'AbortError')
          ) {
            logger.debug(
              () =>
                `[OpenAIVercelProvider] Streaming response cancelled by AbortSignal`,
            );
            throw error;
          }

          logger.error(
            () =>
              `[OpenAIVercelProvider] Error processing streaming response: ${error instanceof Error ? error.message : String(error)}`,
            { error },
          );
          throw wrapError(error, this.name);
        }
      } else {
        const legacyStream = result as {
          textStream?: AsyncIterable<string>;
          toolCalls?: Promise<
            Array<{ toolCallId?: string; toolName?: string; input?: unknown }>
          >;
          usage?: Promise<LanguageModelUsage | undefined>;
          finishReason?: Promise<string | undefined>;
        };

        try {
          if (legacyStream.textStream) {
            for await (const textChunk of legacyStream.textStream) {
              if (!textChunk) {
                continue;
              }
              yield {
                speaker: 'ai',
                blocks: [
                  {
                    type: 'text',
                    text: textChunk,
                  } as TextBlock,
                ],
              } as IContent;
            }
          }
        } catch (error) {
          if (
            abortSignal?.aborted ||
            (error &&
              typeof error === 'object' &&
              'name' in error &&
              (error as { name?: string }).name === 'AbortError')
          ) {
            throw error;
          }
          logger.error(
            () =>
              `[OpenAIVercelProvider] Legacy streaming response failed: ${error instanceof Error ? error.message : String(error)}`,
            { error },
          );
          throw wrapError(error, this.name);
        }

        const legacyToolCalls =
          (legacyStream.toolCalls
            ? await legacyStream.toolCalls.catch(() => [])
            : []) ?? [];
        for (const call of legacyToolCalls) {
          collectedToolCalls.push({
            toolCallId: String(call.toolCallId ?? crypto.randomUUID()),
            toolName: String(call.toolName ?? 'unknown_tool'),
            input: call.input,
          });
        }

        totalUsage = legacyStream.usage
          ? await legacyStream.usage.catch(() => undefined)
          : undefined;
        finishReason = legacyStream.finishReason
          ? await legacyStream.finishReason.catch(() => undefined)
          : undefined;
      }

      // Emit accumulated tool calls as a single IContent, with usage metadata if available
      if (collectedToolCalls.length > 0) {
        const blocks: ToolCallBlock[] = collectedToolCalls.map((call) => {
          let argsString = '{}';
          try {
            argsString =
              typeof call.input === 'string'
                ? call.input
                : JSON.stringify(call.input ?? {});
          } catch {
            argsString = '{}';
          }

          const processedParameters = processToolParameters(
            argsString,
            call.toolName,
          );

          return {
            type: 'tool_call',
            id: this.normalizeToHistoryToolId(
              this.normalizeToOpenAIToolId(call.toolCallId),
            ),
            name: call.toolName,
            parameters: processedParameters,
          } as ToolCallBlock;
        });

        const usageMeta = this.mapUsageToMetadata(totalUsage);
        const metadata =
          usageMeta || finishReason
            ? {
                ...(usageMeta ? { usage: usageMeta } : {}),
                ...(finishReason ? { finishReason } : {}),
              }
            : undefined;

        const toolContent: IContent = {
          speaker: 'ai',
          blocks,
          ...(metadata ? { metadata } : {}),
        };

        yield toolContent;
      } else {
        // Emit metadata-only message so callers can see usage/finish reason
        const usageMeta = this.mapUsageToMetadata(totalUsage);
        const metadata =
          usageMeta || finishReason
            ? {
                ...(usageMeta ? { usage: usageMeta } : {}),
                ...(finishReason ? { finishReason } : {}),
              }
            : undefined;

        if (metadata) {
          yield {
            speaker: 'ai',
            blocks: [],
            metadata,
          } as IContent;
        }
      }
    } else {
      // Non-streaming mode via generateText()
      let result;
      try {
        const aiToolFn = this.getAiTool();
        const toolsForGenerate =
          (!aiToolFn && formattedTools ? formattedTools : aiTools) ?? undefined;
        const generateOptions: Record<string, unknown> = {
          model,
          system: systemPrompt,
          messages,
          tools: toolsForGenerate,
          maxOutputTokens,
          temperature,
          topP,
          presencePenalty,
          frequencyPenalty,
          stopSequences,
          seed,
          maxRetries,
          abortSignal,
        };
        if (maxOutputTokens !== undefined) {
          generateOptions['maxTokens'] = maxOutputTokens;
        }

        result = await generateText(
          generateOptions as Parameters<typeof generateText>[0],
        );
      } catch (error) {
        logger.error(
          () =>
            `[OpenAIVercelProvider] Non-streaming chat completion failed: ${error instanceof Error ? error.message : String(error)}`,
          { error },
        );
        throw wrapError(error, this.name);
      }

      const blocks: Array<TextBlock | ToolCallBlock> = [];

      if (result.text) {
        blocks.push({
          type: 'text',
          text: result.text,
        } as TextBlock);
      }

      // Typed tool calls from AI SDK; execution is not automatic because we did not provide execute().
      const toolCalls: Array<TypedToolCall<VercelTools>> =
        'toolCalls' in result && result.toolCalls ? await result.toolCalls : [];

      for (const call of toolCalls) {
        const toolName: string = call.toolName ?? 'unknown_tool';
        const id: string = call.toolCallId ?? crypto.randomUUID();
        const rawInput =
          (call as { input?: unknown }).input ??
          (call as { args?: unknown }).args ??
          (call as { arguments?: unknown }).arguments;

        let argsString = '{}';
        try {
          argsString =
            typeof rawInput === 'string'
              ? rawInput
              : JSON.stringify(rawInput ?? {});
        } catch {
          argsString = '{}';
        }

        const processedParameters = processToolParameters(argsString, toolName);

        blocks.push({
          type: 'tool_call',
          id: this.normalizeToHistoryToolId(this.normalizeToOpenAIToolId(id)),
          name: toolName,
          parameters: processedParameters,
        } as ToolCallBlock);
      }

      if (blocks.length > 0 || result.usage) {
        const usageMeta = this.mapUsageToMetadata(
          result.usage as LanguageModelUsage | undefined,
        );

        const content: IContent = {
          speaker: 'ai',
          blocks,
          ...(usageMeta
            ? {
                metadata: {
                  usage: usageMeta,
                },
              }
            : {}),
        };

        yield content;
      }
    }
  }

  /**
   * Models listing – uses HTTP GET /models via fetch instead of the OpenAI SDK.
   * Falls back to a small static list if the request fails.
   */
  override async getModels(): Promise<IModel[]> {
    const logger = this.getLogger();

    try {
      const authToken = await this.getAuthToken();
      const baseURL = this.getBaseURL() ?? 'https://api.openai.com/v1';
      const url =
        baseURL.endsWith('/') || baseURL.endsWith('\\')
          ? `${baseURL}models`
          : `${baseURL}/models`;

      const headers: Record<string, string> = {
        ...(this.getCustomHeaders() ?? {}),
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await fetch(url, {
        headers,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = (await res.json()) as {
        data?: Array<{ id: string }>;
      };

      const models: IModel[] = [];
      for (const model of data.data ?? []) {
        // Filter out non-chat models (embeddings, audio, image, etc.)
        if (
          !/embedding|whisper|audio|tts|image|vision|dall[- ]?e|moderation/i.test(
            model.id,
          )
        ) {
          const contextWindow =
            (model as { context_window?: number }).context_window ??
            (model as { contextWindow?: number }).contextWindow;
          models.push({
            id: model.id,
            name: (model as { name?: string }).name ?? model.id,
            provider: this.name,
            supportedToolFormats: ['openai'],
            ...(typeof contextWindow === 'number'
              ? { contextWindow }
              : undefined),
          });
        }
      }

      const sortedModels =
        models.length > 0
          ? models.sort((a, b) => a.name.localeCompare(b.name))
          : this.getFallbackModels();

      return sortedModels;
    } catch (error) {
      logger.debug(
        () => `Error fetching models from OpenAI via Vercel provider: ${error}`,
      );
      return this.getFallbackModels();
    }
  }

  private getFallbackModels(): IModel[] {
    const providerName = this.name;
    const models: IModel[] = [
      {
        id: 'gpt-3.5-turbo',
        name: 'GPT-3.5 Turbo',
        provider: providerName,
        supportedToolFormats: ['openai'],
        contextWindow: 16385,
      },
      {
        id: 'gpt-4',
        name: 'GPT-4',
        provider: providerName,
        supportedToolFormats: ['openai'],
        contextWindow: 8192,
      },
      {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        provider: providerName,
        supportedToolFormats: ['openai'],
        contextWindow: 128000,
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        provider: providerName,
        supportedToolFormats: ['openai'],
        contextWindow: 128000,
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        provider: providerName,
        supportedToolFormats: ['openai'],
        contextWindow: 128000,
      },
      {
        id: 'o1-mini',
        name: 'o1-mini',
        provider: providerName,
        supportedToolFormats: ['openai'],
        contextWindow: 128000,
      },
      {
        id: 'o1-preview',
        name: 'o1-preview',
        provider: providerName,
        supportedToolFormats: ['openai'],
        contextWindow: 128000,
      },
    ];

    return models.sort((a, b) => a.name.localeCompare(b.name));
  }

  override getDefaultModel(): string {
    const baseURL = this.getBaseURL();
    if (
      baseURL &&
      (baseURL.includes('qwen') || baseURL.includes('dashscope'))
    ) {
      return process.env.LLXPRT_DEFAULT_MODEL || 'qwen3-coder-plus';
    }
    return process.env.LLXPRT_DEFAULT_MODEL || 'gpt-4o';
  }

  override getCurrentModel(): string {
    return this.getModel();
  }

  // No client caching for AI SDK provider – kept as no-op for compatibility.
  clearClientCache(runtimeKey?: string): void {
    void runtimeKey;
  }

  override clearState(): void {
    this.clearClientCache();
    this.clearAuthCache();
  }

  override getServerTools(): string[] {
    return [];
  }

  override async invokeServerTool(
    toolName: string,
    _params: unknown,
    _config?: unknown,
    _signal?: AbortSignal,
  ): Promise<unknown> {
    throw new Error(
      `Server tool '${toolName}' not supported by OpenAIVercelProvider`,
    );
  }

  override getToolFormat(): string {
    const format = this.detectToolFormat();
    const logger = new DebugLogger('llxprt:provider:openaivercel');
    logger.debug(() => `getToolFormat() called, returning: ${format}`, {
      provider: this.name,
      model: this.getModel(),
      format,
    });
    return format;
  }

  /**
   * Detects the tool call format based on the model being used.
   * Mirrors OpenAIProvider behavior so existing ToolFormatter logic works.
   */
  private detectToolFormat(): ToolFormat {
    const modelName = this.getModel() || this.getDefaultModel();
    const logger = new DebugLogger('llxprt:provider:openaivercel');

    // Check for Kimi K2 models (requires special ID format: functions.{name}:{index})
    if (isKimiModel(modelName)) {
      logger.debug(
        () => `Auto-detected 'kimi' format for K2 model: ${modelName}`,
      );
      return 'kimi';
    }

    const lowerModelName = modelName.toLowerCase();

    if (lowerModelName.includes('glm-4')) {
      logger.debug(
        () => `Auto-detected 'qwen' format for GLM-4.x model: ${modelName}`,
      );
      return 'qwen';
    }

    if (lowerModelName.includes('qwen')) {
      logger.debug(
        () => `Auto-detected 'qwen' format for Qwen model: ${modelName}`,
      );
      return 'qwen';
    }

    logger.debug(() => `Using default 'openai' format for model: ${modelName}`);
    return 'openai';
  }

  parseToolResponse(response: unknown): unknown {
    return response;
  }

  /**
   * Disallow memoization of model params to preserve stateless behavior.
   */
  setModelParams(_params: Record<string, unknown> | undefined): void {
    throw new Error(
      'ProviderCacheError("Attempted to memoize model parameters for openaivercel")',
    );
  }

  /**
   * Gets model parameters from SettingsService per call (stateless).
   * Mirrors OpenAIProvider.getModelParams for compatibility.
   */
  override getModelParams(): Record<string, unknown> | undefined {
    try {
      const settingsService = this.resolveSettingsService();
      const providerSettings = settingsService.getProviderSettings(this.name);

      const reservedKeys = new Set([
        'enabled',
        'apiKey',
        'api-key',
        'apiKeyfile',
        'api-keyfile',
        'baseUrl',
        'base-url',
        'model',
        'toolFormat',
        'tool-format',
        'toolFormatOverride',
        'tool-format-override',
        'defaultModel',
      ]);

      const params: Record<string, unknown> = {};
      if (providerSettings) {
        for (const [key, value] of Object.entries(providerSettings)) {
          if (reservedKeys.has(key) || value === undefined || value === null) {
            continue;
          }
          params[key] = value;
        }
      }

      return Object.keys(params).length > 0 ? params : undefined;
    } catch (error) {
      this.getLogger().debug(
        () =>
          `Failed to get OpenAIVercel provider settings from SettingsService: ${error}`,
      );
      return undefined;
    }
  }

  /**
   * Determines whether a response should be retried based on error codes.
   *
   * This is retained for compatibility with existing retryWithBackoff
   * callers, even though AI SDK's generateText/streamText have their
   * own built-in retry logic.
   */
  shouldRetryResponse(error: unknown): boolean {
    const logger = new DebugLogger('llxprt:provider:openaivercel');

    // Don't retry if it's a "successful" 200 error wrapper
    if (
      error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status?: number }).status === 200
    ) {
      return false;
    }

    let status: number | undefined;

    if (error && typeof error === 'object' && 'status' in error) {
      status = (error as { status?: number }).status;
    }

    if (!status && error && typeof error === 'object' && 'response' in error) {
      const response = (error as { response?: { status?: number } }).response;
      if (response && typeof response === 'object' && 'status' in response) {
        status = response.status;
      }
    }

    if (!status && error instanceof Error) {
      if (error.message.includes('429')) {
        status = 429;
      }
    }

    logger.debug(() => `shouldRetryResponse checking error:`, {
      hasError: !!error,
      errorType:
        error && typeof error === 'object'
          ? (error as { constructor?: { name?: string } }).constructor?.name
          : undefined,
      status,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorKeys: error && typeof error === 'object' ? Object.keys(error) : [],
      errorData:
        error && typeof error === 'object' && 'error' in error
          ? (error as { error?: unknown }).error
          : undefined,
    });

    const shouldRetry = Boolean(
      status === 429 || status === 503 || status === 504,
    );

    if (shouldRetry) {
      logger.debug(() => `Will retry request due to status ${status}`);
    }

    return shouldRetry;
  }
}
