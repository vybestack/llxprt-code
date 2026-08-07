/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type OpenAI from 'openai';
import type { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/index.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { GenerateChatOptions } from '../IProvider.js';
import { prepareRequest } from './OpenAIRequestPreparation.js';

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
  ) => Promise<NormalizedGenerateChatOptions>;
  readonly logger: DebugLogger;
  readonly defaultModel: string;
  readonly providerName: string;
}

export async function prepareOpenAIChatProjection(
  options: NormalizedGenerateChatOptions,
  deps: ChatProjectionPreparationDeps,
): Promise<{
  options: NormalizedGenerateChatOptions;
  requestContext: Awaited<ReturnType<typeof prepareRequest>>;
}> {
  const support = deps.readMediaSupport();
  const needsClient =
    support?.fileUpload === true || support?.videoSupport === true;
  let preparedOptions = options;
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
    );
  }
  return {
    options: preparedOptions,
    requestContext: await prepareRequest(
      preparedOptions,
      deps.defaultModel,
      preparedOptions.config,
      deps.logger,
      deps.providerName,
    ),
  };
}
