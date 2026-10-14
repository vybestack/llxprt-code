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
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { readOpenAIMediaSupport } from './OpenAIPromptProjectionPreparation.js';
import type { ChatRowInput } from './OpenAIRequestPreparation.js';
import { providerRowsOf } from '../utils/providerRows.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { collectContents } from '../utils/collectContents.js';
import {
  resolveRowsMedia,
  type RowsMediaInput,
} from '../openai-responses/responses-row-media.js';
import { resolveKimiProviderFileRequestPolicy } from '../kimi/kimiProviderFilePolicy.js';
import { ProviderFileLifecycle } from '../providerFilePolicy.js';
import { kimiFileUploadCache } from './kimiFileUploadCache.js';

/**
 * The block-bearing rows of the call with their stored media resolved, as one
 * array. The upload batching of `processKimiMedia` needs every row at once, so
 * this is the one chat path that still holds the history; it applies only to a
 * Kimi request with file upload or video enabled (issue #854 D5 makes it per
 * row).
 */
async function resolvedKimiRows(
  options: NormalizedGenerateChatOptions,
  mediaRequest: ResolvedMediaRequest,
  media: RowsMediaInput,
): Promise<IContent[]> {
  const rows = await providerRowsOf(options);
  const signal = getRequestSignal(options);
  async function* blockBearing(): AsyncGenerator<IContent> {
    for await (const row of rows.openReader(signal)) {
      if (Array.isArray(row.blocks)) yield row;
    }
  }
  return collectContents(
    resolveRowsMedia(blockBearing(), media, mediaRequest, signal),
  );
}

function arrayRows(contents: readonly IContent[]): ChatRowInput {
  return {
    rows: {
      async *rows() {
        yield* contents;
      },
    },
  };
}

/**
 * Kimi-only media pre-pass. Returns the rows the body is written from when
 * the request is a Kimi file-upload request, and `undefined` when it is not.
 */
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
  media: RowsMediaInput,
): Promise<ChatRowInput | undefined> {
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
  if (requestPolicy === undefined) return undefined;

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
  const contents = await resolvedKimiRows(options, mediaRequest, media);
  const result = await processKimiMedia(client, contents, kimiFileUploadCache, {
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
  });

  if (result.contents !== contents) {
    logger.debug(
      () =>
        '[OpenAIProvider] Kimi file-upload pre-pass replaced media blocks with stable message references',
    );
  }
  return arrayRows(result.contents);
}
