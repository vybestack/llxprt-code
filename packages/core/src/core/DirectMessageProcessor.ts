/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateContentResponse } from '@google/genai';
import {
  type Content,
  type GenerateContentConfig,
  type SendMessageParameters,
  type PartListUnion,
  ApiError,
} from '@google/genai';
import { retryWithBackoff } from '../utils/retry.js';
import type { IContent } from '../services/history/IContent.js';
import type { IProvider, ProviderToolset } from '../providers/IProvider.js';
import type { AgentRuntimeContext } from '../runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import type { HistoryService } from '../services/history/HistoryService.js';
import { ContentConverters } from '../services/history/ContentConverters.js';
import {
  normalizeToolInteractionInput,
  convertIContentToResponse,
  aggregateTextWithSpacing,
} from './MessageConverter.js';
import { isSchemaDepthError } from './geminiChatTypes.js';

type ToolGroupArray = Array<{
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parametersJsonSchema?: unknown;
  }>;
}>;
import { logApiRequest, logApiResponse, logApiError } from './turnLogging.js';
import {
  triggerBeforeToolSelectionHook,
  triggerBeforeModelHook,
  triggerAfterModelHook,
} from './geminiChatHookTriggers.js';
import { DebugLogger } from '../debug/index.js';
import type { Config } from '../config/config.js';

/**
 * Handles non-streaming direct message generation.
 * Extracted from GeminiChat to separate concerns.
 */
export class DirectMessageProcessor {
  private logger = new DebugLogger('llxprt:direct-message-processor');

  constructor(
    private readonly runtimeContext: AgentRuntimeContext,
    private readonly providerResolver: (contextLabel: string) => IProvider,
    private readonly providerRuntimeBuilder: (
      source: string,
      extras?: Record<string, unknown>,
    ) => ProviderRuntimeContext,
    private readonly historyService: HistoryService,
    private readonly makePositionMatcher: () =>
      | (() => { historyId: string; toolName?: string })
      | undefined,
  ) {}

  /**
   * Generates a direct (non-streaming) message response.
   * Handles user input conversion, pre-send hooks, provider calls with retry,
   * and post-response processing.
   */
  async generateDirectMessage(
    params: SendMessageParameters,
    prompt_id: string,
  ): Promise<GenerateContentResponse> {
    const provider = this.providerResolver('DirectMessageProcessor');
    if (!provider) {
      throw new Error('No active provider configured');
    }

    const userIContents = this._convertUserInput(params.message);
    const requestContents = ContentConverters.toGeminiContents(userIContents);

    logApiRequest(
      this.runtimeContext,
      this.runtimeContext.state,
      requestContents,
      this.runtimeContext.state.model,
      prompt_id,
    );

    const startTime = Date.now();

    try {
      const response = await this._executeWithRetry(
        provider,
        params,
        userIContents,
      );

      const durationMs = Date.now() - startTime;
      logApiResponse(
        this.runtimeContext,
        this.runtimeContext.state,
        this.runtimeContext.state.model,
        prompt_id,
        durationMs,
        response.usageMetadata,
        JSON.stringify(response),
      );

      return response;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      logApiError(
        this.runtimeContext,
        this.runtimeContext.state,
        this.runtimeContext.state.model,
        prompt_id,
        durationMs,
        error,
      );
      throw error;
    }
  }

  /**
   * Converts user input message to IContent array.
   */
  private _convertUserInput(message: PartListUnion): IContent[] {
    const userContent = normalizeToolInteractionInput(message);
    const matcher = this.makePositionMatcher();
    const userIContents: IContent[] = Array.isArray(userContent)
      ? userContent.map((content) => {
          const turnKey = this.historyService.generateTurnKey();
          const idGen = this.historyService.getIdGeneratorCallback(turnKey);
          return ContentConverters.toIContent(content, idGen, matcher, turnKey);
        })
      : [
          (() => {
            const turnKey = this.historyService.generateTurnKey();
            const idGen = this.historyService.getIdGeneratorCallback(turnKey);
            return ContentConverters.toIContent(
              userContent,
              idGen,
              matcher,
              turnKey,
            );
          })(),
        ];

    return userIContents;
  }

  /**
   * Executes the provider call with retry logic.
   */
  private async _executeWithRetry(
    provider: IProvider,
    params: SendMessageParameters,
    userIContents: IContent[],
  ): Promise<GenerateContentResponse> {
    return retryWithBackoff(
      async () =>
        this._executeDirectProviderCall(provider, params, userIContents),
      {
        shouldRetryOnError: (error: unknown) => {
          if (error instanceof ApiError && error.message) {
            if (error.status === 400) return false;
            if (isSchemaDepthError(error.message)) return false;
            if (error.status === 429) return true;
            if (error.status >= 500 && error.status < 600) return true;
          }
          return false;
        },
      },
    );
  }

  /**
   * Executes the direct provider call after applying pre-send hooks.
   */
  private async _executeDirectProviderCall(
    provider: IProvider,
    params: SendMessageParameters,
    userIContents: IContent[],
  ): Promise<GenerateContentResponse> {
    const { effectiveToolsFromConfig, contentsForApi, syntheticResponse } =
      await this._applyPreSendHooks(params, userIContents);

    if (syntheticResponse != null) {
      return syntheticResponse;
    }

    const directOverrides = this._extractDirectGeminiOverrides(params.config);
    const baseUrlForCall = this.runtimeContext.state.baseUrl;

    this.logger.debug(
      () =>
        '[DirectMessageProcessor] Calling provider.generateChatCompletion (non-stream retry path)',
      {
        providerName: provider.name,
        model: this.runtimeContext.state.model,
        toolCount: effectiveToolsFromConfig?.length ?? 0,
        baseUrl: baseUrlForCall,
      },
    );

    const runtimeContext = this.providerRuntimeBuilder(
      'DirectMessageProcessor.generateDirectMessage',
      {
        toolCount: effectiveToolsFromConfig?.length ?? 0,
        ...(directOverrides != null
          ? { geminiDirectOverrides: directOverrides }
          : {}),
      },
    );

    const providerSupportsIContent =
      typeof provider.generateChatCompletion === 'function';
    if (!providerSupportsIContent) {
      throw new Error(
        `Provider ${provider.name} does not support IContent generation`,
      );
    }

    const streamResponse = provider.generateChatCompletion({
      contents: contentsForApi,
      tools:
        effectiveToolsFromConfig && effectiveToolsFromConfig.length > 0
          ? (effectiveToolsFromConfig as ProviderToolset)
          : undefined,
      config: runtimeContext.config,
      runtime: runtimeContext,
      settings: runtimeContext.settingsService,
      metadata: runtimeContext.metadata,
      userMemory: runtimeContext.config?.getUserMemory?.(),
    });

    let lastResponse: IContent | undefined;
    let lastBlockWasNonText = false;
    let aggregatedText = '';
    for await (const iContent of streamResponse) {
      lastResponse = iContent;
      const result = aggregateTextWithSpacing(
        iContent.blocks ?? [],
        aggregatedText,
        lastBlockWasNonText,
      );
      aggregatedText = result.text;
      lastBlockWasNonText = result.lastBlockWasNonText;
    }

    if (lastResponse == null) {
      throw new Error('No response from provider');
    }

    return this._processDirectResponse(
      lastResponse,
      aggregatedText,
      runtimeContext.config,
    );
  }

  /**
   * Applies pre-send hooks (BeforeToolSelection and BeforeModel).
   * Returns effective tools, modified contents, and optionally a synthetic response.
   */
  private async _applyPreSendHooks(
    params: SendMessageParameters,
    userIContents: IContent[],
  ): Promise<{
    effectiveToolsFromConfig: ToolGroupArray;
    contentsForApi: IContent[];
    syntheticResponse: GenerateContentResponse | undefined;
  }> {
    const toolsFromConfig =
      params.config?.tools != null && Array.isArray(params.config.tools)
        ? (params.config.tools as ToolGroupArray)
        : undefined;

    const configForHooks = this.runtimeContext.providerRuntime.config;
    let contentsForApi: IContent[] = userIContents;
    const effectiveToolsFromConfig =
      configForHooks != null && toolsFromConfig != null
        ? await this._applyToolSelectionHook(configForHooks, toolsFromConfig)
        : toolsFromConfig;

    if (configForHooks != null) {
      const hookResult = await this._handleBeforeModelHook(
        configForHooks,
        userIContents,
        effectiveToolsFromConfig,
      );
      if (hookResult.syntheticResponse != null) {
        return {
          effectiveToolsFromConfig: effectiveToolsFromConfig || [],
          contentsForApi,
          syntheticResponse: hookResult.syntheticResponse,
        };
      }
      if (hookResult.modifiedContents != null) {
        contentsForApi = hookResult.modifiedContents;
      }
    }

    return {
      effectiveToolsFromConfig: effectiveToolsFromConfig || [],
      contentsForApi,
      syntheticResponse: undefined,
    };
  }

  private async _applyToolSelectionHook(
    configForHooks: Config,
    toolsFromConfig: ToolGroupArray,
  ): Promise<ToolGroupArray> {
    const toolSelectionResult = await triggerBeforeToolSelectionHook(
      configForHooks,
      toolsFromConfig,
    );
    const modifiedConfig = toolSelectionResult?.applyToolConfigModifications({
      tools: toolsFromConfig,
    });
    if (
      modifiedConfig?.toolConfig != null &&
      'allowedFunctionNames' in modifiedConfig.toolConfig
    ) {
      const allowedFunctions = modifiedConfig.toolConfig.allowedFunctionNames;
      if (allowedFunctions?.length) {
        return toolsFromConfig
          .map((toolGroup) => ({
            ...toolGroup,
            functionDeclarations: toolGroup.functionDeclarations?.filter((fn) =>
              allowedFunctions.includes(fn.name),
            ),
          }))
          .filter((g) => g.functionDeclarations?.length) as ToolGroupArray;
      }
    }
    return toolsFromConfig;
  }

  /**
   * Handles BeforeModel hook logic and returns synthetic response if needed.
   */
  private async _handleBeforeModelHook(
    configForHooks: Config,
    userIContents: IContent[],
    effectiveToolsFromConfig:
      | Array<{
          functionDeclarations: Array<{
            name: string;
            description?: string;
            parametersJsonSchema?: unknown;
          }>;
        }>
      | undefined,
  ): Promise<{
    syntheticResponse?: GenerateContentResponse;
    modifiedContents?: IContent[];
  }> {
    const requestForHook = {
      contents: userIContents,
      tools:
        effectiveToolsFromConfig != null && effectiveToolsFromConfig.length > 0
          ? (effectiveToolsFromConfig as ProviderToolset)
          : undefined,
    };

    const beforeModelResult = await triggerBeforeModelHook(
      configForHooks,
      requestForHook,
    );

    if (beforeModelResult?.isBlockingDecision()) {
      const syntheticResponse = beforeModelResult.getSyntheticResponse();
      return {
        syntheticResponse:
          syntheticResponse ??
          ({
            candidates: [
              {
                content: {
                  role: 'model',
                  parts: [
                    {
                      text:
                        beforeModelResult.getEffectiveReason() ||
                        'Request blocked by BeforeModel hook',
                    },
                  ],
                },
              },
            ],
          } as GenerateContentResponse),
      };
    }

    const syntheticResponse = beforeModelResult?.getSyntheticResponse();
    if (syntheticResponse != null) {
      return { syntheticResponse };
    }

    if (beforeModelResult != null) {
      const modifiedRequest = beforeModelResult.applyLLMRequestModifications({
        model: this.runtimeContext.state.model || '',
        contents: ContentConverters.toGeminiContents(userIContents),
      });
      if (modifiedRequest?.contents) {
        return {
          modifiedContents: ContentConverters.toIContents(
            modifiedRequest.contents as Content[],
          ),
        };
      }
    }

    return {};
  }

  /**
   * Processes the direct response after receiving from provider.
   * Applies AfterModel hook and ensures text property is set.
   */
  private async _processDirectResponse(
    lastResponse: IContent,
    aggregatedText: string,
    config: Config | undefined,
  ): Promise<GenerateContentResponse> {
    let directResponse = convertIContentToResponse(lastResponse);

    // Trigger AfterModel hook
    if (config != null) {
      const afterModelResult = await triggerAfterModelHook(
        config,
        lastResponse,
      );

      if (afterModelResult != null) {
        const modifiedResponse = afterModelResult.getModifiedResponse();
        if (modifiedResponse != null) {
          directResponse = modifiedResponse;
        }
      }
    }

    // Ensure text content is included
    if (aggregatedText.trim()) {
      const candidate = directResponse.candidates?.[0];
      if (candidate != null) {
        const parts = candidate.content?.parts ?? [];
        const hasText = parts.some(
          (part) => 'text' in part && part.text?.trim(),
        );
        if (!hasText) {
          candidate.content = candidate.content || {
            role: 'model',
            parts: [],
          };
          candidate.content.parts = [
            ...(candidate.content.parts || []),
            { text: aggregatedText },
          ];
        }
      }
      Object.defineProperty(directResponse, 'text', {
        configurable: true,
        get() {
          return aggregatedText;
        },
      });
    }

    return directResponse;
  }

  /**
   * Extracts direct Gemini overrides from config.
   */
  private _extractDirectGeminiOverrides(config?: GenerateContentConfig):
    | {
        serverTools?: unknown;
        toolConfig?: unknown;
      }
    | undefined {
    if (config == null) {
      return undefined;
    }

    const overrides: {
      serverTools?: unknown;
      toolConfig?: unknown;
    } = {};

    const rawConfig = config as Record<string, unknown>;
    if ('serverTools' in rawConfig) {
      overrides.serverTools = rawConfig.serverTools;
    }
    if ('toolConfig' in rawConfig) {
      overrides.toolConfig = rawConfig.toolConfig;
    }

    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }
}
