/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type OpenAI from 'openai';
import { toFile } from 'openai';
import { createHash, createHmac } from 'node:crypto';
import type { MediaBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { classifyMediaBlock } from '../utils/mediaUtils.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/index.js';

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
 * On success `fileId` is populated; on failure `failed` is true and the
 * caller should fall back to the existing inline/placeholder behavior.
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
function buildCacheKey(client: OpenAI, block: MediaBlock): string {
  const hash = createHash('sha256');
  const credentialToken = createHmac('sha256', client.apiKey)
    .update(CACHE_KEY_CREDENTIAL_LABEL)
    .digest('hex');
  hash.update(client.baseURL);
  hash.update('\0');
  hash.update(credentialToken);
  hash.update('\0');
  hash.update(block.mimeType);
  hash.update('\0');
  hash.update(block.data);
  return hash.digest('hex');
}

/**
 * Convert a base64 data URI (or raw base64) from a {@link MediaBlock} into a
 * binary Buffer, stripping any `data:...;base64,` prefix that may be present.
 */
function decodeMediaToBuffer(block: MediaBlock): Buffer {
  if (block.encoding === 'url') {
    throw new Error(
      "Cannot decode media block with encoding 'url' as base64 buffer",
    );
  }
  const raw = block.data;
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
 * - On per-block failure, marks the block as `failed` so the caller can fall
 *   back to the existing inline/placeholder behavior rather than aborting the
 *   whole request.
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

export async function uploadKimiFiles(
  client: OpenAI,
  blocks: MediaBlock[],
  cache?: BoundedCache<string>,
  options: KimiUploadOptions = {},
): Promise<KimiFileUploadResult[]> {
  const results: KimiFileUploadResult[] = [];

  // Uploads are sequential because Kimi applies Files API rate limits during
  // peak periods. Preserving the input loop also preserves the result order.
  for (const block of blocks) {
    const category = classifyMediaBlock(block);
    if (!isKimiUploadable(block, options)) {
      results.push({ block, failed: true });
      continue;
    }

    const cacheKey = buildCacheKey(client, block);
    const cached = cache?.get(cacheKey);
    if (cached) {
      logger.debug(() => `Reusing cached Kimi file id ${cached} for block`);
      results.push({ block, fileId: cached, failed: false });
    } else {
      const filename = resolveFilename(block);
      try {
        const buffer = decodeMediaToBuffer(block);
        const file = await toFile(buffer, filename, {
          type: block.mimeType,
        });

        const purpose =
          category === 'video' ? KIMI_VIDEO_PURPOSE : KIMI_FILE_EXTRACT_PURPOSE;
        const uploaded = await client.files.create({ file, purpose });
        logger.debug(
          () => `Uploaded Kimi file ${uploaded.id} (${uploaded.bytes} bytes)`,
        );
        cache?.set(cacheKey, uploaded.id);
        results.push({ block, fileId: uploaded.id, failed: false });
      } catch (error) {
        logger.warn(
          () =>
            `Kimi file upload failed for ${filename} (${block.mimeType}), falling back to inline behavior: ${
              error instanceof Error ? error.message : String(error)
            }`,
        );
        results.push({ block, failed: true });
      }
    }
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
