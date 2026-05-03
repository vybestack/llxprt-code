/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy core boundary retained while larger decomposition continues. */

import type { GenerateContentResponse } from '@google/genai';
import {
  type Content,
  type GenerateContentConfig,
  type SendMessageParameters,
  type PartListUnion,
  ApiError,
} from '@google/genai';
import { retryWithBackoff } from '../utils/retry.js';
import { createAbortError } from '../utils/delay.js';
import type { IContent } from '../services/history/IContent.js';
import type {
  GenerateChatOptions,
  IProvider,
  ProviderToolset,
} from '../providers/IProvider.js';
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
import {
  nextStreamEventWithIdleTimeout,
  resolveStreamIdleTimeoutMs,
} from '../utils/streamIdleTimeout.js';

type ToolGroupArray = Array<{
  functionDeclarations: Array<{
    name: string;
    description?: string;
    parametersJsonSchema?: unknown;
  }>;
}>;
import { logApiRequest, logApiResponse, logApiError } from './turnLogging.js';
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
    // Widen to unknown for defensive runtime check (providerResolver may return null/undefined at runtime)
    const providerRuntime: unknown = provider;
    if (providerRuntime === undefined || providerRuntime === null) {
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

    if (syntheticResponse) {
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
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        toolCount: effectiveToolsFromConfig?.length ?? 0,
        baseUrl: baseUrlForCall,
      },
    );

    const runtimeContext = this.providerRuntimeBuilder(
      'DirectMessageProcessor.generateDirectMessage',
      {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
        toolCount: effectiveToolsFromConfig?.length ?? 0,
        ...(directOverrides ? { geminiDirectOverrides: directOverrides } : {}),
      },
    );

    const providerSupportsIContent =
      typeof provider.generateChatCompletion === 'function';
    if (!providerSupportsIContent) {
      throw new Error(
        `Provider ${provider.name} does not support IContent generation`,
      );
    }

    const timeoutController = new AbortController();
    const timeoutSignal = timeoutController.signal;
    const upstreamAbortSignal = params.config?.abortSignal;
    const onAbort = () => timeoutController.abort();
    upstreamAbortSignal?.addEventListener('abort', onAbort, { once: true });
    if (upstreamAbortSignal?.aborted === true) {
      onAbort();
    }

    const streamResponse = provider.generateChatCompletion({
      contents: contentsForApi,
      tools:
        effectiveToolsFromConfig.length > 0
          ? (effectiveToolsFromConfig as ProviderToolset)
          : undefined,
      config: runtimeContext.config,
      runtime: runtimeContext,
      invocation: {
        signal: timeoutSignal,
      } as unknown as GenerateChatOptions['invocation'],
      settings: runtimeContext.settingsService,
      metadata: runtimeContext.metadata,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      userMemory: runtimeContext.config?.getUserMemory?.(),
    });

    let lastResponse: IContent | undefined;
    let lastBlockWasNonText = false;
    let aggregatedText = '';

    // Resolve the effective idle timeout from config
    const effectiveTimeoutMs = resolveStreamIdleTimeoutMs(
      runtimeContext.config,
    );

    try {
      const iterator = streamResponse[Symbol.asyncIterator]();
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      while (true) {
        // Use watchdog if timeout > 0, otherwise call iterator.next() directly
        let nextResponse: IteratorResult<IContent, unknown>;
        if (effectiveTimeoutMs > 0) {
          nextResponse = await nextStreamEventWithIdleTimeout({
            iterator,
            timeoutMs: effectiveTimeoutMs,
            signal: timeoutSignal,
            onTimeout: () => {
              // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
              if (upstreamAbortSignal?.aborted === true) {
                return;
              }
              timeoutController.abort();
            },
            createTimeoutError: () => createAbortError(),
          });
        } else {
          // Watchdog disabled: call iterator.next() directly
          nextResponse = await iterator.next();
        }
        if (nextResponse.done === true) {
          break;
        }

        const iContent = nextResponse.value;
        lastResponse = iContent;
        const result = aggregateTextWithSpacing(
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
          iContent.blocks ?? [],
          aggregatedText,
          lastBlockWasNonText,
        );
        aggregatedText = result.text;
        lastBlockWasNonText = result.lastBlockWasNonText;
      }
    } finally {
      timeoutController.abort();
      upstreamAbortSignal?.removeEventListener('abort', onAbort);
    }

    if (!lastResponse) {
      throw new Error('No response from provider');
    }

    return this._processDirectResponse(
      lastResponse,
      aggregatedText,
      runtimeContext.config,
      {
        contents: contentsForApi,
        tools:
          effectiveToolsFromConfig.length > 0
            ? effectiveToolsFromConfig
            : undefined,
      },
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
      params.config?.tools && Array.isArray(params.config.tools)
        ? (params.config.tools as ToolGroupArray)
        : undefined;

    const configForHooks = this.runtimeContext.providerRuntime.config;
    let contentsForApi: IContent[] = userIContents;
    const effectiveToolsFromConfig =
      configForHooks && toolsFromConfig
        ? await this._applyToolSelectionHook(configForHooks, toolsFromConfig)
        : toolsFromConfig;

    if (configForHooks) {
      const hookResult = await this._handleBeforeModelHook(
        configForHooks,
        userIContents,
        effectiveToolsFromConfig,
      );
      if (hookResult.syntheticResponse) {
        return {
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: undefined tools array should default to empty array
          effectiveToolsFromConfig: effectiveToolsFromConfig || [],
          contentsForApi,
          syntheticResponse: hookResult.syntheticResponse,
        };
      }
      if (hookResult.modifiedContents) {
        contentsForApi = hookResult.modifiedContents;
      }
    }

    return {
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: undefined tools array should default to empty array
      effectiveToolsFromConfig: effectiveToolsFromConfig || [],
      contentsForApi,
      syntheticResponse: undefined,
    };
  }

  private async _applyToolSelectionHook(
    configForHooks: Config,
    toolsFromConfig: ToolGroupArray,
  ): Promise<ToolGroupArray> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    if (!configForHooks.getEnableHooks?.()) return toolsFromConfig;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    const hookSystem = configForHooks.getHookSystem?.();
    if (!hookSystem) return toolsFromConfig;
    await hookSystem.initialize();
    const toolSelectionResult =
      await hookSystem.fireBeforeToolSelectionEvent(toolsFromConfig);
    const modifiedConfig = toolSelectionResult?.applyToolConfigModifications({
      tools: toolsFromConfig,
    });
    if (
      modifiedConfig?.toolConfig &&
      'allowedFunctionNames' in modifiedConfig.toolConfig
    ) {
      const allowedFunctions = modifiedConfig.toolConfig.allowedFunctionNames;
      if (allowedFunctions !== undefined && allowedFunctions.length > 0) {
        return toolsFromConfig
          .map((toolGroup) => ({
            ...toolGroup,
            functionDeclarations: toolGroup.functionDeclarations.filter((fn) =>
              allowedFunctions.includes(fn.name),
            ),
          }))
          .filter((g) => g.functionDeclarations.length > 0) as ToolGroupArray;
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
        effectiveToolsFromConfig && effectiveToolsFromConfig.length > 0
          ? (effectiveToolsFromConfig as ProviderToolset)
          : undefined,
    };

    let beforeModelResult = undefined;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    if (configForHooks.getEnableHooks?.()) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      const hookSystem = configForHooks.getHookSystem?.();
      if (hookSystem) {
        await hookSystem.initialize();
        beforeModelResult =
          await hookSystem.fireBeforeModelEvent(requestForHook);
      }
    }

    if (beforeModelResult?.isBlockingDecision() === true) {
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
    if (syntheticResponse) {
      return { syntheticResponse };
    }

    if (beforeModelResult) {
      const modifiedRequest = beforeModelResult.applyLLMRequestModifications({
        model: this.runtimeContext.state.model || '',
        contents: ContentConverters.toGeminiContents(userIContents),
      });
      // Runtime-widen to handle potential undefined from API
      const contentsRuntime: unknown = modifiedRequest.contents;
      if (contentsRuntime !== undefined && contentsRuntime !== null) {
        return {
          modifiedContents: ContentConverters.toIContents(
            contentsRuntime as Content[],
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
    llmRequest?: Record<string, unknown>,
  ): Promise<GenerateContentResponse> {
    let directResponse = convertIContentToResponse(lastResponse);

    // Trigger AfterModel hook
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    if (config?.getEnableHooks?.() === true) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      const hookSystem = config.getHookSystem?.();
      if (hookSystem) {
        await hookSystem.initialize();
        const afterModelResult = await hookSystem.fireAfterModelEvent(
          llmRequest ?? {},
          lastResponse,
        );
        if (afterModelResult) {
          const modifiedResponse = afterModelResult.getModifiedResponse();
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (modifiedResponse) {
            directResponse = modifiedResponse;
          }
        }
      }
    }

    // Ensure text content is included
    if (aggregatedText.trim()) {
      const candidate = directResponse.candidates?.[0];
      if (candidate) {
        const parts = candidate.content?.parts ?? [];
        const hasText = parts.some(
          (part) => typeof part.text === 'string' && part.text.trim() !== '',
        );
        if (!hasText) {
          candidate.content = candidate.content ?? {
            role: 'model',
            parts: [],
          };
          candidate.content.parts = [
            ...(candidate.content.parts ?? []),
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
    if (!config) {
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
