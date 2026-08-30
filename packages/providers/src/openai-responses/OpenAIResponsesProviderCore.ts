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

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { projectOpenAIResponsesPromptEnvelope } from '../runtime/promptEnvelopeProjections.js';
import { OpenAIResponsesProviderBase } from './OpenAIResponsesProviderBase.js';
import {
  executeOpenAIResponsesRequest,
  buildResponsesRequestContextForProjection,
  isResponsesPdfEnabled,
  type ResponsesExecutorDeps,
} from './openAIResponsesExecutor.js';
import type { GenerateChatOptions } from '../IProvider.js';
import { collectUnsupportedMedia } from '../utils/mediaUtils.js';
import {
  createCodexResponsesWebSocketTransport,
  type WebSocketTransport,
} from './openAIResponsesWebSocketTransport.js';
import { declaredMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';

export { toOpenAIResponsesWireEffort } from '../openai/openaiModelPolicy.js';

export class OpenAIResponsesProvider extends OpenAIResponsesProviderBase {
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

  private buildExecutorDeps(): ResponsesExecutorDeps {
    return {
      providerName: this.name,
      logger: this.logger,
      getProviderBaseURL: (options) => this.resolveEffectiveBaseURL(options),
      getCustomHeaders: (options) => this.getCustomHeaders(options),
      isCodexBaseURL: (baseURL) => this.isCodexMode(baseURL),
      getCodexAccountId: () => this.getCodexAccountId(),
      resolveAuthTokenForPrompt: () => this.getAuthTokenForPrompt(),
      shouldRetryOnError: (error) => this.shouldRetryOnError(error),
      getDefaultModel: () => this.getDefaultModel(),
      getMediaTransportCapabilities: (isCodex) =>
        isCodex
          ? declaredMediaTransportCapabilities('codex')
          : this.getMediaTransportCapabilities(),
      getGlobalConfig: () => this.globalConfig,
      getWebSocketTransport: () => this.resolveWebSocketTransport(),
      // Codex statefulness is only valid over the WebSocket transport, so the
      // request builder needs to know the transport BEFORE it decides whether
      // to trim history. Mirrors resolveWebSocketTransport's predicate without
      // constructing a socket.
      isWebSocketTransportActive: () =>
        this.isCodexMode(this.getBaseURL()) && !this.webSocketStickToHttp,
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
    if (!this.isCodexMode(this.getBaseURL())) {
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

  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const preparedRequestContext =
      options.promptEnvelopeTransportToken === undefined
        ? undefined
        : this.preparedPromptEnvelopes.get(
            options.promptEnvelopeTransportToken,
          );
    if (
      options.promptEnvelopeTransportToken !== undefined &&
      preparedRequestContext === undefined
    ) {
      throw new Error(
        'Unknown OpenAI Responses prompt-envelope transport token',
      );
    }
    yield* executeOpenAIResponsesRequest(
      options,
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
    const requestContext = await buildResponsesRequestContextForProjection(
      normalized,
      this.buildExecutorDeps(),
    );
    const transportToken = Object.freeze({});
    this.preparedPromptEnvelopes.set(transportToken, requestContext);
    const pdfEnabled = isResponsesPdfEnabled(normalized);
    const projection = projectOpenAIResponsesPromptEnvelope(
      requestContext.request,
      {
        transportToken,
        unsupportedMedia: collectUnsupportedMedia(
          normalized.contents,
          (category) =>
            category === 'image' || (category === 'pdf' && pdfEnabled),
        ),
      },
      requestContext.projectionContext,
    );
    return {
      ...projection,
      releaseIfUnsent: requestContext.mediaRequest.release,
    };
  }
}
