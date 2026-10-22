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
import { KeyedRowIndex } from '../utils/keyed-row-index.js';
import {
  resolveRowsMedia,
  type RowsMediaInput,
} from '../openai-responses/responses-row-media.js';
import {
  resolveKimiProviderFileRequestPolicy,
  type KimiProviderFileRequestPolicy,
} from '../kimi/kimiProviderFilePolicy.js';
import {
  applyKimiRowMedia,
  uploadKimiRowMedia,
} from '../kimi/kimiMediaProcessing.js';
import type { KimiUploadOptions } from '../kimi/kimiFileUpload.js';
import { ProviderFileLifecycle } from '../providerFilePolicy.js';
import { kimiFileUploadCache } from './kimiFileUploadCache.js';

async function prepareLifecycle(
  options: NormalizedGenerateChatOptions,
  fileLifecycle: object | undefined,
): Promise<ProviderFileLifecycle> {
  if (!(fileLifecycle instanceof ProviderFileLifecycle)) {
    throw new Error(
      `Kimi provider files require an owner-bound lifecycle for runtime ${options.invocation.runtimeId}`,
    );
  }
  await fileLifecycle.sweepExpired();
  await fileLifecycle.retryDeletions();
  const maintenance = fileLifecycle.snapshot();
  if (maintenance.deletionFailures.length > 0) {
    throw new Error(
      `Kimi provider file maintenance failed for runtime ${options.invocation.runtimeId}; files=${maintenance.deletionFailures.map((failure) => failure.fileId).join(',')}`,
    );
  }
  return fileLifecycle;
}

function uploadOptionsOf(
  requestPolicy: KimiProviderFileRequestPolicy,
  lifecycle: ProviderFileLifecycle,
  mediaRequest: ResolvedMediaRequest,
  fileBindings: ProviderFileBindingStore | undefined,
): KimiUploadOptions {
  return {
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
      if (fileBindings === undefined) return Promise.resolve();
      return fileBindings.bind(contentId, reference);
    },
    removePersistedReference: (contentId, reference) => {
      if (fileBindings === undefined) return Promise.resolve();
      return fileBindings.unbind(contentId, reference);
    },
  };
}

/**
 * The block-bearing rows of the call with their stored media resolved, one
 * row at a time. The conversion pass reads the same rows through the same
 * filter, which is what makes a row's position the same in both passes.
 */
async function* resolvedRows(
  options: NormalizedGenerateChatOptions,
  mediaRequest: ResolvedMediaRequest,
  media: RowsMediaInput,
): AsyncGenerator<IContent, void> {
  const rows = await providerRowsOf(options);
  const signal = getRequestSignal(options);
  async function* blockBearing(): AsyncGenerator<IContent> {
    for await (const row of rows.openReader(signal)) {
      if (Array.isArray(row.blocks)) yield row;
    }
  }
  yield* resolveRowsMedia(blockBearing(), media, mediaRequest, signal);
}

/**
 * Uploads the call's PDFs and enabled videos, one row at a time in history
 * order, and records each upload under its media position. Only the row being
 * uploaded is in memory. Returns how many blocks were uploaded.
 */
async function uploadCallMedia(
  rows: AsyncIterable<IContent>,
  client: OpenAI,
  uploads: KeyedRowIndex,
  uploadOptions: KimiUploadOptions,
): Promise<number> {
  let rowOrdinal = 0;
  let uploaded = 0;
  for await (const row of rows) {
    uploaded += await uploadKimiRowMedia(
      client,
      row,
      rowOrdinal++,
      uploads,
      kimiFileUploadCache,
      uploadOptions,
    );
  }
  return uploaded;
}

/** Replaces each uploaded block of the rows passing through with its reference. */
async function* withUploadedReferences(
  rows: AsyncIterable<IContent>,
  uploads: KeyedRowIndex,
): AsyncGenerator<IContent, void> {
  let rowOrdinal = 0;
  for await (const row of rows) {
    yield applyKimiRowMedia(row, rowOrdinal++, uploads);
  }
}

/**
 * Creates the request's upload record. The media request closes it when the
 * call ends, on any outcome.
 */
function createUploadRecord(mediaRequest: ResolvedMediaRequest): KeyedRowIndex {
  const uploads = KeyedRowIndex.create('kimi-media');
  try {
    mediaRequest.registerCleanup(() => uploads.close());
  } catch (error) {
    uploads.close();
    throw error;
  }
  return uploads;
}

/**
 * Kimi-only media pre-pass. For a Kimi file-upload request it uploads the
 * call's media row by row, records the results in a request-scoped disk
 * index, and returns the media stage the chat body is written through: each
 * row's stored media is resolved and then its uploaded blocks are replaced
 * from the index. It returns `undefined` when the request has no pre-pass.
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

  const lifecycle = await prepareLifecycle(options, fileLifecycle);
  const uploads = createUploadRecord(mediaRequest);
  const uploaded = await uploadCallMedia(
    resolvedRows(options, mediaRequest, media),
    client,
    uploads,
    uploadOptionsOf(requestPolicy, lifecycle, mediaRequest, fileBindings),
  );
  if (uploaded > 0) {
    logger.debug(
      () =>
        '[OpenAIProvider] Kimi file-upload pre-pass replaced media blocks with stable message references',
    );
  }
  const signal = getRequestSignal(options);
  return {
    uploadedMedia: uploaded,
    mediaStage: (rows) =>
      withUploadedReferences(
        resolveRowsMedia(rows, media, mediaRequest, signal),
        uploads,
      ),
  };
}
