/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type OpenAI from 'openai';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { ProviderFileBindingStore } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { ProviderMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import { readOpenAIMediaSupport } from './OpenAIPromptProjectionPreparation.js';
import { resolveKimiProviderFileRequestPolicy } from '../kimi/kimiProviderFilePolicy.js';
import { ProviderFileLifecycle } from '../providerFilePolicy.js';
import { kimiFileUploadCache } from './kimiFileUploadCache.js';

export async function prepareKimiProviderFiles(
  options: NormalizedGenerateChatOptions,
  client: OpenAI,
  logger: DebugLogger,
  mediaRequest: ResolvedMediaRequest,
  providerName: string,
  mediaTransportCapabilities: ProviderMediaTransportCapabilities,
  fileBindings: ProviderFileBindingStore | undefined,
  fileLifecycle: object | undefined,
  workspaceDirectory: string | undefined,
): Promise<NormalizedGenerateChatOptions> {
  const requestPolicy = resolveKimiProviderFileRequestPolicy(
    options,
    providerName,
    readOpenAIMediaSupport(
      options.invocation.providerDefaults.providerSpecific,
    ),
    mediaTransportCapabilities,
    client,
    workspaceDirectory,
  );
  if (requestPolicy === undefined) return options;

  const lifecycle = fileLifecycle;
  if (!(lifecycle instanceof ProviderFileLifecycle)) {
    throw new Error(
      `Kimi provider files require an owner-bound lifecycle for runtime ${options.invocation.runtimeId}`,
    );
  }
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
        const bindings = fileBindings;
        if (bindings === undefined) return Promise.resolve();
        return bindings.bind(contentId, reference);
      },
      removePersistedReference: (contentId, reference) => {
        const bindings = fileBindings;
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
