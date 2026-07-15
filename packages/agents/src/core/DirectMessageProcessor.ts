/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentClientGenerateConfig } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { SendMessageParams } from './chatSession.js';
import { retryWithBackoff } from '@vybestack/llxprt-code-core/utils/retry.js';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type {
  RuntimeGenerateChatOptions as GenerateChatOptions,
  RuntimeProviderToolset as ProviderToolset,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { ModelOutput } from '@vybestack/llxprt-code-core/llm-types/index.js';
import {
  toModelStreamChunk,
  emptyModelOutput,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import { isProviderApiError } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { iContentFromBlocks } from '@vybestack/llxprt-code-core/llm-types/index.js';
import {
  normalizeToolInteractionInput,
  aggregateTextWithSpacing,
} from './MessageConverter.js';
import {
  resolveUserMemory,
  applyRequestModifications,
  extractSystemInstructionText,
} from './streamRequestHelpers.js';
import { isSchemaDepthError } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import {
  nextStreamEventWithIdleTimeout,
  resolveStreamIdleTimeoutMs,
} from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import type { HookSystem } from '@vybestack/llxprt-code-core/hooks/hookSystem.js';
import type { BeforeModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';

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
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  filterHookRestrictedBlocks,
  filterAfcByHookRestrictions,
} from './hookToolRestrictions.js';
import {
  afterModelModifiedToModelOutput,
  beforeModelBlockingToModelOutput,
} from './hookWireAdapter.js';
import { canonicalizeToolName } from './toolGovernance.js';
import { isTerminalRetryError } from './turnAbortHelpers.js';

/**
 * Reads the next chunk from the stream iterator, applying idle-timeout
 * watchdog when effectiveTimeoutMs > 0, or calling iterator.next() directly.
 */
async function readNextStreamChunk(
  iterator: AsyncIterator<IContent>,
  effectiveTimeoutMs: number,
  timeoutSignal: AbortSignal,
  upstreamAbortSignal: AbortSignal | undefined,
  timeoutController: AbortController,
): Promise<IteratorResult<IContent, unknown>> {
  if (effectiveTimeoutMs <= 0) {
    return iterator.next();
  }
  return nextStreamEventWithIdleTimeout({
    iterator,
    timeoutMs: effectiveTimeoutMs,
    signal: timeoutSignal,
    onTimeout: () => {
      if (upstreamAbortSignal?.aborted !== true) {
        timeoutController.abort();
      }
    },
    createTimeoutError: () => createAbortError(),
  });
}

/**
 * Boundary-validation helper: resolves whether hooks are enabled.
 * `Config.getEnableHooks()` is declared required, but test-doubles / partial
 * Configs may omit it, so validate `typeof === 'function'` (mirrors main's
 * optional-call `getEnableHooks?.()` short-circuit).
 */
function resolveHooksEnabled(config: Config | undefined): boolean {
  if (config && typeof config.getEnableHooks === 'function') {
    return config.getEnableHooks() === true;
  }
  return false;
}

/**
 * Boundary-validation helper: resolves the HookSystem instance.
 * `Config.getHookSystem()` is declared required, but test-doubles / partial
 * Configs may omit it, so validate `typeof === 'function'` (mirrors main's
 * optional-call `getHookSystem?.()` short-circuit).
 */
function resolveHookSystem(config: Config | undefined): HookSystem | undefined {
  if (config && typeof config.getHookSystem === 'function') {
    return config.getHookSystem();
  }
  return undefined;
}

/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-004.1
 * @pseudocode lines 20-22
 */
function buildBlockingModelOutput(
  beforeModelResult: BeforeModelHookOutput,
): ModelOutput {
  const reason =
    beforeModelResult.getEffectiveReason() ||
    'Request blocked by BeforeModel hook';
  return {
    content: {
      speaker: 'ai',
      blocks: [{ type: 'text', text: reason }],
    },
    finishReason: 'stop',
    rawStopReason: beforeModelResult.getEffectiveReason() || undefined,
  };
}

/**
 * Handles non-streaming direct message generation.
 * Extracted from ChatSession to separate concerns.
 *
 * @plan:PLAN-20260707-AGENTNEUTRAL.P13
 * @requirement:REQ-004.1
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
    private readonly generationConfig: AgentClientGenerateConfig,
    private readonly historyService: HistoryService,
  ) {}

  /**
   * @plan:PLAN-20260707-AGENTNEUTRAL.P13
   * @requirement:REQ-004.1
   * @pseudocode lines 10-19
   */
  async generateDirectMessage(
    params: SendMessageParams,
    prompt_id: string,
  ): Promise<ModelOutput> {
    const provider = this.providerResolver('DirectMessageProcessor');
    const providerRuntime: unknown = provider;
    if (providerRuntime === undefined || providerRuntime === null) {
      throw new Error('No active provider configured');
    }

    const userIContents = this._convertUserInput(params.message);

    // #2410: when the user message converts to zero IContent turns (e.g.
    // empty array), skip the provider call entirely — never submit a
    // fabricated placeholder to the provider.
    if (userIContents.length === 0) {
      return emptyModelOutput();
    }

    logApiRequest(
      this.runtimeContext,
      this.runtimeContext.state,
      userIContents,
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
        response.usage,
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
   * Converts user input message to IContent array, preserving turn boundaries
   * and stamping each turn with metadata.
   */
  private _convertUserInput(message: SendMessageParams['message']): IContent[] {
    const userContents = normalizeToolInteractionInput(message);
    return userContents.map((content) => {
      const turnKey = this.historyService.generateTurnKey();
      const idGen = this.historyService.getIdGeneratorCallback(turnKey);
      return {
        ...content,
        metadata: {
          ...(content.metadata ?? {}),
          id: idGen(),
          turnId: turnKey,
        },
      };
    });
  }

  /**
   * @plan:PLAN-20260707-AGENTNEUTRAL.P13
   * @requirement:REQ-004.1
   */
  private async _executeWithRetry(
    provider: IProvider,
    params: SendMessageParams,
    userIContents: IContent[],
  ): Promise<ModelOutput> {
    const requestParams: SendMessageParams = {
      ...params,
      config: {
        ...params.config,
        providerRequestContext: params.config?.providerRequestContext ?? {},
      },
    };
    return retryWithBackoff(
      async () =>
        this._executeDirectProviderCall(provider, requestParams, userIContents),
      {
        shouldRetryOnError: (error: unknown) => {
          if (isTerminalRetryError(error)) return false;
          if (isProviderApiError(error)) {
            const status = error.status ?? 0;
            if (status === 400 || isSchemaDepthError(error.message)) {
              return false;
            }
            return status === 429 || (status >= 500 && status < 600);
          }
          return false;
        },
        signal: params.config?.abortSignal,
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
      let nextResponse = await readNextStreamChunk(
        iterator,
        effectiveTimeoutMs,
        timeoutSignal,
        upstreamAbortSignal,
        timeoutController,
      );
      while (nextResponse.done !== true) {
        const iContent = nextResponse.value;
        const { filteredIContent, response } = this._filterStreamedIContent(
          iContent,
          allowedFunctionNames,
        );
        lastResponse = response;

        const result = aggregateTextWithSpacing(
          filteredIContent.blocks,
          aggregatedText,
          lastBlockWasNonText,
        );
        aggregatedText = result.text;
        lastBlockWasNonText = result.lastBlockWasNonText;
        nextResponse = await readNextStreamChunk(
          iterator,
          effectiveTimeoutMs,
          timeoutSignal,
          upstreamAbortSignal,
          timeoutController,
        );
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

  /**
   * Filters streamed IContent chunks for hook-restricted tool blocks.
   *
   * P13 AFC boundary: AFC extraction/stripping is handled by
   * `toModelStreamChunk` at the core conversion boundary, NOT here.
   *
   * @plan:PLAN-20260707-AGENTNEUTRAL.P13
   * @requirement:REQ-004.1
   */
  private _filterStreamedIContent(
    iContent: IContent,
    allowedFunctionNames: string[] | undefined,
  ): { filteredIContent: IContent; response: IContent } {
    const filteredBlocks = filterHookRestrictedBlocks(
      iContent.blocks,
      allowedFunctionNames,
    );
    const filteredIContent: IContent = {
      ...iContent,
      blocks: filteredBlocks,
    };
    return { filteredIContent, response: filteredIContent };
  }

  /**
   * @plan:PLAN-20260707-AGENTNEUTRAL.P13
   * @requirement:REQ-004.1
   * @pseudocode lines 10-19
   */
  private async _executeDirectProviderCall(
    provider: IProvider,
    params: SendMessageParams,
    userIContents: IContent[],
  ): Promise<ModelOutput> {
    const {
      effectiveToolsFromConfig,
      contentsForApi,
      blockedOutput,
      allowedFunctionNames,
    } = await this._applyPreSendHooks(params, userIContents);

    if (blockedOutput) {
      return blockedOutput;
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
      params.config?.providerRequestContext,
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
    params: SendMessageParams,
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
    requestContext: Record<string, unknown> | undefined,
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
      metadata: {
        ...runtimeContext.metadata,
        _retryRequestContext: requestContext,
      },
      userMemory: resolveUserMemory(runtimeContext.config),
      systemInstruction: extractSystemInstructionText(
        this.generationConfig.systemInstruction,
      ),
    });
  }

  private _selectRequestTools(
    params: SendMessageParams,
  ): AgentClientGenerateConfig['tools'] {
    return params.config?.tools ?? this.generationConfig.tools;
  }

  /**
   * @plan:PLAN-20260707-AGENTNEUTRAL.P13
   * @requirement:REQ-004.1
   */
  private async _applyPreSendHooks(
    params: SendMessageParams,
    userIContents: IContent[],
  ): Promise<{
    effectiveToolsFromConfig: ToolGroupArray | undefined;
    contentsForApi: IContent[];
    blockedOutput: ModelOutput | undefined;
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
      if (hookResult.blockedOutput) {
        return {
          effectiveToolsFromConfig,
          contentsForApi,
          blockedOutput: hookResult.blockedOutput,
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
      blockedOutput: undefined,
      allowedFunctionNames: toolSelection.allowedFunctionNames,
    };
  }

  private async _applyToolSelectionHook(
    configForHooks: Config,
    toolsFromConfig: ToolGroupArray,
  ): Promise<ToolSelectionHookResult> {
    if (!resolveHooksEnabled(configForHooks)) {
      return { tools: toolsFromConfig, allowedFunctionNames: undefined };
    }
    const hookSystem = resolveHookSystem(configForHooks);
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
   * @plan:PLAN-20260707-AGENTNEUTRAL.P13
   * @requirement:REQ-004.1
   * @pseudocode lines 20-22
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
    blockedOutput?: ModelOutput;
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
    if (resolveHooksEnabled(configForHooks)) {
      const hookSystem = resolveHookSystem(configForHooks);
      if (hookSystem) {
        await hookSystem.initialize();
        beforeModelResult =
          await hookSystem.fireBeforeModelEvent(requestForHook);
      }
    }

    if (beforeModelResult?.isBlockingDecision() === true) {
      return {
        blockedOutput: buildBlockingModelOutput(beforeModelResult),
      };
    }

    const syntheticFromHook = beforeModelResult?.getSyntheticResponse();
    if (syntheticFromHook) {
      return {
        blockedOutput: beforeModelBlockingToModelOutput(
          beforeModelResult?.getEffectiveReason() ?? undefined,
          syntheticFromHook,
        ),
      };
    }

    if (beforeModelResult) {
      const modifiedContents = this._applyHookRequestModifications(
        beforeModelResult,
        userIContents,
      );
      if (modifiedContents !== undefined) {
        return { modifiedContents };
      }
    }

    return {};
  }

  /**
   * Apply hook-supplied llm_request modifications to contents.
   *
   * H2: only round-trip through the translator when the hook actually supplied
   * replacement messages (hookProvidedMessages). A messages-less llm_request
   * (model/config only) must NOT trigger the text-only translator round-trip,
   * which would destroy tool calls, IDs, and metadata.
   *
   * Delegates to the shared `applyRequestModifications` helper
   * (streamRequestHelpers) so the guard semantics (empty-messages guard,
   * messages-less preservation, empty-array guard) cannot drift between the
   * stream and direct-message paths.
   *
   * Returns the modified IContent[] when the hook changed contents, or
   * undefined when no content modification occurred.
   */
  private _applyHookRequestModifications(
    beforeModelResult: BeforeModelHookOutput,
    userIContents: IContent[],
  ): IContent[] | undefined {
    const result = applyRequestModifications(
      beforeModelResult,
      userIContents,
      this.runtimeContext.state.model || '',
    );
    if (result === userIContents) {
      return undefined;
    }
    return result;
  }

  /**
   * @plan:PLAN-20260707-AGENTNEUTRAL.P13
   * @requirement:REQ-004.1
   * @pseudocode lines 25-30
   */
  private async _processDirectResponse(
    lastResponse: IContent,
    aggregatedText: string,
    config: Config | undefined,
    llmRequest?: Record<string, unknown>,
    allowedFunctionNames?: string[],
  ): Promise<ModelOutput> {
    const baseOutput = toModelStreamChunk(lastResponse);

    let directOutput: ModelOutput = {
      ...baseOutput,
      content: {
        ...baseOutput.content,
        blocks: filterHookRestrictedBlocks(
          baseOutput.content.blocks,
          allowedFunctionNames,
        ),
      },
    };

    // P13 AFC boundary: toModelStreamChunk already extracted AFC into
    // afcHistory and stripped it from providerMetadata. Apply hook-restriction
    // filtering to the first-class afcHistory field. No raw metadata access.
    if (directOutput.afcHistory !== undefined) {
      directOutput.afcHistory = filterAfcByHookRestrictions(
        directOutput.afcHistory,
        allowedFunctionNames,
      );
    }

    let afterModelModifiedResponse = false;
    let afterModelModifiedText = false;

    if (resolveHooksEnabled(config)) {
      const hookSystem = resolveHookSystem(config);
      if (hookSystem) {
        await hookSystem.initialize();
        const filteredBlocks = filterHookRestrictedBlocks(
          directOutput.content.blocks,
          allowedFunctionNames,
        );
        const filteredIContent = iContentFromBlocks(filteredBlocks, 'ai');
        const afterModelResult = await hookSystem.fireAfterModelEvent(
          llmRequest ?? {},
          filteredIContent,
        );
        if (afterModelResult) {
          const outcome = this._applyAfterModelResult(
            afterModelResult,
            directOutput,
            allowedFunctionNames,
          );
          directOutput = outcome.directOutput;
          afterModelModifiedResponse = outcome.responseModified;
          afterModelModifiedText = outcome.aggregatedText !== undefined;
          aggregatedText = outcome.aggregatedText ?? aggregatedText;
        }
      }
    }

    const canAppendAggregatedText =
      aggregatedText.trim() !== '' &&
      (!afterModelModifiedResponse || afterModelModifiedText);

    if (canAppendAggregatedText) {
      this._ensureResponseText(directOutput, aggregatedText);
    }

    return directOutput;
  }

  /**
   * @plan:PLAN-20260707-AGENTNEUTRAL.P13
   * @requirement:REQ-004.1
   * @pseudocode lines 25-30
   */
  private _applyAfterModelResult(
    afterModelResult: {
      getModifiedResponse(): unknown;
    },
    currentOutput: ModelOutput,
    allowedFunctionNames: string[] | undefined,
  ): {
    directOutput: ModelOutput;
    responseModified: boolean;
    aggregatedText: string | undefined;
  } {
    const modifiedResponse = afterModelResult.getModifiedResponse();
    if (modifiedResponse === undefined || modifiedResponse === null) {
      return {
        directOutput: currentOutput,
        responseModified: false,
        aggregatedText: undefined,
      };
    }
    const modifiedOutput = afterModelModifiedToModelOutput(
      modifiedResponse,
      currentOutput,
    );
    if (!modifiedOutput) {
      return {
        directOutput: currentOutput,
        responseModified: false,
        aggregatedText: undefined,
      };
    }
    const directOutput: ModelOutput = {
      ...modifiedOutput,
      content: {
        ...modifiedOutput.content,
        blocks: filterHookRestrictedBlocks(
          modifiedOutput.content.blocks,
          allowedFunctionNames,
        ),
      },
    };
    const modifiedText = this._extractResponseText(directOutput);
    const aggregatedText = modifiedText !== '' ? modifiedText : undefined;
    return { directOutput, responseModified: true, aggregatedText };
  }

  /**
   * Ensures the output's visible text equals the aggregated stream text.
   *
   * On the streaming direct path, the last IContent chunk only carries the
   * final fragment's text blocks. The aggregated text across ALL chunks is
   * the authoritative visible text (preserves the pre-P13 `.text`-getter
   * semantics that always returned the full aggregated text). Non-text
   * blocks (tool calls, thinking) are preserved; text blocks are replaced
   * with a single block carrying the aggregated text.
   *
   * @plan:PLAN-20260707-AGENTNEUTRAL.P13
   * @requirement:REQ-004.2
   * @pseudocode lines 31-36
   */
  private _ensureResponseText(output: ModelOutput, text: string): void {
    const blocks = output.content.blocks;
    const hasText = blocks.some((b) => b.type === 'text');
    if (hasText) {
      // Replace existing text blocks in-place, preserving the position of
      // the first text block and removing subsequent text blocks so the
      // aggregated text occupies the correct position in the interleaved
      // order.
      let textPlaced = false;
      output.content.blocks = blocks
        .filter((b) => {
          if (b.type === 'text') {
            if (!textPlaced) {
              textPlaced = true;
              return true;
            }
            return false;
          }
          return true;
        })
        .map((b) => (b.type === 'text' ? { type: 'text' as const, text } : b));
    } else {
      // No text block present — append at end, preserving all existing blocks.
      output.content.blocks = [...blocks, { type: 'text' as const, text }];
    }
  }

  /**
   * Concatenates visible (non-thought) text from the output's content
   * blocks WITHOUT trimming — preserves the pre-P13 getResponseTextFromParts
   * semantics (exact text join, no whitespace stripping) so hook-modified
   * text with leading/trailing whitespace survives to the aggregated text.
   *
   * @plan:PLAN-20260707-AGENTNEUTRAL.P13
   * @requirement:REQ-004.2
   * @pseudocode lines 31-36
   */
  private _extractResponseText(output: ModelOutput): string {
    return output.content.blocks
      .filter(
        (block) =>
          block.type === 'text' &&
          typeof block.text === 'string' &&
          block.text !== '',
      )
      .map((block) => (block as { text: string }).text)
      .join('');
  }

  /**
   * Extracts direct Gemini overrides from config.
   */
  private _extractDirectGeminiOverrides(config?: AgentClientGenerateConfig):
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
