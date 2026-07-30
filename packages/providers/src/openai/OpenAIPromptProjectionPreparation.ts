/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type OpenAI from 'openai';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { prepareRequest } from './OpenAIRequestPreparation.js';

interface ChatProjectionPreparationDeps {
  readonly readMediaSupport: () =>
    | { fileUpload?: boolean; videoSupport?: boolean }
    | undefined;
  readonly getClient: () => Promise<OpenAI>;
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
  const preparedOptions = needsClient
    ? await deps.processMedia(options, await deps.getClient(), deps.logger)
    : options;
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
