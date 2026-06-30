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
 *
 * NOTE: This provider acts as a thin orchestration layer. Concrete
 * request preparation, response parsing, streaming, reasoning capture,
 * and model listing are delegated to cohesive submodules in this
 * package to keep the provider class within lint budgets.
 */

import type { LanguageModel, ModelMessage } from 'ai';

import type {
  ModelCallParams,
  ReasoningSettings,
} from './vercelStreamTypes.js';

import { type IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { type IProviderConfig } from '../types/IProviderConfig.js';
import { firstTruthyString } from '../utils/falsyFallback.js';
import {
  BaseProvider,
  type NormalizedGenerateChatOptions,
} from '../BaseProvider.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { convertToolsToOpenAIVercel } from './schemaConverter.js';
import { type IModel } from '../IModel.js';
import { type IProvider } from '../IProvider.js';
import { convertToVercelMessages } from './messageConversion.js';
import { getToolIdStrategy } from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import { isQwenBaseURL } from '../utils/qwenEndpoint.js';
import { shouldRetryOnStatus } from '../utils/retryStrategy.js';
import { filterThinkingForContext } from '../reasoning/reasoningUtils.js';
import { resolveToolFormat } from '../utils/toolFormatDetection.js';

import {
  resolveReasoningSettings,
  resolveStreamingEnabled,
  resolveModelCallParams,
} from './vercelRequestParams.js';
import { buildSystemPrompt } from './vercelSystemPrompt.js';
import {
  createCaptureBuffer,
  type CaptureBuffer,
} from './vercelReasoningCapture.js';
import {
  buildVercelTools,
  createConfiguredModel,
  type ProviderClientConfig,
} from './vercelModelClient.js';
import {
  handleStreamingResponse,
  invokeStreamText,
  createStreamingState,
} from './vercelStreamHandler.js';
import {
  handleNonStreamingResponse,
  invokeGenerateText,
} from './vercelNonStreamingHandler.js';
import {
  logRequestContext,
  logChatPayload,
  logSendRequest,
} from './vercelLogging.js';
import {
  filterChatModels,
  sortModelsOrFallback,
} from './vercelModelListing.js';

/**
 * Vercel OpenAI-based provider using AI SDK v5.
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
  ) {
    const normalizedApiKey =
      apiKey && apiKey.trim() !== '' ? apiKey : undefined;

    super(
      {
        name: 'openaivercel',
        apiKey: normalizedApiKey,
        baseURL,
        envKeyNames: ['OPENAI_API_KEY'],
        isOAuthEnabled: false,
      },
      config,
    );
  }

  protected override supportsOAuth(): boolean {
    // Standard OpenAI-compatible endpoints don't support OAuth
    return false;
  }

  private convertToModelMessages(
    contents: IContent[],
    options?: { includeReasoningInContext?: boolean; resolvedModel?: string },
  ): ModelMessage[] {
    const settings = this.resolveSettingsService();
    const modelName =
      options?.resolvedModel ?? (this.getModel() || this.getDefaultModel());
    const toolFormat = resolveToolFormat(
      modelName,
      this.name,
      settings,
      this.getLogger(),
    );

    const toolIdMapper =
      toolFormat === 'kimi' || toolFormat === 'mistral'
        ? getToolIdStrategy(toolFormat).createMapper(contents)
        : undefined;

    return convertToVercelMessages(contents, toolIdMapper, options);
  }

  private getClientConfig(
    options: NormalizedGenerateChatOptions,
  ): ProviderClientConfig {
    return {
      baseURL: this.baseProviderConfig.baseURL,
      providerName: this.name,
      requiresAuth: options.settings.getProviderSettings(this.name)[
        'requires-auth'
      ] as boolean | undefined,
      customHeaders: this.getCustomHeaders(),
    };
  }

  /**
   * Core chat completion implementation using AI SDK v5.
   */
  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const logger = this.getLogger();
    const { contents, tools, metadata } = options;
    const modelId = options.resolved.model || this.getDefaultModel();
    const abortSignal = metadata['abortSignal'] as AbortSignal | undefined;

    logRequestContext(logger, this.name, options, modelId, metadata);

    const rs = resolveReasoningSettings(options);
    const streamingEnabled = resolveStreamingEnabled(options);
    const systemPrompt = await buildSystemPrompt(options, tools, modelId);
    const stripPolicy = rs.enabled ? rs.stripFromContext : 'all';
    const filteredContents = filterThinkingForContext(contents, stripPolicy);
    const messages: ModelMessage[] = this.convertToModelMessages(
      filteredContents,
      {
        includeReasoningInContext: rs.includeInContext,
        resolvedModel: modelId,
      },
    );

    const formattedTools = convertToolsToOpenAIVercel(tools);
    logChatPayload(logger, messages, formattedTools ?? undefined);

    const aiTools = buildVercelTools(formattedTools);
    const params = resolveModelCallParams(options, metadata, this);
    const captureBuffer: CaptureBuffer = createCaptureBuffer();
    const { model } = await createConfiguredModel(
      options,
      this.getClientConfig(options),
      this.getDefaultModel(),
      rs.enabled,
      streamingEnabled,
      captureBuffer,
      logger,
    );

    logSendRequest(
      logger,
      modelId,
      options.resolved,
      streamingEnabled,
      aiTools,
      rs,
      params.maxOutputTokens,
      this.getBaseURL(),
    );

    if (streamingEnabled) {
      yield* this.executeStreamingRequest(
        model,
        systemPrompt,
        messages,
        aiTools,
        params,
        abortSignal,
        rs,
        captureBuffer,
        logger,
      );
    } else {
      yield* this.executeNonStreamingRequest(
        model,
        systemPrompt,
        messages,
        aiTools,
        params,
        abortSignal,
        rs,
        formattedTools,
        logger,
      );
    }
  }

  private async *executeStreamingRequest(
    model: Parameters<typeof invokeStreamText>[0],
    systemPrompt: string,
    messages: ModelMessage[],
    aiTools: ReturnType<typeof buildVercelTools>,
    params: Parameters<typeof resolveModelCallParams>[0] extends never
      ? never
      : Awaited<ReturnType<typeof resolveModelCallParams>>,
    abortSignal: AbortSignal | undefined,
    rs: ReturnType<typeof resolveReasoningSettings>,
    captureBuffer: CaptureBuffer,
    logger: DebugLogger,
  ): AsyncIterableIterator<IContent> {
    const result = invokeStreamText(
      model,
      systemPrompt,
      messages,
      aiTools,
      params,
      abortSignal,
      logger,
      this.name,
    );
    const state = createStreamingState();
    yield* handleStreamingResponse(
      result,
      state,
      rs,
      captureBuffer,
      abortSignal,
      logger,
      this.name,
    );
  }

  private async *executeNonStreamingRequest(
    model: LanguageModel,
    systemPrompt: string,
    messages: ModelMessage[],
    aiTools: ReturnType<typeof buildVercelTools>,
    params: ModelCallParams,
    abortSignal: AbortSignal | undefined,
    rs: ReasoningSettings,
    formattedTools: ReturnType<typeof convertToolsToOpenAIVercel>,
    logger: DebugLogger,
  ): AsyncIterableIterator<IContent> {
    const result = await invokeGenerateText(
      model,
      systemPrompt,
      messages,
      aiTools,
      params,
      abortSignal,
      formattedTools,
      logger,
      this.name,
    );
    yield* handleNonStreamingResponse(result, rs, logger);
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
        data?: Array<{ id: string } & Record<string, unknown>>;
      };

      const models = filterChatModels(data, this.name);
      return sortModelsOrFallback(models, this.name);
    } catch (error) {
      logger.debug(
        () => `Error fetching models from OpenAI via Vercel provider: ${error}`,
      );
      return sortModelsOrFallback([], this.name);
    }
  }

  override getDefaultModel(): string {
    if (isQwenBaseURL(this.getBaseURL())) {
      return firstTruthyString(
        process.env.LLXPRT_DEFAULT_MODEL,
        'qwen3-coder-plus',
      );
    }
    return firstTruthyString(process.env.LLXPRT_DEFAULT_MODEL, 'gpt-4o');
  }

  override getCurrentModel(): string {
    return this.getModel();
  }

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
    const settings = this.resolveSettingsService();
    const logger = new DebugLogger('llxprt:provider:openaivercel');
    const format = resolveToolFormat(modelName, this.name, settings, logger);
    logger.debug(() => `getToolFormat() called, returning: ${format}`, {
      provider: this.name,
      model: modelName,
      format,
    });
    return format;
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
   * @plan PLAN-20260126-SETTINGS-SEPARATION.P09
   */
  override getModelParams(): Record<string, unknown> | undefined {
    return undefined;
  }

  /**
   * Determines whether a response should be retried based on error codes.
   */
  shouldRetryResponse(error: unknown): boolean {
    return shouldRetryOnStatus(error, {
      logger: new DebugLogger('llxprt:provider:openaivercel'),
    });
  }
}
