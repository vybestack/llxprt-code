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
import { declaredMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { convertToolsToOpenAIVercel } from './schemaConverter.js';
import { type IModel } from '../IModel.js';
import { type IProvider } from '../IProvider.js';
import { convertToVercelMessages } from './messageConversion.js';
import { getToolIdStrategy } from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import { isQwenBaseURL } from '../utils/qwenEndpoint.js';
import { isAbortSignal } from '../utils/abortSignal.js';
import { shouldRetryOnStatus } from '../utils/retryStrategy.js';
import { filterThinkingForContext } from '../reasoning/reasoningUtils.js';
import { resolveToolFormat } from '../utils/toolFormatDetection.js';

import {
  resolveReasoningSettings,
  resolveStreamingEnabled,
  resolveModelCallParams,
} from './vercelRequestParams.js';
import { resolveSystemPrompt } from './vercelSystemPrompt.js';
import { requireAssembledSystemInstruction } from '../utils/systemPromptPlacement.js';
import {
  finishMediaRequest,
  type MediaRequestOutcome,
  resolveRequestMedia,
} from '../utils/request-media-resolution.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
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
interface VercelMediaPreparation {
  readonly mediaRequest: ResolvedMediaRequest;
  readonly effectiveOptions: NormalizedGenerateChatOptions;
}

function resolveAbortSignal(
  metadata: Record<string, unknown>,
): AbortSignal | undefined {
  const signal = metadata['abortSignal'];
  return isAbortSignal(signal) ? signal : undefined;
}

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
        mediaTransportCapabilities:
          declaredMediaTransportCapabilities('openaivercel'),
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

  private async resolveMediaPreparation(
    options: NormalizedGenerateChatOptions,
  ): Promise<VercelMediaPreparation> {
    requireAssembledSystemInstruction(options.systemInstruction);
    const mediaRequest = await resolveRequestMedia(
      options.runtime,
      options.contents,
      options.invocation.signal,
    );
    try {
      return {
        mediaRequest,
        effectiveOptions: {
          ...options,
          contents: mediaRequest.withContents((contents) => contents),
        },
      };
    } catch (error) {
      return finishMediaRequest(mediaRequest, { status: 'failed', error });
    }
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

  private convertRequestContents(
    options: NormalizedGenerateChatOptions,
    modelId: string,
    reasoning: ReturnType<typeof resolveReasoningSettings>,
  ): ModelMessage[] {
    const stripPolicy = reasoning.enabled ? reasoning.stripFromContext : 'all';
    return this.convertToModelMessages(
      filterThinkingForContext(options.contents, stripPolicy),
      {
        includeReasoningInContext: reasoning.includeInContext,
        resolvedModel: modelId,
      },
    );
  }

  /**
   * Core chat completion implementation using AI SDK v5.
   */
  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const logger = this.getLogger();
    const modelId = options.resolved.model || this.getDefaultModel();
    const materializedMessages: ModelMessage[] = [];

    const { mediaRequest, effectiveOptions } =
      await this.resolveMediaPreparation(options);
    let outcome: MediaRequestOutcome = { status: 'succeeded' };
    try {
      const { tools, metadata } = effectiveOptions;
      const abortSignal = resolveAbortSignal(metadata);
      logRequestContext(logger, this.name, effectiveOptions, modelId, metadata);

      const rs = resolveReasoningSettings(effectiveOptions);
      const streamingEnabled = resolveStreamingEnabled(effectiveOptions);
      const systemPrompt = resolveSystemPrompt(effectiveOptions);
      materializedMessages.push(
        ...this.convertRequestContents(effectiveOptions, modelId, rs),
      );

      const formattedTools = convertToolsToOpenAIVercel(tools);
      logChatPayload(logger, materializedMessages, formattedTools ?? undefined);

      const aiTools = buildVercelTools(formattedTools);
      const params = resolveModelCallParams(effectiveOptions, metadata, this);
      const rawFieldName = effectiveOptions.settings.get(
        'reasoning.fieldName',
      ) as string | undefined;
      const captureBuffer: CaptureBuffer = createCaptureBuffer(rawFieldName);
      const { model } = await createConfiguredModel(
        effectiveOptions,
        this.getClientConfig(effectiveOptions),
        this.getDefaultModel(),
        rs.enabled,
        streamingEnabled,
        captureBuffer,
        logger,
      );

      logSendRequest(
        logger,
        modelId,
        effectiveOptions.resolved,
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
          materializedMessages,
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
          materializedMessages,
          aiTools,
          params,
          abortSignal,
          rs,
          formattedTools,
          logger,
        );
      }
    } catch (error) {
      outcome = { status: 'failed', error };
    } finally {
      materializedMessages.splice(0);
      await finishMediaRequest(mediaRequest, outcome);
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
        signal: AbortSignal.timeout(10_000),
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
