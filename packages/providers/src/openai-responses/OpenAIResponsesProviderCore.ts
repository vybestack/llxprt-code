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

import { captureResponsesRequest } from './responses-request.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { OAuthManager } from '@vybestack/llxprt-code-auth';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { readsRequestRowsAtTransport } from '../BaseProviderNormalization.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { projectOpenAIResponsesPromptEnvelope } from '../runtime/promptEnvelopeProjections.js';
import { OpenAIResponsesProviderBase } from './OpenAIResponsesProviderBase.js';
import {
  executeOpenAIResponsesRequest,
  buildResponsesRequestContextForProjection,
  isResponsesPdfEnabled,
  type ResponsesExecutorDeps,
} from './openAIResponsesExecutor.js';
import type { GenerateChatOptions, ProviderToolset } from '../IProvider.js';
import { collectUnsupportedMedia } from '../utils/mediaUtils.js';
import {
  createCodexResponsesWebSocketTransport,
  type WebSocketTransport,
} from './openAIResponsesWebSocketTransport.js';
import { declaredMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import type { IProviderConfig } from '../types/IProviderConfig.js';
import type { ModelDefaultRule } from '../composition/providerAliases.js';
import { finishMediaRequest } from '../utils/request-media-resolution.js';
import {
  buildDiskTextResponsesContext,
  diskTextProjection,
  assertDiskTextShape,
  assertPreparedStatefulUnchanged,
} from './responses-disk-text-projection.js';
import {
  createUnallowedModelParametersResolver,
  type UnallowedModelParametersResolver,
} from './unallowedModelParameters.js';

export { toOpenAIResponsesWireEffort } from '../openai/openaiModelPolicy.js';

export class OpenAIResponsesProvider extends OpenAIResponsesProviderBase {
  private readonly getUnallowedModelParameters: UnallowedModelParametersResolver;
  // Codex (codex-rs/core/src/responses_retry.rs) only switches to a sticky HTTP
  // fallback after exhausting its WebSocket stream-retry budget (default
  // `stream_max_retries` = 5). We rely on the outer RetryOrchestrator to retry
  // the whole request — each attempt reuses a fresh socket because the
  // transport invalidates its socket on failure — so a single pre-output
  // WebSocket blip must NOT permanently demote the session. A small threshold
  // of consecutive failures mirrors that intent without introducing nested
  // retry multiplication.
  static readonly WEBSOCKET_STICKY_FALLBACK_THRESHOLD = 3;
  private webSocketTransport: WebSocketTransport | undefined;
  private webSocketStickToHttp = false;
  private webSocketConsecutiveFallbacks = 0;
  // #3134 Fix 1: response ids the backend has refused as a parent. Tracked
  // per id rather than as a session-wide switch so a resumed session, whose
  // loaded history carries parents scoped to a socket that no longer exists,
  // recovers instead of replaying the full history for the rest of the run.
  private readonly rejectedStatefulParents = new Set<string>();
  private readonly preparedPromptEnvelopes = new WeakMap<
    object,
    Awaited<ReturnType<typeof buildResponsesRequestContextForProjection>>
  >();

  constructor(
    apiKey: string | undefined,
    baseURL?: string,
    config?: IProviderConfig,
    oauthManager?: OAuthManager,
    modelDefaultRules: readonly ModelDefaultRule[] = [],
    providerName = 'openai-responses',
  ) {
    super(apiKey, baseURL, config, oauthManager, providerName);

    this.getUnallowedModelParameters =
      createUnallowedModelParametersResolver(modelDefaultRules);
  }

  private buildExecutorDeps(): ResponsesExecutorDeps {
    return {
      providerName: this.name,
      logger: this.logger,
      isCodexMode: () => this.isCodexMode(),
      getCodexAccountId: () => this.getCodexAccountId(),
      resolveAuthTokenForPrompt: () => this.getAuthTokenForPrompt(),
      shouldRetryOnError: (error) => this.shouldRetryOnError(error),
      getMediaTransportCapabilities: (isCodex) =>
        isCodex
          ? declaredMediaTransportCapabilities('codex')
          : this.getMediaTransportCapabilities(),
      getUnallowedModelParameters: this.getUnallowedModelParameters,
      getWebSocketTransport: () => this.resolveWebSocketTransport(),
      // Codex statefulness is only valid over the WebSocket transport, so the
      // request builder needs to know the transport BEFORE it decides whether
      // to trim history. Mirrors resolveWebSocketTransport's predicate without
      // constructing a socket.
      isWebSocketTransportActive: () =>
        this.isCodexMode() && !this.webSocketStickToHttp,
      onWebSocketFallback: () => {
        // One pre-output failure still serves THIS request over HTTP (an
        // invisible in-turn recovery); only a sustained run of them sticks.
        this.webSocketConsecutiveFallbacks += 1;
        if (
          this.webSocketConsecutiveFallbacks >=
          OpenAIResponsesProvider.WEBSOCKET_STICKY_FALLBACK_THRESHOLD
        ) {
          this.webSocketStickToHttp = true;
        }
      },
      onWebSocketSuccess: () => {
        this.webSocketConsecutiveFallbacks = 0;
      },
      isRejectedStatefulParent: (responseId) =>
        this.rejectedStatefulParents.has(responseId),
      markStatefulParentRejected: (responseId) => {
        this.rejectedStatefulParents.add(responseId);
      },
    };
  }

  private resolveWebSocketTransport(): WebSocketTransport | undefined {
    if (!this.isCodexMode()) {
      this.webSocketTransport?.close();
      this.webSocketTransport = undefined;
      return undefined;
    }
    if (this.webSocketStickToHttp) return undefined;
    this.webSocketTransport ??= this.createWebSocketTransport();
    return this.webSocketTransport;
  }

  /**
   * Builds the Codex WebSocket transport. Overridable so tests can inject a
   * deterministic transport double without standing up a real WebSocket server.
   */
  protected createWebSocketTransport(): WebSocketTransport {
    return createCodexResponsesWebSocketTransport({
      logger: this.logger,
    });
  }

  override clearState(): void {
    super.clearState();
    this.webSocketTransport?.close();
    this.webSocketTransport = undefined;
    this.webSocketStickToHttp = false;
    this.webSocketConsecutiveFallbacks = 0;
    this.rejectedStatefulParents.clear();
  }

  override generateChatCompletion(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent>;
  override generateChatCompletion(
    contents: AsyncIterable<IContent>,
    tools?: ProviderToolset,
  ): AsyncIterableIterator<IContent>;
  override generateChatCompletion(
    contentsOrOptions: AsyncIterable<IContent> | GenerateChatOptions,
    tools?: ProviderToolset,
  ): AsyncIterableIterator<IContent> {
    if (!('contents' in contentsOrOptions))
      return super.generateChatCompletion(contentsOrOptions, tools);
    const token = contentsOrOptions.promptEnvelopeTransportToken;
    const prepared =
      token === undefined ? undefined : this.preparedPromptEnvelopes.get(token);
    if (
      prepared?.sourcePrompt !== undefined &&
      !readsRequestRowsAtTransport(contentsOrOptions)
    )
      throw new Error('Source token requires its transport-read request rows');
    if (
      readsRequestRowsAtTransport(contentsOrOptions) &&
      prepared !== undefined &&
      prepared.sourcePrompt === undefined
    )
      throw new Error(
        'Disk text selection requires a source-backed prepared token',
      );
    if (readsRequestRowsAtTransport(contentsOrOptions) && token === undefined)
      return this.generateWithOwnProjection(contentsOrOptions);
    return super.generateChatCompletion(contentsOrOptions);
  }

  /**
   * Callers outside the chat send seam (compression summaries) hand over
   * request rows without a projection. The provider prepares the same
   * projection the seam would, so the transport still reads one prepared
   * envelope.
   */
  private async *generateWithOwnProjection(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const projection = await this.projectPromptEnvelope(options);
    yield* super.generateChatCompletion({
      ...options,
      promptEnvelopeTransportToken: projection.transportToken,
    });
  }

  protected override ownsRequestRowsTransport(): boolean {
    return true;
  }

  private captureRequest(
    options: NormalizedGenerateChatOptions,
  ): ReturnType<typeof captureResponsesRequest> {
    return captureResponsesRequest(
      options,
      this.name,
      this.resolveEffectiveBaseURL(options) ?? 'https://api.openai.com/v1',
      this.getCustomHeaders(options),
      this.getDefaultModel(),
      this.requestMediaResolver,
      this.requestMediaBudgetBytes,
    );
  }

  protected override async releaseUnstartedOptions(
    options: NormalizedGenerateChatOptions,
  ): Promise<void> {
    if (!readsRequestRowsAtTransport(options)) return;
    const token = options.promptEnvelopeTransportToken;
    if (token === undefined) return;
    const prepared = this.preparedPromptEnvelopes.get(token);
    this.preparedPromptEnvelopes.delete(token);
    options.resolved.authToken = '';
    try {
      await prepared?.mediaRequest.release();
    } finally {
      delete options.requestRows;
      delete options.promptEnvelopeTransportToken;
    }
  }

  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const request = this.captureRequest(options);
    if (readsRequestRowsAtTransport(options)) {
      assertDiskTextShape(request, this.buildExecutorDeps());
      if (options.promptEnvelopeTransportToken === undefined)
        throw new Error(
          'Explicit Responses disk text send requires a prepared projection token',
        );
    }
    const preparedRequestContext =
      options.promptEnvelopeTransportToken === undefined
        ? undefined
        : this.preparedPromptEnvelopes.get(
            options.promptEnvelopeTransportToken,
          );
    if (
      preparedRequestContext?.sourcePrompt !== undefined &&
      readsRequestRowsAtTransport(options)
    )
      assertPreparedStatefulUnchanged(
        request,
        this.buildExecutorDeps(),
        preparedRequestContext,
      );
    if (
      options.promptEnvelopeTransportToken !== undefined &&
      preparedRequestContext === undefined
    ) {
      throw new Error(
        'Unknown OpenAI Responses prompt-envelope transport token',
      );
    }
    if (options.promptEnvelopeTransportToken !== undefined) {
      this.preparedPromptEnvelopes.delete(options.promptEnvelopeTransportToken);
    }
    yield* executeOpenAIResponsesRequest(
      request,
      this.buildExecutorDeps(),
      preparedRequestContext,
    );
  }

  /**
   * Project the finalized OpenAI Responses envelope (issue #2817) using the
   * SAME `buildRequestContext` path transport consumes, so the estimate is
   * derived from the exact `request` that will be sent.
   */
  async projectPromptEnvelope(
    options: GenerateChatOptions,
  ): Promise<PromptEnvelopeProjection> {
    const normalized = await this.normalizeOptionsForProjection(options);
    if (readsRequestRowsAtTransport(normalized)) {
      const prepared = await buildDiskTextResponsesContext(
        this.captureRequest(normalized),
        this.buildExecutorDeps(),
      );
      const token = Object.freeze({});
      this.preparedPromptEnvelopes.set(token, prepared);
      try {
        return diskTextProjection(prepared, token, async () => {
          if (!this.preparedPromptEnvelopes.delete(token)) return;
          await prepared.mediaRequest.release();
        });
      } catch (error) {
        this.preparedPromptEnvelopes.delete(token);
        return finishMediaRequest(prepared.mediaRequest, {
          status: 'failed',
          error,
        });
      }
    }
    const requestContents = normalized.requestContents;
    const request = this.captureRequest(normalized);
    let prepared:
      | Awaited<ReturnType<typeof buildResponsesRequestContextForProjection>>
      | undefined;
    try {
      const requestContext = await buildResponsesRequestContextForProjection(
        request,
        this.buildExecutorDeps(),
      );
      prepared = requestContext;
      requestContext.mediaRequest.registerCleanup(() =>
        requestContents?.dispose(),
      );
      const transportToken = Object.freeze({});
      const pdfEnabled = isResponsesPdfEnabled(request);
      const projection = projectOpenAIResponsesPromptEnvelope(
        requestContext.request,
        {
          transportToken,
          unsupportedMedia: requestContext.mediaRequest.withContents(
            (contents) =>
              collectUnsupportedMedia(
                contents,
                (_block, category) =>
                  category === 'image' || (category === 'pdf' && pdfEnabled),
              ),
          ),
        },
        requestContext.projectionContext,
      );
      this.preparedPromptEnvelopes.set(transportToken, requestContext);
      return {
        ...projection,
        releaseIfUnsent: async () => {
          if (!this.preparedPromptEnvelopes.delete(transportToken)) return;
          await requestContext.mediaRequest.release();
        },
      };
    } catch (error) {
      if (prepared !== undefined) {
        return finishMediaRequest(prepared.mediaRequest, {
          status: 'failed',
          error,
        });
      }
      try {
        await requestContents?.dispose();
      } catch (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          'Responses projection failed and request contents disposal also failed',
        );
      }
      throw error;
    }
  }
}
