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
import type { RuntimeProvider as IProvider } from '../runtime/contracts/RuntimeProvider.js';
import type {
  RuntimeGenerateChatOptions as GenerateChatOptions,
  RuntimeProviderToolset as ProviderToolset,
} from '../runtime/contracts/RuntimeProviderChat.js';
import type { AgentRuntimeContext } from '../runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '../runtime/providerRuntimeContext.js';
import type { HistoryService } from '../services/history/HistoryService.js';
import { ContentConverters } from '../services/history/ContentConverters.js';
import {
  normalizeToolInteractionInput,
  convertIContentToResponse,
  aggregateTextWithSpacing,
} from './MessageConverter.js';
import { isSchemaDepthError } from './chatSessionTypes.js';
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

interface ToolSelectionHookResult {
  tools: ToolGroupArray | undefined;
  allowedFunctionNames: string[] | undefined;
}

import { logApiRequest, logApiResponse, logApiError } from './turnLogging.js';
function isContentArray(value: unknown): value is Content[] {
  return Array.isArray(value);
}

function getIContentAutomaticFunctionCallingHistory(
  content: IContent,
): Content[] | undefined {
  const topLevelValue = (content as unknown as Record<string, unknown>)[
    'automaticFunctionCallingHistory'
  ];
  if (isContentArray(topLevelValue)) {
    return topLevelValue;
  }
  const metadataValue =
    content.metadata?.providerMetadata?.['automaticFunctionCallingHistory'];
  return isContentArray(metadataValue) ? metadataValue : undefined;
}

import { DebugLogger } from '../debug/index.js';
import type { Config } from '../config/config.js';
import {
  attachHookRestrictedAllowedTools,
  filterHookRestrictedContent,
  filterHookRestrictedContents,
} from './hookToolRestrictions.js';
import { canonicalizeToolName } from './toolGovernance.js';

/**
 * Handles non-streaming direct message generation.
 * Extracted from ChatSession to separate concerns.
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
    private readonly generationConfig: GenerateContentConfig,

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
   * Sets up an AbortController that propagates the upstream abort signal.
   */
  private _setupAbortController(upstreamAbortSignal: AbortSignal | undefined): {
    timeoutController: AbortController;
    timeoutSignal: AbortSignal;
    onAbort: () => void;
  } {
    const timeoutController = new AbortController();
    const timeoutSignal = timeoutController.signal;
    const onAbort = () => timeoutController.abort();
    upstreamAbortSignal?.addEventListener('abort', onAbort, { once: true });
    if (upstreamAbortSignal?.aborted === true) {
      onAbort();
    }
    return { timeoutController, timeoutSignal, onAbort };
  }

  /**
   * Consumes an async iterable of IContent, aggregating text across chunks.
   * Handles idle timeout via watchdog when configured.
   */
  private async _consumeStreamResponse(
    streamResponse: AsyncIterable<IContent>,
    timeoutController: AbortController,
    timeoutSignal: AbortSignal,
    upstreamAbortSignal: AbortSignal | undefined,
    effectiveTimeoutMs: number,
    onAbort: () => void,
    allowedFunctionNames: string[] | undefined,
  ): Promise<{
    lastResponse: IContent;
    aggregatedText: string;
  }> {
    let lastResponse: IContent | undefined;
    let lastBlockWasNonText = false;
    let aggregatedText = '';
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
        const { filteredIContent, response } = this._filterStreamedIContent(
          iContent,
          allowedFunctionNames,
        );
        lastResponse = response;

        const result = aggregateTextWithSpacing(
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
          filteredIContent.blocks ?? [],
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
    return {
      lastResponse,
      aggregatedText,
    };
  }

  private _filterStreamedIContent(
    iContent: IContent,
    allowedFunctionNames: string[] | undefined,
  ): { filteredIContent: IContent; response: IContent } {
    const filteredResponse = attachHookRestrictedAllowedTools(
      convertIContentToResponse(iContent),
      allowedFunctionNames,
    );
    const filteredIContent = ContentConverters.toIContent(
      filteredResponse.candidates?.[0]?.content ?? {
        role: 'model',
        parts: [],
      },
    );
    const afcHistory = getIContentAutomaticFunctionCallingHistory(iContent);
    const response: IContent = {
      ...filteredIContent,
      metadata: {
        ...filteredIContent.metadata,
        ...iContent.metadata,
        providerMetadata: {
          ...filteredIContent.metadata?.providerMetadata,
          automaticFunctionCallingHistory:
            afcHistory !== undefined
              ? filterHookRestrictedContents(
                  afcHistory,
                  allowedFunctionNames,
                ).filter((content) => (content.parts?.length ?? 0) > 0)
              : filteredResponse.automaticFunctionCallingHistory,
        },
      },
    };
    return { filteredIContent, response };
  }

  /**
   * Executes the direct provider call after applying pre-send hooks.
   */
  private async _executeDirectProviderCall(
    provider: IProvider,
    params: SendMessageParameters,
    userIContents: IContent[],
  ): Promise<GenerateContentResponse> {
    const {
      effectiveToolsFromConfig,
      contentsForApi,
      syntheticResponse,
      allowedFunctionNames,
    } = await this._applyPreSendHooks(params, userIContents);

    if (syntheticResponse) {
      return this._applyHookRestrictedAllowedTools(
        syntheticResponse,
        allowedFunctionNames,
      );
    }

    const runtimeContext = this.providerRuntimeBuilder(
      'DirectMessageProcessor.generateDirectMessage',
      this._buildProviderRuntimeMetadata(params, effectiveToolsFromConfig),
    );
    const upstreamAbortSignal = params.config?.abortSignal;
    const { timeoutController, timeoutSignal, onAbort } =
      this._setupAbortController(upstreamAbortSignal);
    const streamResponse = this._createDirectProviderStream(
      provider,
      contentsForApi,
      effectiveToolsFromConfig,
      runtimeContext,
      timeoutSignal,
    );
    const { lastResponse, aggregatedText } = await this._consumeStreamResponse(
      streamResponse,
      timeoutController,
      timeoutSignal,
      upstreamAbortSignal,
      resolveStreamIdleTimeoutMs(runtimeContext.config),
      onAbort,
      allowedFunctionNames,
    );

    return this._processDirectResponse(
      lastResponse,
      aggregatedText,
      runtimeContext.config,
      {
        contents: contentsForApi,
        tools:
          effectiveToolsFromConfig !== undefined &&
          effectiveToolsFromConfig.length > 0
            ? effectiveToolsFromConfig
            : undefined,
      },
      allowedFunctionNames,
    );
  }

  private _buildProviderRuntimeMetadata(
    params: SendMessageParameters,
    effectiveToolsFromConfig: ToolGroupArray | undefined,
  ): Record<string, unknown> {
    const directOverrides = this._extractDirectGeminiOverrides(params.config);
    return {
      toolCount: effectiveToolsFromConfig?.length ?? 0,
      ...(directOverrides ? { geminiDirectOverrides: directOverrides } : {}),
    };
  }

  private _createDirectProviderStream(
    provider: IProvider,
    contentsForApi: IContent[],
    effectiveToolsFromConfig: ToolGroupArray | undefined,
    runtimeContext: ProviderRuntimeContext,
    timeoutSignal: AbortSignal,
  ): AsyncIterable<IContent> {
    this.logger.debug(
      () =>
        '[DirectMessageProcessor] Calling provider.generateChatCompletion (non-stream retry path)',
      {
        providerName: provider.name,
        model: this.runtimeContext.state.model,
        toolCount: effectiveToolsFromConfig?.length ?? 0,
        baseUrl: this.runtimeContext.state.baseUrl,
      },
    );

    if (typeof provider.generateChatCompletion !== 'function') {
      throw new Error(
        `Provider ${provider.name} does not support IContent generation`,
      );
    }

    return provider.generateChatCompletion({
      contents: contentsForApi,
      tools:
        effectiveToolsFromConfig !== undefined &&
        effectiveToolsFromConfig.length > 0
          ? (effectiveToolsFromConfig as ProviderToolset)
          : undefined,
      config: runtimeContext.config,
      runtime: runtimeContext,
      invocation: {
        signal: timeoutSignal,
      } as unknown as GenerateChatOptions['invocation'],
      settings:
        runtimeContext.settingsService as GenerateChatOptions['settings'],
      metadata: runtimeContext.metadata,
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      userMemory: runtimeContext.config?.getUserMemory?.(),
    });
  }

  private _selectRequestTools(
    params: SendMessageParameters,
  ): GenerateContentConfig['tools'] {
    return params.config?.tools ?? this.generationConfig.tools;
  }

  /**
   * Applies pre-send hooks (BeforeToolSelection and BeforeModel).
   * Returns effective tools, modified contents, and optionally a synthetic response.
   */
  private async _applyPreSendHooks(
    params: SendMessageParameters,
    userIContents: IContent[],
  ): Promise<{
    effectiveToolsFromConfig: ToolGroupArray | undefined;
    contentsForApi: IContent[];
    syntheticResponse: GenerateContentResponse | undefined;
    allowedFunctionNames: string[] | undefined;
  }> {
    const requestTools = this._selectRequestTools(params);
    const toolsFromConfig = Array.isArray(requestTools)
      ? (requestTools as ToolGroupArray)
      : [];

    const configForHooks = this.runtimeContext.providerRuntime.config;
    let contentsForApi: IContent[] = userIContents;
    const toolSelection =
      configForHooks !== undefined
        ? await this._applyToolSelectionHook(configForHooks, toolsFromConfig)
        : { tools: toolsFromConfig, allowedFunctionNames: undefined };
    const effectiveToolsFromConfig = toolSelection.tools;

    if (configForHooks) {
      const hookResult = await this._handleBeforeModelHook(
        configForHooks,
        userIContents,
        effectiveToolsFromConfig,
      );
      if (hookResult.syntheticResponse) {
        return {
          effectiveToolsFromConfig,
          contentsForApi,
          syntheticResponse: hookResult.syntheticResponse,
          allowedFunctionNames: toolSelection.allowedFunctionNames,
        };
      }
      if (hookResult.modifiedContents) {
        contentsForApi = hookResult.modifiedContents;
      }
    }

    return {
      effectiveToolsFromConfig,
      contentsForApi,
      syntheticResponse: undefined,
      allowedFunctionNames: toolSelection.allowedFunctionNames,
    };
  }

  private async _applyToolSelectionHook(
    configForHooks: Config,
    toolsFromConfig: ToolGroupArray,
  ): Promise<ToolSelectionHookResult> {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    if (!configForHooks.getEnableHooks?.()) {
      return { tools: toolsFromConfig, allowedFunctionNames: undefined };
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    const hookSystem = configForHooks.getHookSystem?.();
    if (!hookSystem) {
      return { tools: toolsFromConfig, allowedFunctionNames: undefined };
    }
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
      if (Array.isArray(allowedFunctions)) {
        const allowedNames = new Set(
          allowedFunctions.map(canonicalizeToolName),
        );
        const filteredTools = toolsFromConfig
          .map((toolGroup) => ({
            ...toolGroup,
            functionDeclarations: toolGroup.functionDeclarations.filter((fn) =>
              allowedNames.has(canonicalizeToolName(fn.name)),
            ),
          }))
          .filter((g) => g.functionDeclarations.length > 0) as ToolGroupArray;
        return { tools: filteredTools, allowedFunctionNames: allowedFunctions };
      }
    }
    return { tools: toolsFromConfig, allowedFunctionNames: undefined };
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
    allowedFunctionNames?: string[],
  ): Promise<GenerateContentResponse> {
    let directResponse = this._applyHookRestrictedAllowedTools(
      convertIContentToResponse(lastResponse),
      allowedFunctionNames,
    );
    const automaticFunctionCallingHistory =
      lastResponse.metadata?.providerMetadata?.[
        'automaticFunctionCallingHistory'
      ];
    if (isContentArray(automaticFunctionCallingHistory)) {
      directResponse.automaticFunctionCallingHistory =
        filterHookRestrictedContents(
          automaticFunctionCallingHistory,
          allowedFunctionNames,
        ).filter((content) => (content.parts?.length ?? 0) > 0);
    }

    let afterModelModifiedResponse = false;

    // Trigger AfterModel hook
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
    if (config?.getEnableHooks?.() === true) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- BN4-C-P01: preserve defensive runtime boundary guard despite current static types.
      const hookSystem = config.getHookSystem?.();
      if (hookSystem) {
        await hookSystem.initialize();
        const filteredContent = filterHookRestrictedContent(
          directResponse.candidates?.[0]?.content ?? {
            role: 'model',
            parts: [],
          },
          allowedFunctionNames,
        );
        const afterModelResult = await hookSystem.fireAfterModelEvent(
          llmRequest ?? {},
          ContentConverters.toIContent(filteredContent),
        );
        if (afterModelResult) {
          const modifiedResponse = afterModelResult.getModifiedResponse();
          // eslint-disable-next-line sonarjs/nested-control-flow -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
          if (modifiedResponse) {
            directResponse = this._applyHookRestrictedAllowedTools(
              modifiedResponse,
              allowedFunctionNames,
            );
            afterModelModifiedResponse = true;
          }
        }
      }
    }

    const canAppendAggregatedText =
      aggregatedText.trim() !== '' && !afterModelModifiedResponse;

    // Ensure text content is included
    if (canAppendAggregatedText) {
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

  private _applyHookRestrictedAllowedTools(
    response: GenerateContentResponse,
    allowedFunctionNames: string[] | undefined,
  ): GenerateContentResponse {
    return attachHookRestrictedAllowedTools(response, allowedFunctionNames);
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
