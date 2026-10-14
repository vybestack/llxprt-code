/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RequestMediaResolutionService } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type OpenAI from 'openai';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { GenerateChatOptions } from '../IProvider.js';
import {
  prepareRequest,
  type ChatRowInput,
  type RequestContext,
} from './OpenAIRequestPreparation.js';
import { chatMediaStage } from './OpenAISourceRoute.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { ProviderMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import type { ChatPromptEstimate } from './OpenAIChatEstimatorFiles.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import type { RowsMediaInput } from '../openai-responses/responses-row-media.js';
import {
  finishMediaRequest,
  resolveRequestMedia,
  captureRequestMediaInput,
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
  /**
   * The Kimi file pre-pass. Returns the rows to convert when it applies and
   * `undefined` when the request has no pre-pass.
   */
  readonly processMedia: (
    options: NormalizedGenerateChatOptions,
    client: OpenAI,
    logger: DebugLogger,
    mediaRequest: ResolvedMediaRequest,
    media: RowsMediaInput,
  ) => Promise<ChatRowInput | undefined>;
  readonly logger: DebugLogger;
  readonly defaultModel: string;
  readonly providerName: string;
  readonly mediaTransportCapabilities: ProviderMediaTransportCapabilities;
}

/**
 * The prepared body belongs to the media request: finishing the request, on
 * any outcome, disposes the spool, the tool id index and, for a projected
 * request, the estimator files.
 */
export function registerOpenAIChatRequestCleanup(
  mediaRequest: ResolvedMediaRequest,
  requestContext: RequestContext,
): void {
  const { estimate } = requestContext;
  try {
    mediaRequest.registerCleanup(requestContext.release);
    if (estimate !== undefined) {
      mediaRequest.registerCleanup(() => estimate.projection.dispose());
    }
  } catch (error) {
    requestContext.release();
    estimate?.discard();
    throw error;
  }
}

export interface PreparedOpenAIChatProjection {
  readonly requestContext: RequestContext;
  readonly mediaRequest: ResolvedMediaRequest;
  readonly estimate: ChatPromptEstimate;
}

/**
 * An unprojected send builds its one chat body inside the transport and hands
 * its spool to the media request, which disposes it when the call ends. The
 * rows come from the Kimi pre-pass when it ran, otherwise from the call with
 * their stored media resolved as they are read.
 */
export async function prepareOwnedOpenAIChatRequest(
  options: NormalizedGenerateChatOptions,
  mediaRequest: ResolvedMediaRequest,
  media: RowsMediaInput,
  defaultModel: string,
  logger: DebugLogger,
  providerName: string,
  mediaTransportCapabilities: ProviderMediaTransportCapabilities,
  kimiRows: ChatRowInput | undefined,
): Promise<RequestContext> {
  const requestContext = await prepareRequest(
    options,
    defaultModel,
    undefined,
    logger,
    providerName,
    mediaTransportCapabilities,
    kimiRows ?? { mediaStage: chatMediaStage(options, media, mediaRequest) },
  );
  registerOpenAIChatRequestCleanup(mediaRequest, requestContext);
  return requestContext;
}

export async function prepareOpenAIChatProjection(
  options: NormalizedGenerateChatOptions,
  deps: ChatProjectionPreparationDeps,
  mediaResolver?: RequestMediaResolutionService,
  mediaBudgetBytes?: number,
): Promise<PreparedOpenAIChatProjection> {
  const support = deps.readMediaSupport();
  const needsClient =
    support?.fileUpload === true || support?.videoSupport === true;
  const media = captureRequestMediaInput(
    options.metadata['logicalRequestId'],
    options.invocation.runtimeId,
    mediaBudgetBytes,
    mediaResolver,
  );
  const mediaRequest = await resolveRequestMedia(
    media,
    [],
    getRequestSignal(options),
  );
  try {
    let rowInput: ChatRowInput = {
      mediaStage: chatMediaStage(options, media, mediaRequest),
    };
    if (needsClient) {
      const client = await deps.getClient({
        ...options,
        resolved: {
          ...options.resolved,
          authToken: await deps.resolveAuthToken(options),
        },
      });
      rowInput =
        (await deps.processMedia(
          options,
          client,
          deps.logger,
          mediaRequest,
          media,
        )) ?? rowInput;
    }
    const requestContext = await prepareRequest(
      options,
      deps.defaultModel,
      undefined,
      deps.logger,
      deps.providerName,
      deps.mediaTransportCapabilities,
      rowInput,
      true,
    );
    registerOpenAIChatRequestCleanup(mediaRequest, requestContext);
    const { estimate } = requestContext;
    if (estimate === undefined) {
      throw new Error('A projected chat request carries its estimator files');
    }
    return { mediaRequest, requestContext, estimate };
  } catch (error) {
    return finishMediaRequest(mediaRequest, { status: 'failed', error });
  }
}
