/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type OpenAI from 'openai';
import { toFile } from 'openai';
import { createHash } from 'node:crypto';
import type { MediaBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { classifyMediaBlock } from '../utils/mediaUtils.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

const logger = new DebugLogger('llxprt:kimi:fileUpload');

/**
 * Kimi's Files API uses purpose `"file-extract"` for document extraction,
 * which is not in the OpenAI SDK's FilePurpose union
 * (`'assistants' | 'batch' | ...`). This alias narrows the cast to a single
 * well-documented location rather than spreading it through the call site.
 */
type SdkFilePurpose = Parameters<OpenAI['files']['create']>[0]['purpose'];
const KIMI_FILE_EXTRACT_PURPOSE = 'file-extract' as unknown as SdkFilePurpose;

/**
 * A simple bounded LRU-ish cache backed by a Map. When the max size is reached,
 * the oldest inserted entry (Map iteration order) is evicted before inserting
 * a new one. This prevents unbounded memory growth in long-running processes.
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
  const map = new Map<string, V>();
  return {
    get(key: string) {
      return map.get(key);
    },
    set(key: string, value: V) {
      if (map.size >= maxSize && !map.has(key)) {
        const oldestKey = map.keys().next().value;
        if (oldestKey !== undefined) {
          map.delete(oldestKey);
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
 * Build a stable cache key from a media block's content so that repeated
 * turns referencing the same document are not re-uploaded.
 *
 * Uses length + bounded prefix/suffix hashing instead of hashing the entire
 * base64 payload, which can be many megabytes for large PDFs. This keeps the
 * event loop responsive while still producing a collision-resistant key for
 * the common case of identical documents reappearing across turns.
 */
const BOUNDED_HASH_SLICE = 512;
function buildCacheKey(block: MediaBlock): string {
  const mime = block.mimeType;
  const raw = block.data;
  const hash = createHash('sha256');
  hash.update(`${mime}:${raw.length}:`);
  if (raw.length <= BOUNDED_HASH_SLICE * 2) {
    hash.update(raw);
  } else {
    hash.update(raw.slice(0, BOUNDED_HASH_SLICE));
    hash.update(raw.slice(-BOUNDED_HASH_SLICE));
  }
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
export async function uploadKimiFiles(
  client: OpenAI,
  blocks: MediaBlock[],
  cache?: BoundedCache<string>,
): Promise<KimiFileUploadResult[]> {
  const results: KimiFileUploadResult[] = [];

  // Partition blocks: only base64-encoded PDFs are uploadable. Non-PDF or
  // URL-encoded blocks are immediately marked as failed so the upload loop
  // has a single continue (cache-hit) path.
  const uploadable: MediaBlock[] = [];
  for (const block of blocks) {
    if (block.encoding === 'url' || classifyMediaBlock(block) !== 'pdf') {
      results.push({ block, failed: true });
    } else {
      uploadable.push(block);
    }
  }

  // Uploads are sequential rather than parallel because Kimi's Files API
  // applies rate limiting during peak periods (per issue #1679). Parallel
  // uploads risk triggering 429s that would fail the entire batch.
  for (const block of uploadable) {
    const cacheKey = buildCacheKey(block);

    if (cache) {
      const cached = cache.get(cacheKey);
      if (cached) {
        logger.debug(() => `Reusing cached Kimi file id ${cached} for block`);
        results.push({ block, fileId: cached, failed: false });
        continue;
      }
    }

    try {
      const buffer = decodeMediaToBuffer(block);
      const filename = resolveFilename(block);
      const file = await toFile(buffer, filename, {
        type: block.mimeType,
      });

      // Kimi's Files API uses purpose "file-extract" (not in the SDK union).
      const body = {
        file,
        purpose: KIMI_FILE_EXTRACT_PURPOSE,
      };

      const uploaded = await client.files.create(body);
      logger.debug(
        () => `Uploaded Kimi file ${uploaded.id} (${uploaded.bytes} bytes)`,
      );

      if (cache) {
        cache.set(cacheKey, uploaded.id);
      }

      results.push({ block, fileId: uploaded.id, failed: false });
    } catch (error) {
      logger.warn(
        () =>
          `Kimi file upload failed, falling back to inline behavior: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
      results.push({ block, failed: true });
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
