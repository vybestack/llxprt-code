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

import { type IContent } from '../../services/history/IContent.js';
import { type IProviderConfig } from '../types/IProviderConfig.js';
import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { DebugLogger } from '../../debug/index.js';
import { type OAuthManager } from '../../auth/precedence.js';
import {
  convertToolsToOpenAIVercel,
  type OpenAIVercelTool,
} from './schemaConverter.js';
import {
  type ToolCallBlock,
  type TextBlock,
  type ThinkingBlock,
} from '../../services/history/IContent.js';
import { processToolParameters } from '../../tools/doubleEscapeUtils.js';
import { type IModel } from '../IModel.js';
import { type IProvider } from '../IProvider.js';
import { getCoreSystemPromptAsync } from '../../core/prompts.js';
import { shouldIncludeSubagentDelegation } from '../../prompt-config/subagent-delegation.js';
import { resolveUserMemory } from '../utils/userMemory.js';
import { convertToVercelMessages } from './messageConversion.js';
import { getToolIdStrategy } from '../../tools/ToolIdStrategy.js';
import { resolveRuntimeAuthToken } from '../utils/authToken.js';
import { isLocalEndpoint } from '../utils/localEndpoint.js';
import { AuthenticationError, wrapError } from './errors.js';
import {
  filterThinkingForContext,
  cleanKimiTokensFromThinking,
  type StripPolicy,
} from '../reasoning/reasoningUtils.js';
import { extractCacheMetrics } from '../utils/cacheMetricsExtractor.js';
import { extractThinkTagsAsBlock } from '../utils/thinkingExtraction.js';
import { sanitizeProviderText } from '../utils/textSanitizer.js';
import { detectToolFormat } from '../utils/toolFormatDetection.js';
import { getContentPreview } from '../utils/contentPreview.js';
import { isQwenBaseURL } from '../utils/qwenEndpoint.js';
import { shouldRetryOnStatus } from '../utils/retryStrategy.js';
import {
  normalizeToOpenAIToolId,
  normalizeToHistoryToolId,
} from '../utils/toolIdNormalization.js';

type VercelTools = Record<string, Tool<unknown, never>>;
const streamText = Ai.streamText;
const generateText = Ai.generateText;
const extractReasoningMiddleware = Ai.extractReasoningMiddleware;
const wrapLanguageModel = Ai.wrapLanguageModel;

interface CaptureBuffer {
  reasoningChunks: string[];
  finalized: boolean;
  headers?: Headers;
}

// isQwenBaseURL is imported from ../utils/qwenEndpoint.js

/**
 * Some OpenAI-compatible providers reject the OpenAI "developer" role. The Vercel
 * OpenAI provider maps system prompts to "developer" for non-gpt-* model IDs, so
 * we rewrite it back to "system" for compatibility.
 */
function createDeveloperRoleToSystemFetch(
  innerFetch: typeof fetch,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!init || typeof init.body !== 'string') {
      return innerFetch(input, init);
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(init.body) as unknown;
    } catch {
      return innerFetch(input, init);
    }

    if (
      // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      parsedBody === null ||
      parsedBody === undefined ||
      typeof parsedBody !== 'object' ||
      !('messages' in parsedBody) ||
      !Array.isArray(
        (parsedBody as { messages?: unknown }).messages as unknown[],
      )
    ) {
      return innerFetch(input, init);
    }

    let changed = false;
    const rewrittenMessages = (
      parsedBody as { messages: Array<Record<string, unknown>> }
    ).messages.map((message) => {
      // Runtime boundary: message comes from parsed JSON body, may be malformed
      // message typed as Record but could be null/undefined from malformed array

      if (
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
        message != null &&
        typeof message === 'object' &&
        (message as { role?: unknown }).role === 'developer'
      ) {
        changed = true;
        return { ...message, role: 'system' };
      }
      return message;
    });

    // changed is boolean, explicit false check for clarity
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Explicit false check for boolean flag
    if (changed === false) {
      return innerFetch(input, init);
    }

    const headers = new Headers(init.headers);
    headers.delete('content-length');

    return innerFetch(input, {
      ...init,
      headers,
      body: JSON.stringify({
        ...(parsedBody as Record<string, unknown>),
        messages: rewrittenMessages,
      }),
    });
  };
}

/**
 * Creates a custom fetch function that intercepts streaming responses
 * and extracts reasoning_content from SSE chunks.
 *
 * This is necessary because Vercel AI SDK doesn't expose reasoning_content
 * from the OpenAI-compatible API response. Kimi K2 and similar models
 * send reasoning via this field.
 *
 * @param captureBuffer - Shared buffer to store extracted reasoning and headers
 * @param logger - Debug logger for diagnostics
 */
function createReasoningCaptureFetch(
  captureBuffer: CaptureBuffer,
  logger: DebugLogger,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await fetch(input, init);

    captureBuffer.headers = response.headers;

    // Only intercept streaming responses
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream') || !response.body) {
      return response;
    }

    // Tee the response body so both our parser and SDK can read it
    const [parserStream, sdkStream] = response.body.tee();

    // Process the parser stream to extract reasoning_content
    // This runs in the background while SDK processes the other stream
    void (async () => {
      const reader = parserStream.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        // Intentional infinite loop with break conditions for streaming
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Streaming loop with explicit break
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            captureBuffer.finalized = true;
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE chunks (data: {...}\n\n)
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; // Keep incomplete line for next iteration

          // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          for (const line of lines) {
            // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
            if (!line.startsWith('data: ')) continue;
            const jsonStr = line.slice(6).trim();
            // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
            if (jsonStr === '[DONE]') continue;

            // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
            try {
              const parsed = JSON.parse(jsonStr) as {
                choices?: Array<{
                  delta?: { reasoning_content?: string };
                }>;
              };

              const reasoningContent =
                parsed.choices?.[0]?.delta?.reasoning_content;
              if (reasoningContent && typeof reasoningContent === 'string') {
                captureBuffer.reasoningChunks.push(reasoningContent);
                logger.debug(
                  () =>
                    `[ReasoningCaptureFetch] Captured reasoning_content chunk: ${reasoningContent.length} chars`,
                );
              }
            } catch {
              // Ignore JSON parse errors (malformed chunks)
            }
          }
        }
      } catch (err) {
        logger.debug(
          () =>
            `[ReasoningCaptureFetch] Stream parsing error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        reader.releaseLock();
        captureBuffer.finalized = true;
      }
    })();

    // Return response with the SDK stream
    return new Response(sdkStream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

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

    const providerConfig = config as IProviderConfig & {
      forceQwenOAuth?: boolean;
    };
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
    const forceQwenOAuth = Boolean(providerConfig?.forceQwenOAuth);

    const shouldEnableQwenOAuth = isQwenBaseURL(baseURL) || forceQwenOAuth;

    super(
      {
        name: 'openaivercel',
        apiKey: normalizedApiKey,
        baseURL,
        envKeyNames: ['OPENAI_API_KEY'],
        isOAuthEnabled: shouldEnableQwenOAuth && !!oauthManager,
        oauthProvider: shouldEnableQwenOAuth ? 'qwen' : undefined,
        oauthManager,
      },
      config,
    );
  }

  protected override supportsOAuth(): boolean {
    const providerConfig = this.providerConfig as
      | (IProviderConfig & {
          forceQwenOAuth?: unknown;
        })
      | undefined;
    const forceQwenOAuth = providerConfig?.forceQwenOAuth;
    const isForceQwenOAuthTruthy = Boolean(forceQwenOAuth) === true;
    if (isForceQwenOAuthTruthy) {
      return true;
    }
    if (this.name === 'qwen') {
      return true;
    }
    if (isQwenBaseURL(this.getBaseURL())) {
      return true;
    }
    return false;
  }

  /**
   * Create an OpenAI provider instance for this call using AI SDK v5.
   *
   * Uses the resolved runtime auth token and baseURL, and still allows
   * local endpoints without authentication (for Ollama-style servers).
   *
   * @param options - Normalized generate chat options
   * @param customFetch - Optional custom fetch function for intercepting responses
   */
  private async createOpenAIClient(
    options: NormalizedGenerateChatOptions,
    customFetch?: typeof fetch,
  ): Promise<ReturnType<typeof createOpenAI>> {
    const authToken =
      (await resolveRuntimeAuthToken(options.resolved.authToken)) ?? '';
    const baseURL = options.resolved.baseURL ?? this.baseProviderConfig.baseURL;
    const providerConfig = this.providerConfig as IProviderConfig & {
      forceQwenOAuth?: boolean;
    };
    const shouldForceSystemRole =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
      Boolean(providerConfig?.forceQwenOAuth) || isQwenBaseURL(baseURL);

    const requiresAuth = options.settings.getProviderSettings(this.name)[
      'requires-auth'
    ];
    const authExempt = requiresAuth === false || isLocalEndpoint(baseURL);
    if (!authToken && !authExempt) {
      throw new AuthenticationError(
        `Auth token unavailable for runtimeId=${options.runtime?.runtimeId} (REQ-SP4-003).`,
        this.name,
      );
    }

    const headers = this.getCustomHeaders();
    const fetchWithCompatibility = shouldForceSystemRole
      ? createDeveloperRoleToSystemFetch(customFetch ?? fetch)
      : customFetch;

    return createOpenAI({
      apiKey: authToken || undefined,
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: baseURL and headers may be empty strings/objects, should fall through to undefined */
      baseURL: baseURL || undefined,
      headers: headers || undefined,
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
      fetch: fetchWithCompatibility,
    });
  }

  /**
   * Extract model parameters from normalized options instead of settings service.
   * This mirrors OpenAIProvider but feeds AI SDK call options instead.
   */
  private extractModelParamsFromOptions(
    options: NormalizedGenerateChatOptions,
  ): Record<string, unknown> | undefined {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
    const modelParams = { ...(options.invocation?.modelParams ?? {}) };

    // Translate generic maxOutputTokens ephemeral to OpenAI's max_tokens
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
    const rawMaxOutput = options.settings?.get('maxOutputTokens');
    const genericMaxOutput =
      typeof rawMaxOutput === 'number' &&
      Number.isFinite(rawMaxOutput) &&
      rawMaxOutput > 0
        ? rawMaxOutput
        : undefined;
    if (
      genericMaxOutput !== undefined &&
      modelParams['max_tokens'] === undefined
    ) {
      modelParams['max_tokens'] = genericMaxOutput;
    }

    return Object.keys(modelParams).length > 0 ? modelParams : undefined;
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
  // normalizeToOpenAIToolId is imported from ../utils/toolIdNormalization.js
  // normalizeToHistoryToolId is imported from ../utils/toolIdNormalization.js

  /**
   * Convert internal history IContent[] to AI SDK ModelMessage[].
   *
   * This implementation uses textual tool replay for past tool calls/results.
   * New tool calls in the current response still use structured ToolCallBlocks.
   *
   * For Kimi K2 models, uses ToolIdStrategy to generate proper tool IDs
   * in the format functions.{name}:{index} instead of call_xxx.
   */
  private convertToModelMessages(
    contents: IContent[],
    options?: { includeReasoningInContext?: boolean },
  ): ModelMessage[] {
    const toolFormat = detectToolFormat(
      this.getModel() || this.getDefaultModel(),
      this.getLogger(),
    );

    // Create a ToolIdMapper based on the tool format
    // For Kimi K2, this generates sequential IDs in the format functions.{name}:{index}
    // For Mistral, this generates 9-char alphanumeric IDs
    const toolIdMapper =
      toolFormat === 'kimi' || toolFormat === 'mistral'
        ? getToolIdStrategy(toolFormat).createMapper(contents)
        : undefined;

    return convertToVercelMessages(
      contents,
      toolIdMapper,
      options,
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

    // eslint-disable-next-line sonarjs/too-many-break-or-continue-in-loop -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    for (const t of formattedTools) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
      if (t == null || t.type !== 'function') continue;
      const fn = t.function;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
      if (fn?.name == null || fn.name === '') continue;
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
      if (toolsRecord[fn.name] != null) continue;

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

  private mapUsageToMetadata(
    usage: LanguageModelUsage | undefined,
    headers?: Headers,
  ):
    | {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
        cachedTokens?: number;
        cacheCreationTokens?: number;
        cacheMissTokens?: number;
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

    const cacheMetricOrUndefined = (value: number | null | undefined) => {
      if (value == null || value === 0 || Number.isNaN(value)) {
        return undefined;
      }
      return value;
    };

    const cacheMetrics = extractCacheMetrics(usage, headers);

    return {
      promptTokens,
      completionTokens,
      totalTokens,
      cachedTokens: cacheMetricOrUndefined(cacheMetrics.cachedTokens),
      cacheCreationTokens: cacheMetricOrUndefined(
        cacheMetrics.cacheCreationTokens,
      ),
      cacheMissTokens: cacheMetricOrUndefined(cacheMetrics.cacheMissTokens),
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
  // extractThinkTagsAsBlock is imported from ../utils/thinkingExtraction.js
  // sanitizeProviderText is imported from ../utils/textSanitizer.js (replaces sanitizeText)
  // getContentPreview is imported from ../utils/contentPreview.js

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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
    const abortSignal = metadata?.abortSignal as AbortSignal | undefined;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
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
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
        metadataKeys: Object.keys(metadata ?? {}),
      });
    }

    // Reasoning settings with defaults
    const rsEnabled =
      (options.settings.get('reasoning.enabled') as boolean | undefined) ??
      true;
    const rsIncludeInResponse =
      (options.settings.get('reasoning.includeInResponse') as
        | boolean
        | undefined) ?? true;
    const rsIncludeInContext =
      (options.settings.get('reasoning.includeInContext') as
        | boolean
        | undefined) ?? false;
    const rsStripFromContext =
      (options.settings.get('reasoning.stripFromContext') as
        | StripPolicy
        | undefined) ?? 'all';
    const rsFormat =
      (options.settings.get('reasoning.format') as
        | 'native'
        | 'field'
        | undefined) ?? 'field';

    // Determine streaming vs non-streaming mode (default: enabled)
    const streamingSetting = ephemerals['streaming'];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
    const streamingResolved = options.resolved?.streaming;
    const streamingEnabled =
      streamingResolved === false
        ? false
        : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          streamingResolved === true
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
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
      () => options.invocation?.userMemory,
    );
    const mcpInstructions = options.config
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
      ?.getMcpClientManager?.()
      ?.getMcpInstructions();
    const includeSubagentDelegation = await shouldIncludeSubagentDelegation(
      toolNamesArg ?? [],
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
      () => options.config?.getSubagentManager?.(),
    );
    const isInteractive = options.config?.isInteractive;
    const systemPrompt = await getCoreSystemPromptAsync({
      userMemory,
      mcpInstructions,
      model: modelId,
      tools: toolNamesArg,
      includeSubagentDelegation,
      interactionMode:
        typeof isInteractive === 'function' &&
        isInteractive.call(options.config) === true
          ? 'interactive'
          : 'non-interactive',
    });

    // Filter thinking from context based on settings
    const stripPolicy = rsEnabled ? rsStripFromContext : 'all'; // If disabled, strip all
    const filteredContents = filterThinkingForContext(contents, stripPolicy);

    // Convert internal history to AI SDK ModelMessages with structured tool replay.
    const messages: ModelMessage[] = this.convertToModelMessages(
      filteredContents,
      { includeReasoningInContext: rsIncludeInContext },
    );

    if (logger.enabled) {
      logger.debug(() => `[OpenAIVercelProvider] Chat payload snapshot`, {
        messageCount: messages.length,
        messages: messages.map((msg) => ({
          role: msg.role,
          contentPreview: getContentPreview(msg.content),
        })),
      });
    }

    // Convert Gemini tools to OpenAI-style definitions using provider-specific converter
    const formattedTools = convertToolsToOpenAIVercel(tools);

    if (logger.enabled && formattedTools != null) {
      logger.debug(() => `[OpenAIVercelProvider] Tool conversion summary`, {
        hasTools: true,
        toolCount: formattedTools.length,
        toolNames: formattedTools.map((t) => t.function.name),
      });
    }

    // Build AI SDK ToolSet
    const aiTools = this.buildVercelTools(formattedTools);

    // Model parameters (temperature, top_p, etc.)
    const modelParams = this.extractModelParamsFromOptions(options) ?? {};
    const maxTokensMeta =
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
      (metadata?.maxTokens as number | undefined) ??
      (ephemerals['max-tokens'] as number | undefined);
    const maxTokensOverride =
      (modelParams['max_tokens'] as number | undefined) ?? undefined;
    const maxOutputTokens =
      // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
      typeof maxTokensMeta === 'number' && Number.isFinite(maxTokensMeta)
        ? maxTokensMeta
        : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          typeof maxTokensOverride === 'number' &&
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
        : // eslint-disable-next-line sonarjs/no-nested-conditional -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          Array.isArray(stopSetting)
          ? stopSetting
          : undefined;
    const seed = modelParams['seed'] as number | undefined;

    const maxRetries = (ephemerals['retries'] as number | undefined) ?? 2; // AI SDK default is 2

    const captureBuffer: CaptureBuffer = {
      reasoningChunks: [],
      finalized: false,
      headers: undefined,
    };

    const customFetch =
      streamingEnabled && rsEnabled
        ? createReasoningCaptureFetch(captureBuffer, logger)
        : undefined;

    // Instantiate AI SDK OpenAI provider + chat model
    const openaiProvider = await this.createOpenAIClient(options, customFetch);
    const providerWithChat = openaiProvider as unknown as {
      chat?: (modelId: string) => unknown;
      (modelId: string): unknown;
    };
    const baseModel = (
      providerWithChat.chat
        ? providerWithChat.chat(modelId)
        : providerWithChat(modelId)
    ) as LanguageModel;

    // For streaming: DON'T use middleware - let raw text with <think> tags flow through
    // so our manual extraction logic (extractThinkTagsAsBlock + flushBuffer) can process them.
    // The middleware removes tags from the text stream before our code sees them.
    //
    // For non-streaming: Use middleware to extract <think> tags and expose via result.reasoning
    // The middleware adds reasoning as a property on the generateText result.
    const useMiddlewareForNonStreaming = rsEnabled && !streamingEnabled;
    const model = useMiddlewareForNonStreaming
      ? wrapLanguageModel({
          model: baseModel as unknown as Parameters<
            typeof wrapLanguageModel
          >[0]['model'],
          middleware: extractReasoningMiddleware({
            tagName: 'think',
            separator: '\n',
          }),
        })
      : baseModel;

    if (logger.enabled) {
      logger.debug(
        () =>
          `[OpenAIVercelProvider] Reasoning: enabled=${rsEnabled}, streaming=${streamingEnabled}, useMiddleware=${useMiddlewareForNonStreaming}`,
      );
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
        result = streamText(streamOptions as Parameters<typeof streamText>[0]);
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
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
        result != null &&
        typeof result === 'object' &&
        'fullStream' in (result as { fullStream?: unknown });

      // Buffer for accumulating text chunks for <think> tag processing
      let textBuffer = '';
      let accumulatedThinkingContent = '';
      let hasEmittedThinking = false;

      // Capture shared utility references for use in nested functions
      const extractThinkTags = (text: string) =>
        extractThinkTagsAsBlock(text, logger);
      const sanitizeTextFn = (text: string) =>
        sanitizeProviderText(text, logger);

      // Helper to check if buffer has an open think tag without closing
      const hasOpenThinkTag = (text: string): boolean => {
        const openCount = (text.match(/<think>/gi) ?? []).length;
        const closeCount = (text.match(/<\/think>/gi) ?? []).length;
        return openCount > closeCount;
      };

      // Helper to flush buffered text, extracting thinking and sanitizing.
      // Note: This generator intentionally captures and mutates outer scope variables
      // (accumulatedThinkingContent, hasEmittedThinking) via closure. This is by design
      // to maintain state across multiple flush calls during streaming, allowing thinking
      // content to be accumulated across chunks and emitted as a single block.
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

      if (
        hasFullStream &&
        (result as { fullStream?: unknown }).fullStream != null
      ) {
        try {
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
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
            if (abortSignal?.aborted === true) {
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
                      // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
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
                totalUsage = part.totalUsage;
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
                if (!rsEnabled) break;
                const reasoning = (part as { text?: string }).text;
                if (!reasoning) break;

                // Clean K2 markers from thought
                const cleaned = cleanKimiTokensFromThinking(reasoning);

                if (rsIncludeInResponse && rsFormat === 'native') {
                  // Interleaved mode: emit thinking as it arrives (for Minimax M2)
                  yield {
                    speaker: 'ai',
                    blocks: [
                      {
                        type: 'thinking',
                        thought: cleaned,
                        sourceField: 'reasoning_content',
                        isHidden: false,
                      } as ThinkingBlock,
                    ],
                  } as IContent;
                } else if (rsIncludeInResponse) {
                  // Accumulate mode: buffer for K2/field mode
                  if (accumulatedThinkingContent.length > 0) {
                    accumulatedThinkingContent += ' ';
                  }
                  accumulatedThinkingContent += cleaned;
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
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (textBuffer) {
            for (const content of flushBuffer(textBuffer, true)) {
              yield content;
            }
            textBuffer = '';
          }

          // Emit any remaining accumulated thinking content that wasn't emitted yet
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
            !hasEmittedThinking &&
            accumulatedThinkingContent.length > 0 &&
            rsEnabled &&
            rsIncludeInResponse
          ) {
            // Clean K2 tokens from accumulated thinking
            const cleanedThought = cleanKimiTokensFromThinking(
              accumulatedThinkingContent,
            );
            yield {
              speaker: 'ai',
              blocks: [
                {
                  type: 'thinking',
                  thought: cleanedThought,
                  sourceField: 'reasoning_content',
                  isHidden: false,
                } as ThinkingBlock,
              ],
            } as IContent;
            hasEmittedThinking = true;
            logger.debug(
              () =>
                `[OpenAIVercelProvider] Emitted final thinking block: ${cleanedThought.length} chars`,
            );
          }

          // Emit reasoning_content captured from custom fetch (for Kimi K2 and similar)
          // This captures reasoning from the raw SSE stream that Vercel SDK doesn't expose
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (
            !hasEmittedThinking &&
            captureBuffer.reasoningChunks.length > 0 &&
            rsEnabled &&
            rsIncludeInResponse
          ) {
            const capturedReasoning = captureBuffer.reasoningChunks.join('');
            // Clean K2 tokens from captured reasoning
            const cleanedReasoning =
              cleanKimiTokensFromThinking(capturedReasoning);
            if (cleanedReasoning.length > 0) {
              yield {
                speaker: 'ai',
                blocks: [
                  {
                    type: 'thinking',
                    thought: cleanedReasoning,
                    sourceField: 'reasoning_content',
                    isHidden: false,
                  } as ThinkingBlock,
                ],
              } as IContent;
              hasEmittedThinking = true;
              logger.debug(
                () =>
                  `[OpenAIVercelProvider] Emitted captured reasoning_content: ${cleanedReasoning.length} chars from ${captureBuffer.reasoningChunks.length} chunks`,
              );
            }
          }
        } catch (error) {
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (
            // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
            abortSignal?.aborted === true ||
            (error != null &&
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
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (legacyStream.textStream != null) {
            for await (const textChunk of legacyStream.textStream) {
              if (typeof textChunk !== 'string' || textChunk === '') {
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
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (
            // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
            abortSignal?.aborted === true ||
            (error != null &&
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
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
          (legacyStream.toolCalls != null
            ? await legacyStream.toolCalls.catch(() => [])
            : []) ?? [];
        for (const call of legacyToolCalls) {
          collectedToolCalls.push({
            toolCallId: String(call.toolCallId ?? crypto.randomUUID()),
            toolName: String(call.toolName ?? 'unknown_tool'),
            input: call.input,
          });
        }

        totalUsage =
          legacyStream.usage != null
            ? await legacyStream.usage.catch(() => undefined)
            : undefined;
        finishReason =
          legacyStream.finishReason != null
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
            id: normalizeToHistoryToolId(
              normalizeToOpenAIToolId(call.toolCallId),
            ),
            name: call.toolName,
            parameters: processedParameters,
          } as ToolCallBlock;
        });

        const usageMeta = this.mapUsageToMetadata(
          totalUsage,
          captureBuffer.headers,
        );
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
        const usageMeta = this.mapUsageToMetadata(
          totalUsage,
          captureBuffer.headers,
        );
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

      const blocks: Array<TextBlock | ToolCallBlock | ThinkingBlock> = [];

      // Extract thinking from various sources
      let thinkingContent = '';

      // 1. Extract from <think> tags in text (if enabled)
      if (rsEnabled && rsIncludeInResponse && result.text) {
        const thinkBlock = extractThinkTagsAsBlock(result.text, logger);
        if (thinkBlock) {
          thinkingContent = thinkBlock.thought;
          logger.debug(
            () =>
              `[OpenAIVercelProvider] Extracted thinking from <think> tags: ${thinkingContent.length} chars`,
          );
        }
      }

      // 2. Extract from reasoning field (from extractReasoningMiddleware)
      if (rsEnabled && rsIncludeInResponse) {
        // AI SDK's extractReasoningMiddleware can return reasoning as either:
        // - A string (AI SDK v5 format)
        // - An array of { text: string } objects (older format)
        const reasoningField = (
          result as { reasoning?: string | Array<{ text: string }> }
        ).reasoning;
        let reasoning = '';
        if (typeof reasoningField === 'string') {
          reasoning = reasoningField;
        } else if (Array.isArray(reasoningField)) {
          reasoning = reasoningField
            .map((r) => r.text)
            .filter(
              (text): text is string => typeof text === 'string' && text !== '',
            )
            .join(' ');
        }
        if (reasoning !== '') {
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (thinkingContent.length > 0) {
            thinkingContent += ' ';
          }
          thinkingContent += reasoning;
          logger.debug(
            () =>
              `[OpenAIVercelProvider] Extracted reasoning from result field: ${reasoning.length} chars`,
          );
        }
      }

      // 3. Emit ThinkingBlock if we have thinking content
      if (thinkingContent.length > 0 && rsEnabled && rsIncludeInResponse) {
        // Clean K2 tokens from thinking
        const cleanedThinking = cleanKimiTokensFromThinking(thinkingContent);
        blocks.push({
          type: 'thinking',
          thought: cleanedThinking,
          sourceField: 'reasoning_content',
          isHidden: false,
        } as ThinkingBlock);
        logger.debug(
          () =>
            `[OpenAIVercelProvider] Emitted ThinkingBlock in non-streaming: ${cleanedThinking.length} chars`,
        );
      }

      // 4. Sanitize and emit text content
      if (result.text) {
        const sanitizedText = sanitizeProviderText(result.text, logger);
        if (sanitizedText) {
          blocks.push({
            type: 'text',
            text: sanitizedText,
          } as TextBlock);
        }
      }

      // Typed tool calls from AI SDK; execution is not automatic because we did not provide execute().
      // Use explicit nullish check to preserve fallback when result.toolCalls is nullish/absent
      const resultToolCalls = (
        result as { toolCalls?: Array<TypedToolCall<VercelTools>> | null }
      ).toolCalls;
      const toolCalls: Array<TypedToolCall<VercelTools>> =
        resultToolCalls != null ? await Promise.resolve(resultToolCalls) : [];

      for (const call of toolCalls) {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
        const toolName: string = call.toolName ?? 'unknown_tool';
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
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
          id: normalizeToHistoryToolId(normalizeToOpenAIToolId(id)),
          name: toolName,
          parameters: processedParameters,
        } as ToolCallBlock);
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Preserve defensive runtime boundary guard despite current static types.
      if (blocks.length > 0 || result.usage != null) {
        const usageMeta = this.mapUsageToMetadata(
          result.usage as LanguageModelUsage | undefined,
        );

        const content: IContent = {
          speaker: 'ai',
          blocks,
          ...(usageMeta != null
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
    if (isQwenBaseURL(this.getBaseURL())) {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: env var is string | undefined, empty string should fall through
      return process.env.LLXPRT_DEFAULT_MODEL || 'qwen3-coder-plus';
    }
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: env var is string | undefined, empty string should fall through
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
    const modelName = this.getModel() || this.getDefaultModel();
    const logger = new DebugLogger('llxprt:provider:openaivercel');
    const format = detectToolFormat(modelName, logger);
    logger.debug(() => `getToolFormat() called, returning: ${format}`, {
      provider: this.name,
      model: modelName,
      format,
    });
    return format;
  }

  /**
   * Detects the tool call format based on the model being used.
   * Mirrors OpenAIProvider behavior so existing ToolFormatter logic works.
   */
  // detectToolFormat is imported from ../utils/toolFormatDetection.js

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
   * @plan PLAN-20260126-SETTINGS-SEPARATION.P09
   * Now uses invocation.modelParams instead of filtering SettingsService
   */
  override getModelParams(): Record<string, unknown> | undefined {
    // Model params should come from invocation context, not SettingsService
    // This maintains compatibility with the provider interface
    return undefined;
  }

  /**
   * Determines whether a response should be retried based on error codes.
   *
   * This is retained for compatibility with existing retryWithBackoff
   * callers, even though AI SDK's generateText/streamText have their
   * own built-in retry logic.
   */
  shouldRetryResponse(error: unknown): boolean {
    return shouldRetryOnStatus(error, {
      logger: new DebugLogger('llxprt:provider:openaivercel'),
    });
  }
}
