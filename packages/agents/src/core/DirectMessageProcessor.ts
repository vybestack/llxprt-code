/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';
import { bindProviderMediaAndFiles } from '@vybestack/llxprt-code-core/runtime/bindProviderMediaAndFiles.js';
import type { AgentClientGenerateConfig } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { AgentChatRecordingExecution } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ChatSessionConfig, SendMessageParams } from './chatSession.js';
import { retryWithBackoff } from '@vybestack/llxprt-code-core/utils/retry.js';
import { createAbortError } from '@vybestack/llxprt-code-core/utils/delay.js';
import type {
  IContent,
  ContentMetadata,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ProviderRequestCollaborators } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  ModelOutput,
  ToolChoice,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
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
  applyRequestModifications,
  extractSystemInstructionText,
} from './streamRequestHelpers.js';
import { isSchemaDepthError } from '@vybestack/llxprt-code-core/core/chatSessionTypes.js';
import {
  nextStreamEventWithIdleTimeout,
  resolveStreamIdleTimeoutMs,
} from '@vybestack/llxprt-code-core/utils/streamIdleTimeout.js';
import type { BeforeModelHookOutput } from '@vybestack/llxprt-code-core/hooks/types.js';
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import type { HookLLMResponse } from '@vybestack/llxprt-code-core/hooks/hookTranslator.js';

interface ToolSelectionHookResult {
  tools: ToolDeclaration[] | undefined;
  allowedFunctionNames: string[] | undefined;
}

import { logApiRequest, logApiResponse, logApiError } from './turnLogging.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  filterHookRestrictedBlocks,
  filterAfcByHookRestrictions,
} from './hookToolRestrictions.js';
import {
  afterModelModifiedToChunk,
  beforeModelBlockingToModelOutput,
} from './hookWireAdapter.js';
import {
  afterModelRequestEnvelope,
  afterModelResponseEnvelope,
  beforeModelRequestEnvelope,
  toolSelectionRequest,
} from './hookEnvelopeHelpers.js';
import { canonicalizeToolName } from './toolGovernance.js';
import { isTerminalRetryError } from './turnAbortHelpers.js';
import {
  ensureResponseText,
  extractResponseText,
} from './directResponseText.js';

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

  rebindHistory(runtimeContext: AgentRuntimeContext): void {
    this.runtimeContext = runtimeContext;
    this.historyService = runtimeContext.history;
  }

  constructor(
    private runtimeContext: AgentRuntimeContext,
    private readonly providerResolver: (contextLabel: string) => IProvider,
    private readonly providerRuntimeBuilder: (
      source: string,
      extras?: Record<string, unknown>,
    ) => ProviderRequestCollaborators,
    private readonly generationConfig: ChatSessionConfig,
    private historyService: HistoryService,
    private readonly retry: typeof retryWithBackoff = retryWithBackoff,
  ) {}

  /**
   * @plan:PLAN-20260707-AGENTNEUTRAL.P13
   * @requirement:REQ-004.1
   * @pseudocode lines 10-19
   */
  async generateDirectMessage(
    params: SendMessageParams,
    prompt_id: string,
    execution?: AgentChatRecordingExecution,
  ): Promise<ModelOutput> {
    const provider = this.providerResolver('DirectMessageProcessor');
    const providerRuntime: unknown = provider;
    if (providerRuntime === undefined || providerRuntime === null) {
      throw new Error('No active provider configured');
    }

    const convertedUserContents = this._convertUserInput(
      params.message,
      prompt_id,
    );
    const userIContents =
      this.runtimeContext.mediaAdmission === undefined
        ? convertedUserContents
        : await this.runtimeContext.mediaAdmission.admitContents(
            convertedUserContents,
            { turnId: prompt_id, source: 'direct-user-input' },
          );

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
        params.hookOwner ?? execution?.hookOwner,
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
  private _convertUserInput(
    message: SendMessageParams['message'],
    promptId?: string,
  ): IContent[] {
    const userContents = normalizeToolInteractionInput(message);
    return userContents.map((content) => {
      const turnKey = this.historyService.generateTurnKey();
      const idGen = this.historyService.getIdGeneratorCallback(turnKey);
      const metadata: ContentMetadata = {
        ...(content.metadata ?? {}),
        id: idGen(),
        turnId: turnKey,
      };
      if (promptId !== undefined && promptId.length > 0) {
        metadata.promptId = promptId;
      }
      return {
        ...content,
        metadata,
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
    owner?: HookExecutionOwner,
  ): Promise<ModelOutput> {
    const requestParams: SendMessageParams = {
      ...params,
      config: {
        ...params.config,
        providerRequestContext: params.config?.providerRequestContext ?? {},
      },
    };
    return this.retry(
      async () =>
        this._executeDirectProviderCall(
          provider,
          requestParams,
          userIContents,
          owner,
        ),
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
    owner?: HookExecutionOwner,
  ): Promise<ModelOutput> {
    params.config?.abortSignal?.throwIfAborted();
    const {
      effectiveToolsFromConfig,
      contentsForApi,
      blockedOutput,
      allowedFunctionNames,
    } = await this._applyPreSendHooks(params, userIContents, owner);

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
      resolveStreamIdleTimeoutMs(this.runtimeContext.readStreamTimeoutPolicy()),
      onAbort,
      allowedFunctionNames,
    );

    return this._processDirectResponse(
      lastResponse,
      aggregatedText,
      {
        contents: contentsForApi,
        tools: effectiveToolsFromConfig,
      },
      allowedFunctionNames,
      owner,
    );
  }

  private _buildProviderRuntimeMetadata(
    params: SendMessageParams,
    effectiveToolsFromConfig: ToolDeclaration[] | undefined,
  ): Record<string, unknown> {
    const directOverrides = this._extractDirectProviderOverrides(params.config);
    return {
      toolCount: effectiveToolsFromConfig?.length ?? 0,
      ...(directOverrides ? { geminiDirectOverrides: directOverrides } : {}),
    };
  }

  private _createDirectProviderStream(
    provider: IProvider,
    contentsForApi: IContent[],
    effectiveToolsFromConfig: ToolDeclaration[] | undefined,
    runtimeContext: ProviderRequestCollaborators,
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

    return bindProviderMediaAndFiles(
      provider,
      runtimeContext.mediaResolver,
      runtimeContext.requestMediaBudgetBytes,
      runtimeContext.providerFileBindings,
      runtimeContext.providerFileLifecycle,
      runtimeContext.config?.getTargetDir(),
    ).generateChatCompletion({
      contents: contentsForApi,
      tools: effectiveToolsFromConfig,
      invocation: this.runtimeContext.prepareProviderInvocation(
        provider.name,
        undefined,
        timeoutSignal,
      ),
      metadata: {
        ...runtimeContext.metadata,
        _retryRequestContext: requestContext,
      },
      systemInstruction: extractSystemInstructionText(
        this.generationConfig.systemInstruction,
      ),
      systemPromptAssembler: this.generationConfig.systemPromptAssembler,
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
    owner?: HookExecutionOwner,
  ): Promise<{
    effectiveToolsFromConfig: ToolDeclaration[] | undefined;
    contentsForApi: IContent[];
    blockedOutput: ModelOutput | undefined;
    allowedFunctionNames: string[] | undefined;
  }> {
    const requestTools = this._selectRequestTools(params);
    const toolsFromConfig = Array.isArray(requestTools) ? requestTools : [];

    const configForHooks = this.runtimeContext.providerRuntime.config;
    let contentsForApi: IContent[] = userIContents;
    const toolSelection =
      configForHooks !== undefined
        ? await this._applyToolSelectionHook(toolsFromConfig, owner)
        : { tools: toolsFromConfig, allowedFunctionNames: undefined };
    const effectiveToolsFromConfig =
      requestTools === undefined ||
      (toolSelection.allowedFunctionNames !== undefined &&
        toolSelection.tools?.length === 0)
        ? undefined
        : toolSelection.tools;

    if (configForHooks) {
      const hookResult = await this._handleBeforeModelHook(
        userIContents,
        effectiveToolsFromConfig,
        owner,
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
    toolsFromConfig: ToolDeclaration[],
    owner?: HookExecutionOwner,
  ): Promise<ToolSelectionHookResult> {
    if (owner?.beforeToolSelection === undefined)
      return { tools: toolsFromConfig, allowedFunctionNames: undefined };
    const toolSelectionResult = await owner.beforeToolSelection(
      toolSelectionRequest(this.runtimeContext.state.model, toolsFromConfig),
      owner.signal,
    );
    const modifiedConfig = toolSelectionResult?.applyToolChoiceModifications({
      tools: toolsFromConfig,
    });

    const toolChoice: ToolChoice | undefined = modifiedConfig?.toolChoice;
    if (toolChoice?.mode === 'none') {
      return { tools: [], allowedFunctionNames: [] };
    }
    if (
      toolChoice &&
      'allowedToolNames' in toolChoice &&
      Array.isArray(toolChoice.allowedToolNames)
    ) {
      const allowedFunctions = toolChoice.allowedToolNames;
      const allowedNames = new Set(allowedFunctions.map(canonicalizeToolName));
      const filteredTools = toolsFromConfig.filter((decl) =>
        allowedNames.has(canonicalizeToolName(decl.name)),
      );
      return { tools: filteredTools, allowedFunctionNames: allowedFunctions };
    }
    return { tools: toolsFromConfig, allowedFunctionNames: undefined };
  }

  /**
   * @plan:PLAN-20260707-AGENTNEUTRAL.P13
   * @requirement:REQ-004.1
   * @pseudocode lines 20-22
   */
  private async _handleBeforeModelHook(
    userIContents: IContent[],
    effectiveToolsFromConfig: ToolDeclaration[] | undefined,
    owner?: HookExecutionOwner,
  ): Promise<{
    blockedOutput?: ModelOutput;
    modifiedContents?: IContent[];
  }> {
    const requestForHook = beforeModelRequestEnvelope(
      this.runtimeContext.state.model,
      userIContents,
      effectiveToolsFromConfig,
    );

    const beforeModelResult = await owner?.beforeModel?.(
      requestForHook,
      owner.signal,
    );

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
   * H2: only merge when the hook actually supplied replacement contents
   * (hookProvidedContents). A contents-less llm_request (model/settings only)
   * must preserve the original contents reference.
   *
   * Delegates to the shared `applyRequestModifications` helper
   * (streamRequestHelpers) so the guard semantics (contents-less
   * preservation, empty-array guard) cannot drift between the stream and
   * direct-message paths.
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
    llmRequest?: { contents: IContent[]; tools?: ToolDeclaration[] },
    allowedFunctionNames?: string[],
    owner?: HookExecutionOwner,
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

    const afterModel = await this._fireAfterModelAndApply(
      directOutput,
      llmRequest,
      allowedFunctionNames,
      owner,
    );
    directOutput = afterModel.directOutput;
    aggregatedText = afterModel.aggregatedText ?? aggregatedText;

    const canAppendAggregatedText =
      aggregatedText.trim() !== '' &&
      (!afterModel.responseModified || afterModel.aggregatedText !== undefined);

    if (canAppendAggregatedText) {
      ensureResponseText(directOutput, aggregatedText);
    }

    return directOutput;
  }

  /**
   * Fire the AfterModel hook (when enabled) and apply its decision to the
   * direct-path output. Extracted from _processDirectResponse so the
   * response-assembly flow stays readable.
   *
   * @plan:PLAN-20260707-AGENTNEUTRAL.P13
   * @requirement:REQ-004.1
   */
  private async _fireAfterModelAndApply(
    directOutput: ModelOutput,
    llmRequest: { contents: IContent[]; tools?: ToolDeclaration[] } | undefined,
    allowedFunctionNames: string[] | undefined,
    owner?: HookExecutionOwner,
  ): Promise<{
    directOutput: ModelOutput;
    responseModified: boolean;
    aggregatedText: string | undefined;
  }> {
    if (owner?.afterModel === undefined)
      return {
        directOutput,
        responseModified: false,
        aggregatedText: undefined,
      };
    const filteredBlocks = filterHookRestrictedBlocks(
      directOutput.content.blocks,
      allowedFunctionNames,
    );
    const filteredIContent = iContentFromBlocks(filteredBlocks, 'ai');
    const afterModelResult = await owner.afterModel(
      afterModelRequestEnvelope(
        this.runtimeContext.state.model,
        llmRequest?.contents,
        llmRequest?.tools,
      ),
      afterModelResponseEnvelope(filteredIContent, directOutput),
      owner.signal,
    );
    if (!afterModelResult) {
      return {
        directOutput,
        responseModified: false,
        aggregatedText: undefined,
      };
    }
    return this._applyAfterModelResult(
      afterModelResult,
      directOutput,
      allowedFunctionNames,
    );
  }

  /**
   * @plan:PLAN-20260707-AGENTNEUTRAL.P13
   * @requirement:REQ-004.1
   * @pseudocode lines 25-30
   */
  private _applyAfterModelResult(
    afterModelResult: {
      getModifiedResponse(): HookLLMResponse | undefined;
    },
    currentOutput: ModelOutput,
    allowedFunctionNames: string[] | undefined,
  ): {
    directOutput: ModelOutput;
    responseModified: boolean;
    aggregatedText: string | undefined;
  } {
    const modifiedResponse = afterModelResult.getModifiedResponse();
    if (modifiedResponse === undefined) {
      return {
        directOutput: currentOutput,
        responseModified: false,
        aggregatedText: undefined,
      };
    }
    const modifiedOutput = afterModelModifiedToChunk(
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
    const modifiedText = extractResponseText(directOutput);
    const aggregatedText = modifiedText !== '' ? modifiedText : undefined;
    return { directOutput, responseModified: true, aggregatedText };
  }

  /**
   * Extracts direct provider overrides from config. The returned value is
   * stamped onto the request metadata under the `geminiDirectOverrides` key,
   * which the Gemini provider request builder reads by that exact name.
   */
  private _extractDirectProviderOverrides(config?: AgentClientGenerateConfig):
    | {
        toolConfig?: unknown;
      }
    | undefined {
    if (!config) {
      return undefined;
    }

    const overrides: {
      toolConfig?: unknown;
    } = {};

    const rawConfig = config as Record<string, unknown>;
    if ('toolConfig' in rawConfig) {
      overrides.toolConfig = rawConfig.toolConfig;
    }

    return Object.keys(overrides).length > 0 ? overrides : undefined;
  }
}
