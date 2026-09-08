/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type OpenAI from 'openai';
import { toFile } from 'openai';
import { createHash, createHmac } from 'node:crypto';
import {
  requireInlineMediaBlock,
  type MediaBlock,
  type ProviderFileReferenceMetadata,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { classifyMediaBlock } from '../utils/mediaUtils.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type {
  ProviderFileIdentity,
  ProviderFileLease,
  ProviderFileLifecycle,
  ProviderFilePolicy,
} from '../providerFilePolicy.js';

const logger = new DebugLogger('llxprt:kimi:fileUpload');

/**
 * Kimi's Files API uses purpose `"file-extract"` for document extraction,
 * which is not in the OpenAI SDK's FilePurpose union
 * (`'assistants' | 'batch' | ...`). This alias narrows the cast to a single
 * well-documented location rather than spreading it through the call site.
 */
type SdkFilePurpose = Parameters<OpenAI['files']['create']>[0]['purpose'];
const KIMI_FILE_EXTRACT_PURPOSE = 'file-extract' as unknown as SdkFilePurpose;
const KIMI_VIDEO_PURPOSE = 'video' as unknown as SdkFilePurpose;

/**
 * A bounded least-recently-used cache backed by a Map. Reads and updates move
 * entries to the newest position; insertion evicts the least recently used entry.
 *
 * Implements only the subset of Map methods used by the upload pipeline.
 */
export interface BoundedCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  readonly size: number;
}

export function createBoundedCache<V>(maxSize: number): BoundedCache<V> {
  if (!Number.isInteger(maxSize) || maxSize <= 0) {
    throw new RangeError('maxSize must be a positive integer');
  }
  const map = new Map<string, V>();
  return {
    get(key: string) {
      const value = map.get(key);
      if (value !== undefined) {
        map.delete(key);
        map.set(key, value);
      }
      return value;
    },
    set(key: string, value: V) {
      if (map.has(key)) {
        map.delete(key);
      } else if (map.size >= maxSize) {
        const leastRecentlyUsedKey = map.keys().next().value;
        if (leastRecentlyUsedKey !== undefined) {
          map.delete(leastRecentlyUsedKey);
        }
      }
      map.set(key, value);
    },
    has(key: string) {
      return map.has(key);
    },
    delete(key: string) {
      return map.delete(key);
    },
    get size() {
      return map.size;
    },
  };
}

/**
 * Result of an upload attempt for a single media block.
 * On success `fileId` is populated. `failed` identifies blocks that were not
 * uploadable; an attempted upload failure rejects the request.
 */
export interface KimiFileUploadResult {
  block: MediaBlock;
  fileId?: string;
  failed: boolean;
}

/**
 * Fixed domain-separation label used as the HMAC message. The credential is
 * used as the HMAC key material; the label exists only to bind this derivation
 * to the upload-cache-namespacing use case.
 */
const CACHE_KEY_CREDENTIAL_LABEL = 'llxprt-kimi-upload-cache-key';

/**
 * Build a stable cache key from a media block's content so that repeated
 * turns referencing the same document are not re-uploaded.
 *
 * The key includes the endpoint and a keyed derivation of the API credential
 * (HMAC-SHA256 with the api key as the key and a fixed domain-separation label
 * as the message) because Moonshot file ids are scoped to an account. The
 * credential is used as HMAC key material for cache namespacing only; it is not
 * stored or persisted. The complete payload is hashed so distinct files cannot
 * alias merely because their length and edges match.
 */
function buildCacheKey(
  client: OpenAI,
  block: MediaBlock,
  scopeKey: string,
): string {
  const inlineBlock = requireInlineMediaBlock(block);
  const hash = createHash('sha256');
  const credentialToken = createHmac('sha256', client.apiKey)
    .update(CACHE_KEY_CREDENTIAL_LABEL)
    .digest('hex');
  hash.update(client.baseURL);
  hash.update('\0');
  hash.update(credentialToken);
  hash.update('\0');
  hash.update(scopeKey);
  hash.update('\0');
  hash.update(inlineBlock.mimeType);
  hash.update('\0');
  hash.update(inlineBlock.data);
  return hash.digest('hex');
}

/**
 * Convert a base64 data URI (or raw base64) from a {@link MediaBlock} into a
 * binary Buffer, stripping any `data:...;base64,` prefix that may be present.
 */
function decodeMediaToBuffer(block: MediaBlock): Buffer {
  const inlineBlock = requireInlineMediaBlock(block);
  if (inlineBlock.encoding === 'url') {
    throw new Error(
      "Cannot decode media block with encoding 'url' as base64 buffer",
    );
  }
  const raw = inlineBlock.data;
  if (raw.length === 0) {
    throw new Error('Media block data is empty');
  }
  const commaIdx = raw.indexOf(',');
  const base64 =
    commaIdx >= 0 && raw.startsWith('data:') ? raw.slice(commaIdx + 1) : raw;
  return Buffer.from(base64, 'base64');
}

/**
 * Determine a filename for the upload. Falls back to a sensible default based
 * on the media type when the block does not carry one.
 */
function resolveFilename(block: MediaBlock): string {
  if (block.filename && block.filename.trim() !== '') {
    return block.filename;
  }
  if (classifyMediaBlock(block) === 'pdf') {
    return 'document.pdf';
  }
  if (classifyMediaBlock(block) === 'video') {
    return 'video.mp4';
  }
  return 'document.bin';
}

/**
 * Uploads PDF/document media blocks to Kimi's Files API via the live
 * OpenAI-compatible client and returns a mapping from block to file id.
 *
 * - Reuses the already-instantiated stateless client; no separate HTTP client.
 * - De-duplicates uploads across turns via an in-memory content-hash cache.
 * - Rejects an attempted upload failure before provider request submission.
 *
 * @param client - The live OpenAI-compatible client (carries Kimi base URL/auth).
 * @param blocks - PDF media blocks to upload.
 * @param cache - Optional shared cache map (keyed by content hash) so callers
 *   can persist de-dup across multiple invocations within a session.
 * @returns One {@link KimiFileUploadResult} per input block, in order.
 */
export interface KimiUploadOptions {
  allowFileUpload?: boolean;
  allowVideo?: boolean;
  scopeKey?: string;
  lifecycle?: ProviderFileLifecycle;
  policy?: ProviderFilePolicy;
  identity?: ProviderFileIdentity;
  scopeId?: string;
  registerLease?: (lease: ProviderFileLease) => void;
  persistReference?: (
    contentId: string,
    reference: ProviderFileReferenceMetadata,
  ) => Promise<void>;
  removePersistedReference?: (
    contentId: string,
    reference: ProviderFileReferenceMetadata,
  ) => Promise<void>;
}

export function isKimiUploadable(
  block: MediaBlock,
  options: KimiUploadOptions,
): boolean {
  if (block.encoding !== 'base64') {
    return false;
  }
  const category = classifyMediaBlock(block);
  return (
    (category === 'pdf' && options.allowFileUpload !== false) ||
    (category === 'video' && options.allowVideo === true)
  );
}

async function holdLease(
  lease: ProviderFileLease,
  options: KimiUploadOptions,
): Promise<void> {
  if (options.registerLease === undefined) {
    await lease.release();
    return;
  }
  try {
    options.registerLease(lease);
  } catch (registrationError) {
    try {
      await lease.release();
    } catch (releaseError) {
      throw new AggregateError(
        [registrationError, releaseError],
        'Kimi provider file cleanup registration and lease release failed',
      );
    }
    throw registrationError;
  }
}

function matchingPersistedReference(
  block: MediaBlock,
  cacheKey: string,
  options: KimiUploadOptions,
): ProviderFileReferenceMetadata | undefined {
  const policy = options.policy;
  const identity = options.identity;
  const scopeId = options.scopeId;
  if (
    policy?.mode !== 'enabled' ||
    identity === undefined ||
    scopeId === undefined
  ) {
    return undefined;
  }
  return requireInlineMediaBlock(block).providerFiles?.find((reference) =>
    [
      reference.cacheKey === cacheKey,
      reference.provider === identity.provider,
      reference.baseURL === identity.baseURL,
      reference.credentialHash === identity.credentialHash,
      reference.scope === policy.scope,
      reference.scopeId === scopeId,
      reference.deletionState === 'active',
    ].every(Boolean),
  );
}

async function acquireLifecycleReference(
  block: MediaBlock,
  cacheKey: string,
  client: OpenAI,
  options: KimiUploadOptions,
): Promise<
  { readonly fileId: string; readonly lease: ProviderFileLease } | undefined
> {
  if (
    options.lifecycle === undefined ||
    options.policy?.mode !== 'enabled' ||
    options.identity === undefined ||
    options.scopeId === undefined
  ) {
    return undefined;
  }
  const acquired = options.lifecycle.acquire({
    cacheKey,
    identity: options.identity,
    scope: options.policy.scope,
    scopeId: options.scopeId,
  });
  if (acquired !== undefined) {
    return { fileId: acquired.reference.fileId, lease: acquired.lease };
  }
  const persisted = matchingPersistedReference(block, cacheKey, options);
  if (persisted === undefined) return undefined;
  const restored = await options.lifecycle.restore(
    persisted,
    cacheKey,
    async (fileId) => {
      await client.files.delete(fileId);
    },
    {
      identity: options.identity,
      policy: options.policy,
      scopeId: options.scopeId,
      removeBinding: createBindingRemoval(block, options),
    },
  );
  return restored === undefined
    ? undefined
    : { fileId: restored.reference.fileId, lease: restored.lease };
}

type EnabledKimiLifecycleOptions = KimiUploadOptions & {
  readonly lifecycle: ProviderFileLifecycle;
  readonly policy: Extract<ProviderFilePolicy, { mode: 'enabled' }>;
  readonly identity: ProviderFileIdentity;
  readonly scopeId: string;
};

type UploadedKimiFile = Awaited<ReturnType<OpenAI['files']['create']>>;

function hasLifecycleConfiguration(
  options: KimiUploadOptions,
): options is EnabledKimiLifecycleOptions {
  return (
    options.lifecycle !== undefined &&
    options.policy?.mode === 'enabled' &&
    options.identity !== undefined &&
    options.scopeId !== undefined
  );
}

function createBindingRemoval(
  block: MediaBlock,
  options: KimiUploadOptions,
): ((reference: ProviderFileReferenceMetadata) => Promise<void>) | undefined {
  const contentId = requireInlineMediaBlock(block).sourceContentId;
  const removePersistedReference = options.removePersistedReference;
  return contentId === undefined || removePersistedReference === undefined
    ? undefined
    : (reference) => removePersistedReference(contentId, reference);
}

async function rollbackUnretainedUpload(
  client: OpenAI,
  uploadedId: string,
  retentionError: unknown,
): Promise<never> {
  try {
    await client.files.delete(uploadedId);
  } catch (deletionError) {
    throw new AggregateError(
      [retentionError, deletionError],
      'Kimi provider file retention and rollback deletion failed',
    );
  }
  throw retentionError;
}

async function retainUploadedFile(
  client: OpenAI,
  block: MediaBlock,
  cacheKey: string,
  uploaded: UploadedKimiFile,
  cache: BoundedCache<string> | undefined,
  options: KimiUploadOptions,
): Promise<void> {
  if (!hasLifecycleConfiguration(options)) {
    cache?.set(cacheKey, uploaded.id);
    return;
  }
  const retained = await options.lifecycle
    .retain({
      cacheKey,
      fileId: uploaded.id,
      bytes: uploaded.bytes,
      identity: options.identity,
      policy: options.policy,
      scopeId: options.scopeId,
      deleteRemote: async (fileId) => {
        await client.files.delete(fileId);
      },
      removeBinding: createBindingRemoval(block, options),
    })
    .catch((error: unknown) =>
      rollbackUnretainedUpload(client, uploaded.id, error),
    );
  try {
    const contentId = requireInlineMediaBlock(block).sourceContentId;
    if (contentId !== undefined && options.persistReference !== undefined) {
      await options.persistReference(contentId, retained.reference);
    }
    await holdLease(retained.lease, options);
  } catch (error) {
    await retained.lease.release();
    const rollback = await options.lifecycle.discard(retained.reference);
    if (rollback.failed > 0 || rollback.deferred > 0) {
      const snapshot = options.lifecycle.snapshot();
      throw new AggregateError(
        [
          error,
          new Error(
            `Kimi retained provider file rollback failed for ${retained.reference.fileId}: ${snapshot.deletionFailures.map((failure) => failure.message).join('; ') || 'cleanup deferred'}`,
          ),
        ],
        'Kimi provider file binding and rollback deletion failed',
      );
    }
    throw error;
  }
}

async function uploadKimiFile(
  client: OpenAI,
  block: MediaBlock,
  cache: BoundedCache<string> | undefined,
  options: KimiUploadOptions,
): Promise<KimiFileUploadResult> {
  if (!isKimiUploadable(block, options)) return { block, failed: true };
  const category = classifyMediaBlock(block);
  const cacheKey = buildCacheKey(
    client,
    block,
    options.scopeKey ?? 'request-local',
  );
  const lifecycleReference = await acquireLifecycleReference(
    block,
    cacheKey,
    client,
    options,
  );
  if (lifecycleReference !== undefined) {
    await holdLease(lifecycleReference.lease, options);
    return { block, fileId: lifecycleReference.fileId, failed: false };
  }
  const cached = hasLifecycleConfiguration(options)
    ? undefined
    : cache?.get(cacheKey);
  if (cached !== undefined) {
    logger.debug(() => `Reusing cached Kimi file id ${cached} for block`);
    return { block, fileId: cached, failed: false };
  }

  const filename = resolveFilename(block);
  let uploaded: UploadedKimiFile;
  try {
    const file = await toFile(decodeMediaToBuffer(block), filename, {
      type: block.mimeType,
    });
    const purpose =
      category === 'video' ? KIMI_VIDEO_PURPOSE : KIMI_FILE_EXTRACT_PURPOSE;
    uploaded = await client.files.create({ file, purpose });
  } catch (error) {
    throw new Error(
      `Kimi file upload failed for ${filename} (${block.mimeType}): ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
  logger.debug(
    () => `Uploaded Kimi file ${uploaded.id} (${uploaded.bytes} bytes)`,
  );
  await retainUploadedFile(client, block, cacheKey, uploaded, cache, options);
  return { block, fileId: uploaded.id, failed: false };
}

export async function uploadKimiFiles(
  client: OpenAI,
  blocks: MediaBlock[],
  cache?: BoundedCache<string>,
  options: KimiUploadOptions = {},
): Promise<KimiFileUploadResult[]> {
  const results: KimiFileUploadResult[] = [];
  for (const block of blocks) {
    results.push(await uploadKimiFile(client, block, cache, options));
  }
  return results;
}

/**
 * Build the system-message text fragment that references a set of uploaded
 * Kimi file ids, following Moonshot's documented file-based Q&A pattern.
 */
export function buildKimiFileReferenceText(fileIds: string[]): string {
  if (fileIds.length === 0) {
    return '';
  }
  const list = fileIds.map((id) => `- ${id}`).join('\n');
  return `[Uploaded files available for reference via Kimi file-extract]\n${list}`;
}
