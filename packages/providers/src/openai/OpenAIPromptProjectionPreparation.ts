/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type OpenAI from 'openai';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { GenerateChatOptions } from '../IProvider.js';
import { prepareRequest } from './OpenAIRequestPreparation.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { ProviderMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import type { UnsupportedMediaEntry } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import {
  acquireRequestScopedBody,
  type RequestScopedBody,
} from '../utils/requestScopedBody.js';
import { readsRequestRowsAtTransport } from '../BaseProviderNormalization.js';
import { collectUnsupportedMedia } from '../utils/mediaUtils.js';
import {
  dropTransportRows,
  openTransportRowsMedia,
} from '../utils/transportRows.js';
import {
  finishMediaRequest,
  resolveRequestMedia,
} from '../utils/request-media-resolution.js';

export interface OpenAIMediaSupport {
  readonly inlineImages?: boolean;
  readonly fileUpload?: boolean;
  readonly videoSupport?: boolean;
}

export function readOpenAIMediaSupport(
  providerSpecific: unknown,
): OpenAIMediaSupport | undefined {
  if (typeof providerSpecific !== 'object' || providerSpecific === null) {
    return undefined;
  }
  if (
    Array.isArray(providerSpecific) ||
    !('mediaSupport' in providerSpecific)
  ) {
    return undefined;
  }
  const mediaSupport: unknown = providerSpecific.mediaSupport;
  if (typeof mediaSupport !== 'object' || mediaSupport === null) {
    return undefined;
  }
  if (Array.isArray(mediaSupport)) return undefined;
  return mediaSupport as OpenAIMediaSupport;
}

/**
 * Ensure projection options carry an explicit model before normalization.
 *
 * Mirrors the provider's established `getModel() || getDefaultModel()`
 * fallback so an absent or empty resolved model never reaches transport
 * resolution as an empty string (issue #2817).
 */
export function withProjectionModel(
  options: GenerateChatOptions,
  resolveFallbackModel: () => string,
): GenerateChatOptions {
  const requestedModel = options.resolved?.model;
  if (requestedModel !== undefined && requestedModel !== '') {
    return options;
  }
  return {
    ...options,
    resolved: { ...options.resolved, model: resolveFallbackModel() },
  };
}

interface ChatProjectionPreparationDeps {
  readonly readMediaSupport: () =>
    | { fileUpload?: boolean; videoSupport?: boolean }
    | undefined;
  readonly getClient: (
    options: NormalizedGenerateChatOptions,
  ) => Promise<OpenAI>;
  /**
   * Resolve the prompt credential for client construction. Projection
   * normalization is a pure read, so `resolved.authToken` is empty unless the
   * caller already resolved one; the client must still be built with the same
   * credential transport would use (issue #2817).
   */
  readonly resolveAuthToken: (
    options: NormalizedGenerateChatOptions,
  ) => Promise<string>;
  readonly processMedia: (
    options: NormalizedGenerateChatOptions,
    client: OpenAI,
    logger: DebugLogger,
    mediaRequest: ResolvedMediaRequest,
  ) => Promise<NormalizedGenerateChatOptions>;
  readonly logger: DebugLogger;
  readonly defaultModel: string;
  readonly providerName: string;
  readonly mediaTransportCapabilities: ProviderMediaTransportCapabilities;
}

export function registerOpenAIChatRequestCleanup(
  mediaRequest: ResolvedMediaRequest,
  requestContext: Awaited<ReturnType<typeof prepareRequest>>,
): RequestScopedBody<OpenAI.Chat.ChatCompletionCreateParams> {
  // Issue #854 P05b4: the wire body is owned by a request-scoped lease and
  // the media request's finish releases it, so the body arrays are spliced
  // once the transport call settles (any outcome) instead of outliving it.
  const requestBodyLease = acquireRequestScopedBody(
    'openai',
    requestContext.requestBody,
  );
  mediaRequest.registerCleanup(() => {
    void requestBodyLease.release();
  });
  return requestBodyLease;
}

export interface PreparedOpenAIChatProjection {
  readonly options: NormalizedGenerateChatOptions;
  readonly requestContext: Awaited<ReturnType<typeof prepareRequest>>;
  readonly mediaRequest: ResolvedMediaRequest;
  readonly bodyLease: RequestScopedBody<OpenAI.Chat.ChatCompletionCreateParams>;
  readonly unsupportedMedia: readonly UnsupportedMediaEntry[];
}

/**
 * Drops the transient neutral rows once the chat body exists, so only the one
 * wire `messages` body stays alive (issue #854 WP08). The Kimi pre-pass may
 * have swapped in its own row list.
 */
export function dropOpenAIChatSourceRows(
  mediaRequest: ResolvedMediaRequest,
  options: NormalizedGenerateChatOptions,
): void {
  dropTransportRows(mediaRequest);
  options.contents.splice(0);
}

/**
 * An unprojected send builds its one chat body inside the transport: it takes
 * the body's request-scoped lease and, on the source route, drops the
 * transient neutral rows.
 */
export async function prepareOwnedOpenAIChatRequest(
  options: NormalizedGenerateChatOptions,
  mediaRequest: ResolvedMediaRequest,
  defaultModel: string,
  logger: DebugLogger,
  providerName: string,
  mediaTransportCapabilities: ProviderMediaTransportCapabilities,
): Promise<Awaited<ReturnType<typeof prepareRequest>>> {
  const requestContext = await prepareRequest(
    options,
    defaultModel,
    options.config,
    logger,
    providerName,
    mediaTransportCapabilities,
  );
  registerOpenAIChatRequestCleanup(mediaRequest, requestContext);
  if (readsRequestRowsAtTransport(options)) {
    dropOpenAIChatSourceRows(mediaRequest, options);
  }
  return requestContext;
}

export async function prepareOpenAIChatProjection(
  options: NormalizedGenerateChatOptions,
  deps: ChatProjectionPreparationDeps,
): Promise<PreparedOpenAIChatProjection> {
  const support = deps.readMediaSupport();
  const needsClient =
    support?.fileUpload === true || support?.videoSupport === true;
  const sourceRoute = readsRequestRowsAtTransport(options);
  const mediaRequest = sourceRoute
    ? await openTransportRowsMedia(options)
    : await resolveRequestMedia(
        options.runtime,
        options.contents,
        options.invocation.signal,
      );
  try {
    let preparedOptions = {
      ...options,
      contents: mediaRequest.withContents((contents) => contents),
    };
    if (needsClient) {
      const client = await deps.getClient({
        ...options,
        resolved: {
          ...options.resolved,
          authToken: await deps.resolveAuthToken(options),
        },
      });
      preparedOptions = await deps.processMedia(
        preparedOptions,
        client,
        deps.logger,
        mediaRequest,
      );
    }
    const requestContext = await prepareRequest(
      preparedOptions,
      deps.defaultModel,
      preparedOptions.config,
      deps.logger,
      deps.providerName,
      deps.mediaTransportCapabilities,
    );
    const bodyLease = registerOpenAIChatRequestCleanup(
      mediaRequest,
      requestContext,
    );
    const unsupportedMedia = collectUnsupportedMedia(
      preparedOptions.contents,
      (_block, category) => category === 'image',
    );
    if (sourceRoute) dropOpenAIChatSourceRows(mediaRequest, preparedOptions);
    return {
      options: preparedOptions,
      mediaRequest,
      requestContext,
      bodyLease,
      unsupportedMedia,
    };
  } catch (error) {
    return finishMediaRequest(mediaRequest, { status: 'failed', error });
  }
}
