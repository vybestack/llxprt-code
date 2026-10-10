/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type OpenAI from 'openai';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { resolveKimiProviderFileRequestPolicy } from '../kimi/kimiProviderFilePolicy.js';
import type { ProviderMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import { requireRuntimeEntry } from '../runtime/runtimeRegistry.js';
import { kimiFileUploadCache } from './kimiFileUploadCache.js';
import type { OpenAIMediaSupport } from './OpenAIPromptProjectionPreparation.js';

export interface KimiMediaPrepassContext {
  readonly providerName: string;
  readonly mediaSupport: OpenAIMediaSupport | undefined;
  readonly capabilities: ProviderMediaTransportCapabilities;
}

/**
 * Kimi-only media pre-pass. Declared media support and explicit user policy
 * must both permit Files API use. Stable provider references replace media in
 * message content so request-specific IDs never alter the system instruction.
 */
export async function processKimiMediaPrepass(
  options: NormalizedGenerateChatOptions,
  client: OpenAI,
  logger: DebugLogger,
  mediaRequest: ResolvedMediaRequest,
  context: KimiMediaPrepassContext,
): Promise<NormalizedGenerateChatOptions> {
  const requestPolicy = resolveKimiProviderFileRequestPolicy(
    options,
    context.providerName,
    context.mediaSupport,
    context.capabilities,
    client,
  );
  if (requestPolicy === undefined) return options;

  const lifecycle = requireRuntimeEntry(
    options.invocation.runtimeId,
  ).providerFileLifecycle;
  await lifecycle.sweepExpired();
  await lifecycle.retryDeletions();
  const maintenance = lifecycle.snapshot();
  if (maintenance.deletionFailures.length > 0) {
    throw new Error(
      `Kimi provider file maintenance failed for runtime ${options.invocation.runtimeId}; files=${maintenance.deletionFailures.map((failure) => failure.fileId).join(',')}`,
    );
  }

  const { processKimiMedia } = await import('../kimi/kimiMediaProcessing.js');
  const result = await processKimiMedia(
    client,
    options.contents,
    kimiFileUploadCache,
    {
      allowFileUpload: requestPolicy.allowFileUpload,
      allowVideo: requestPolicy.allowVideo,
      lifecycle,
      policy: requestPolicy.policy,
      identity: requestPolicy.identity,
      scopeId: requestPolicy.scopeId,
      scopeKey: requestPolicy.scopeId,
      registerLease: (lease) => {
        mediaRequest.registerCleanup(() => lease.release());
      },
      persistReference: (contentId, reference) => {
        const bindings = options.runtime?.providerFileBindings;
        if (bindings === undefined) return Promise.resolve();
        return bindings.bind(contentId, reference);
      },
      removePersistedReference: (contentId, reference) => {
        const bindings = options.runtime?.providerFileBindings;
        if (bindings === undefined) return Promise.resolve();
        return bindings.unbind(contentId, reference);
      },
    },
  );

  if (result.contents === options.contents) return options;
  logger.debug(
    () =>
      '[OpenAIProvider] Kimi file-upload pre-pass replaced media blocks with stable message references',
  );
  return { ...options, contents: result.contents };
}
