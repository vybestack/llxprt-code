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

import { SyntheticToolResponseHandler } from '../openai/syntheticToolResponses.js';
import type { IContent } from '../../services/history/IContent.js';
import type { ToolOutputSettingsProvider } from '../../utils/toolOutputLimiter.js';
import {
  parseResponsesStream,
  parseErrorResponse,
  type ParseResponsesStreamOptions,
} from '../openai/parseResponsesStream.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { convertToolsToOpenAIResponses } from './schemaConverter.js';
import { getCoreSystemPromptAsync } from '../../core/prompts.js';
import { shouldIncludeSubagentDelegation } from '../../prompt-config/subagent-delegation.js';
import { resolveUserMemory } from '../utils/userMemory.js';
import { resolveRuntimeAuthToken } from '../utils/authToken.js';
import { isNetworkTransientError } from '../../utils/retry.js';
import { delay } from '../../utils/delay.js';
import { OpenAIResponsesProviderBase } from './OpenAIResponsesProviderBase.js';
import { buildOpenAIResponsesInput } from './OpenAIResponsesInputBuilder.js';
import type {
  OpenAIResponsesRequest,
  ResponsesInputItem,
} from './OpenAIResponsesTypes.js';

interface RequestContext {
  apiKey: string;
  baseURL: string;
  isCodex: boolean;
  includeThinkingInResponse: boolean;
  request: OpenAIResponsesRequest;
}

interface ReasoningOptions {
  enabled: boolean;
  effort?: string;
  summary?: string;
  includeThinkingInResponse: boolean;
}

export class OpenAIResponsesProvider extends OpenAIResponsesProviderBase {
  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const metadata = (options as { metadata?: Record<string, unknown> })
      .metadata;
    const abortSignal = metadata?.['abortSignal'] as AbortSignal | undefined;
    const patchedContent = SyntheticToolResponseHandler.patchMessageHistory(
      options.contents,
    );
    const invocation = options.invocation as {
      ephemerals?: Record<string, unknown>;
    };
    const invocationEphemerals = invocation.ephemerals ?? {};
    const requestContext = await this.buildRequestContext(
      options,
      patchedContent,
      invocationEphemerals,
    );

    yield* this.streamResponses({
      ...requestContext,
      abortSignal,
      maxStreamingAttempts:
        (invocationEphemerals['retries'] as number | undefined) ?? 6,
      streamRetryInitialDelayMs:
        (invocationEphemerals['retrywait'] as number | undefined) ?? 4000,
      normalizedOptions: options,
    });
  }

  private async buildRequestContext(
    options: NormalizedGenerateChatOptions,
    patchedContent: IContent[],
    invocationEphemerals: Record<string, unknown>,
  ): Promise<RequestContext> {
    const apiKey = await this.resolveApiKey(options);
    const baseURL = this.normalizeBaseURL(
      options.resolved.baseURL ??
        this.getBaseURL() ??
        'https://api.openai.com/v1',
    );
    const isCodex = this.isCodexMode(baseURL);
    const userMemory = await resolveUserMemory(
      options.userMemory,
      () => options.invocation.userMemory,
    );
    const systemPrompt = await this.buildSystemPrompt(options, userMemory);
    const input = this.buildInput(
      options,
      patchedContent,
      invocationEphemerals,
    );
    const requestOverrides = this.buildRequestOverrides(options);
    const requestInput = this.buildRequestInput(
      input,
      isCodex,
      options,
      userMemory,
    );
    const request = this.createRequest(options, requestInput, requestOverrides);
    this.applyInstructionsAndTools(request, systemPrompt, options);
    const reasoning = this.applyReasoningSettings(
      request,
      options,
      invocationEphemerals,
    );
    this.applyTextVerbosity(request, options, invocationEphemerals);
    this.applyCodexRequestSettings(request, isCodex);
    this.applyPromptCaching(request, options, invocationEphemerals, isCodex);
    return {
      apiKey,
      baseURL,
      isCodex,
      request,
      includeThinkingInResponse: reasoning.includeThinkingInResponse,
    };
  }

  private async resolveApiKey(
    options: NormalizedGenerateChatOptions,
  ): Promise<string> {
    const promptAuthToken = (await this.getAuthTokenForPrompt()) as
      | string
      | undefined;
    const apiKey =
      promptAuthToken ??
      (await resolveRuntimeAuthToken(options.resolved.authToken)) ??
      '';
    if (apiKey) return apiKey;

    throw new Error(
      this._isCodexMode
        ? 'Codex authentication required. Run /auth codex enable to authenticate.'
        : 'OpenAI API key is required',
    );
  }

  private async buildSystemPrompt(
    options: NormalizedGenerateChatOptions,
    userMemory: string | undefined,
  ): Promise<string> {
    const toolNames = this.getToolNamesForPrompt(options);
    const configWithManagers = options.config as
      | {
          getMcpClientManager?: () =>
            | { getMcpInstructions?: () => string | undefined }
            | undefined;
          getSubagentManager?: () => ReturnType<
            NonNullable<typeof options.config>['getSubagentManager']
          >;
        }
      | undefined;
    const mcpClientManager = configWithManagers?.getMcpClientManager?.();
    const mcpInstructions = mcpClientManager?.getMcpInstructions?.();
    const includeSubagentDelegation = await shouldIncludeSubagentDelegation(
      toolNames ?? [],
      () => configWithManagers?.getSubagentManager?.(),
    );
    return getCoreSystemPromptAsync({
      userMemory,
      mcpInstructions,
      model: options.resolved.model || this.getDefaultModel(),
      tools: toolNames,
      includeSubagentDelegation,
      interactionMode:
        options.config?.isInteractive() === true
          ? 'interactive'
          : 'non-interactive',
    });
  }

  private getToolNamesForPrompt(
    options: NormalizedGenerateChatOptions,
  ): string[] | undefined {
    if (options.tools === undefined) return undefined;

    return Array.from(
      new Set(
        options.tools.flatMap((group) =>
          group.functionDeclarations
            .map((declaration) => declaration.name)
            .filter((name): name is string => Boolean(name)),
        ),
      ),
    );
  }

  private buildInput(
    options: NormalizedGenerateChatOptions,
    patchedContent: IContent[],
    invocationEphemerals: Record<string, unknown>,
  ): ResponsesInputItem[] {
    const includeReasoningInContextSetting =
      (invocationEphemerals['reasoning.includeInContext'] as
        | boolean
        | undefined) ??
      options.invocation.getModelBehavior<boolean>(
        'reasoning.includeInContext',
      ) ??
      (
        options as { settings?: { get: (key: string) => unknown } }
      ).settings?.get('reasoning.includeInContext');
    const outputLimiterConfig =
      options.config ??
      options.runtime?.config ??
      this.globalConfig ??
      ({
        getEphemeralSettings: () => ({}),
      } satisfies ToolOutputSettingsProvider);
    return buildOpenAIResponsesInput(patchedContent, {
      includeReasoningInContext: includeReasoningInContextSetting !== false,
      outputLimiterConfig,
      debug: (messageFactory) => this.logger.debug(messageFactory),
    });
  }

  private buildRequestOverrides(
    options: NormalizedGenerateChatOptions,
  ): Record<string, unknown> {
    const mergedParams: Record<string, unknown> = {
      ...options.invocation.modelParams,
    };
    const genericMaxOutput = this.getGenericMaxOutput(options);
    if (
      genericMaxOutput !== undefined &&
      mergedParams['max_tokens'] === undefined &&
      mergedParams['max_completion_tokens'] === undefined &&
      mergedParams['max_output_tokens'] === undefined
    ) {
      mergedParams['max_output_tokens'] = genericMaxOutput;
    }

    const requestOverrides = this.translateRequestOverrides(mergedParams);
    this.logger.debug(
      () =>
        `Request overrides: ${JSON.stringify(Object.keys(requestOverrides))}`,
    );
    return requestOverrides;
  }

  private getGenericMaxOutput(
    options: NormalizedGenerateChatOptions,
  ): number | undefined {
    const rawMaxOutput = (
      options as { settings?: { get: (key: string) => unknown } }
    ).settings?.get('maxOutputTokens');
    return typeof rawMaxOutput === 'number' &&
      Number.isFinite(rawMaxOutput) &&
      rawMaxOutput > 0
      ? rawMaxOutput
      : undefined;
  }

  private translateRequestOverrides(
    mergedParams: Record<string, unknown>,
  ): Record<string, unknown> {
    const requestOverrides: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(mergedParams)) {
      if (key === 'max_tokens' || key === 'max_completion_tokens') {
        requestOverrides['max_output_tokens'] = value;
        this.logger.debug(
          () =>
            `Translated ${key}=${value} to max_output_tokens for Responses API`,
        );
      } else if (key === 'reasoning') {
        this.logger.debug(
          () =>
            `Skipping reasoning object in modelParams - handled via model-behavior settings`,
        );
      } else {
        requestOverrides[key] = value;
      }
    }
    return requestOverrides;
  }

  private normalizeBaseURL(baseURLCandidate: string): string {
    let baseURL = baseURLCandidate;
    while (baseURL.endsWith('/')) baseURL = baseURL.slice(0, -1);
    return baseURL;
  }

  private buildRequestInput(
    input: ResponsesInputItem[],
    isCodex: boolean,
    options: NormalizedGenerateChatOptions,
    userMemory: string | undefined,
  ): ResponsesInputItem[] {
    if (!isCodex) return input;

    const requestInput = input.filter(
      (message) =>
        !('role' in message) || (message.role as string) !== 'system',
    );
    const itemsForInjection = requestInput.filter(
      (item) => !('type' in item && item.type === 'reasoning'),
    );
    this.injectSyntheticConfigFileRead(itemsForInjection, options, userMemory);
    const injectedItems = itemsForInjection.filter(
      (item) => !requestInput.includes(item),
    );
    const reasoningItems = requestInput.filter(
      (item) => 'type' in item && item.type === 'reasoning',
    );
    const nonReasoningItems = requestInput.filter(
      (item) => !('type' in item && item.type === 'reasoning'),
    );
    return [...injectedItems, ...reasoningItems, ...nonReasoningItems];
  }

  private createRequest(
    options: NormalizedGenerateChatOptions,
    input: ResponsesInputItem[],
    requestOverrides: Record<string, unknown>,
  ): OpenAIResponsesRequest {
    return {
      model: options.resolved.model || this.getDefaultModel(),
      input,
      stream: true,
      ...requestOverrides,
    };
  }

  private applyInstructionsAndTools(
    request: OpenAIResponsesRequest,
    systemPrompt: string,
    options: NormalizedGenerateChatOptions,
  ): void {
    if (systemPrompt) request.instructions = systemPrompt;

    const responsesTools = convertToolsToOpenAIResponses(options.tools);
    if (responsesTools === undefined || responsesTools.length === 0) return;

    request.tools = responsesTools;
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Preserve original falsy defaulting for request overrides such as an empty tool_choice string.
    if (!request.tool_choice) request.tool_choice = 'auto';
    request.parallel_tool_calls = true;
  }

  private applyReasoningSettings(
    request: OpenAIResponsesRequest,
    options: NormalizedGenerateChatOptions,
    invocationEphemerals: Record<string, unknown>,
  ): ReasoningOptions {
    const reasoning = this.getReasoningOptions(options, invocationEphemerals);
    const shouldRequestReasoning =
      reasoning.enabled || reasoning.effort !== undefined;
    this.logger.debug(
      () =>
        `Reasoning check: enabled=${reasoning.enabled}, effort=${String(reasoning.effort)}, summary=${String(reasoning.summary)}, shouldRequest=${shouldRequestReasoning}, includeInResponse=${reasoning.includeThinkingInResponse}`,
    );
    if (shouldRequestReasoning) {
      request.include = ['reasoning.encrypted_content'];
      this.logger.debug(
        () => `Added include parameter: ${JSON.stringify(request.include)}`,
      );
      this.applyReasoningEffort(request, reasoning.effort);
    }
    this.applyReasoningSummary(request, reasoning.summary);
    this.logger.debug(
      () =>
        `Full request reasoning config: ${JSON.stringify(request.reasoning)}`,
    );
    return reasoning;
  }

  private getReasoningOptions(
    options: NormalizedGenerateChatOptions,
    ephemerals: Record<string, unknown>,
  ): ReasoningOptions {
    const settings = (
      options as { settings?: { get: (key: string) => unknown } }
    ).settings;
    const enabled =
      ((ephemerals['reasoning.enabled'] as boolean | undefined) ??
        options.invocation.getModelBehavior<boolean>('reasoning.enabled') ??
        settings?.get('reasoning.enabled')) === true;
    const effort =
      (ephemerals['reasoning.effort'] as string | undefined) ??
      options.invocation.getModelBehavior<string>('reasoning.effort') ??
      (settings?.get('reasoning.effort') as string | undefined);
    const summary =
      (ephemerals['reasoning.summary'] as string | undefined) ??
      options.invocation.getModelBehavior<string>('reasoning.summary') ??
      (settings?.get('reasoning.summary') as string | undefined);
    const includeSetting =
      (ephemerals['reasoning.includeInResponse'] as boolean | undefined) ??
      options.invocation.getModelBehavior<boolean>(
        'reasoning.includeInResponse',
      ) ??
      settings?.get('reasoning.includeInResponse');
    return {
      enabled,
      effort,
      summary,
      includeThinkingInResponse: includeSetting !== false,
    };
  }

  private applyReasoningEffort(
    request: OpenAIResponsesRequest,
    reasoningEffort: string | undefined,
  ): void {
    if (typeof reasoningEffort !== 'string' || reasoningEffort === '') return;
    request.reasoning ??= {};
    request.reasoning.effort = reasoningEffort;
    this.logger.debug(
      () => `Added reasoning.effort to request: ${reasoningEffort}`,
    );
  }

  private applyReasoningSummary(
    request: OpenAIResponsesRequest,
    reasoningSummary: string | undefined,
  ): void {
    if (
      typeof reasoningSummary !== 'string' ||
      reasoningSummary === '' ||
      reasoningSummary === 'none'
    ) {
      return;
    }
    request.reasoning ??= {};
    request.reasoning.summary = reasoningSummary;
    this.logger.debug(
      () => `Added reasoning.summary to request: ${reasoningSummary}`,
    );
  }

  private applyTextVerbosity(
    request: OpenAIResponsesRequest,
    options: NormalizedGenerateChatOptions,
    ephemerals: Record<string, unknown>,
  ): void {
    const textVerbosity =
      (ephemerals['text.verbosity'] as string | undefined) ??
      (
        options as { settings?: { get: (key: string) => unknown } }
      ).settings?.get('text.verbosity');
    if (
      typeof textVerbosity !== 'string' ||
      textVerbosity === '' ||
      !['low', 'medium', 'high'].includes(textVerbosity.toLowerCase())
    ) {
      return;
    }
    request.text = { verbosity: textVerbosity.toLowerCase() };
    this.logger.debug(
      () => `Added text.verbosity to request: ${textVerbosity}`,
    );
  }

  private applyCodexRequestSettings(
    request: OpenAIResponsesRequest,
    isCodex: boolean,
  ): void {
    if (!isCodex) return;

    request.store = false;
    if ('max_output_tokens' in request) {
      delete request.max_output_tokens;
      this.logger.debug(
        () => 'Codex mode: removed unsupported max_output_tokens from request',
      );
    }
  }

  private applyPromptCaching(
    request: OpenAIResponsesRequest,
    options: NormalizedGenerateChatOptions,
    ephemerals: Record<string, unknown>,
    isCodex: boolean,
  ): void {
    const promptCachingSetting =
      (ephemerals['prompt-caching'] as string | undefined) ??
      ((
        options as {
          settings?: {
            getProviderSettings: (name: string) => Record<string, unknown>;
          };
        }
      ).settings?.getProviderSettings(this.name)['prompt-caching'] as
        | string
        | undefined) ??
      '1h';
    if (promptCachingSetting === 'off') return;

    const cacheKey =
      (options.invocation as { runtimeId?: string } | undefined)?.runtimeId ??
      options.runtime?.runtimeId;
    if (typeof cacheKey !== 'string' || cacheKey.trim() === '') return;

    request.prompt_cache_key = cacheKey;
    if (!isCodex) request.prompt_cache_retention = '24h';
  }

  private async buildHeaders(
    apiKey: string,
    contentType: string,
    isCodex: boolean,
    options: NormalizedGenerateChatOptions,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': contentType,
      ...(this.getCustomHeaders() ?? {}),
    };
    if (isCodex) await this.addCodexHeaders(headers, options);
    return headers;
  }

  private async addCodexHeaders(
    headers: Record<string, string>,
    options: NormalizedGenerateChatOptions,
  ): Promise<void> {
    const accountId = await this.getCodexAccountId();
    headers['ChatGPT-Account-ID'] = accountId;
    headers['originator'] = 'codex_cli_rs';

    const sessionId =
      (options.invocation as { runtimeId?: string } | undefined)?.runtimeId ??
      options.runtime?.runtimeId;
    if (typeof sessionId === 'string' && sessionId.trim()) {
      headers['session_id'] = sessionId;
    }

    const sessionIdForLog = sessionId?.substring(0, 8) ?? 'none';
    this.logger.debug(
      () =>
        `Codex mode: adding headers for account ${accountId.substring(0, 8)}..., session_id=${sessionIdForLog}...`,
    );
  }

  private async *streamResponses(options: {
    apiKey: string;
    baseURL: string;
    isCodex: boolean;
    request: OpenAIResponsesRequest;
    includeThinkingInResponse: boolean;
    abortSignal?: AbortSignal;
    maxStreamingAttempts: number;
    streamRetryInitialDelayMs: number;
    normalizedOptions: NormalizedGenerateChatOptions;
  }): AsyncIterableIterator<IContent> {
    const contentType = options.isCodex
      ? 'application/json'
      : 'application/json; charset=utf-8';
    const bodyBlob = new Blob([JSON.stringify(options.request)], {
      type: contentType,
    });
    const headers = await this.buildHeaders(
      options.apiKey,
      contentType,
      options.isCodex,
      options.normalizedOptions,
    );
    this.logger.debug(
      () =>
        `Request body keys: ${JSON.stringify(Object.keys(options.request))}`,
    );
    yield* this.fetchStreamWithRetries({
      ...options,
      responsesURL: `${options.baseURL}/responses`,
      headers,
      bodyBlob,
    });
  }

  private async *fetchStreamWithRetries(options: {
    responsesURL: string;
    headers: Record<string, string>;
    bodyBlob: Blob;
    abortSignal?: AbortSignal;
    includeThinkingInResponse: boolean;
    maxStreamingAttempts: number;
    streamRetryInitialDelayMs: number;
    normalizedOptions: NormalizedGenerateChatOptions;
  }): AsyncIterableIterator<IContent> {
    let streamingAttempt = 0;
    let currentDelay = options.streamRetryInitialDelayMs;

    while (streamingAttempt < options.maxStreamingAttempts) {
      streamingAttempt += 1;
      const response = await this.fetchResponse(options);
      try {
        yield* this.parseSuccessfulResponse(response, options);
        return;
      } catch (error) {
        currentDelay = await this.handleStreamRetry(error, {
          streamingAttempt,
          maxStreamingAttempts: options.maxStreamingAttempts,
          currentDelay,
        });
      }
    }
  }

  private async fetchResponse(options: {
    responsesURL: string;
    headers: Record<string, string>;
    bodyBlob: Blob;
    abortSignal?: AbortSignal;
  }): Promise<Response> {
    return fetch(options.responsesURL, {
      method: 'POST',
      headers: options.headers,
      body: options.bodyBlob,
      signal: options.abortSignal,
    });
  }

  private async *parseSuccessfulResponse(
    response: Response,
    options: {
      responsesURL: string;
      headers: Record<string, string>;
      bodyBlob: Blob;
      abortSignal?: AbortSignal;
      includeThinkingInResponse: boolean;
    },
  ): AsyncIterableIterator<IContent> {
    if (!response.ok) await this.throwApiError(response);
    if (!response.body) {
      this.logger.debug(() => 'Response body missing, returning early');
      return;
    }

    const streamOptions: ParseResponsesStreamOptions = {
      includeThinkingInResponse: options.includeThinkingInResponse,
    };
    for await (const message of parseResponsesStream(
      response.body,
      streamOptions,
    )) {
      yield message;
    }
  }

  private async throwApiError(response: Response): Promise<never> {
    const errorBody = await response.text();
    this.logger.debug(
      () => `API error ${response.status}: ${errorBody.substring(0, 500)}`,
    );
    throw parseErrorResponse(response.status, errorBody, this.name);
  }

  private async handleStreamRetry(
    error: unknown,
    state: {
      streamingAttempt: number;
      maxStreamingAttempts: number;
      currentDelay: number;
    },
  ): Promise<number> {
    const canRetryStream =
      this.shouldRetryOnError(error) || isNetworkTransientError(error);
    if (
      !canRetryStream ||
      state.streamingAttempt >= state.maxStreamingAttempts
    ) {
      this.logger.debug(
        () =>
          `Stream attempt ${state.streamingAttempt}/${state.maxStreamingAttempts} failed (retryable=${canRetryStream}), throwing: ${String(error)}`,
      );
      throw error;
    }

    this.logger.debug(
      () =>
        `Stream retry attempt ${state.streamingAttempt}/${state.maxStreamingAttempts}: Transient error detected, delay ${state.currentDelay}ms before retry. Error: ${String(error)}`,
    );
    const jitter = state.currentDelay * 0.3 * (Math.random() * 2 - 1);
    await delay(Math.max(0, state.currentDelay + jitter));
    return Math.min(30000, state.currentDelay * 2);
  }
}
