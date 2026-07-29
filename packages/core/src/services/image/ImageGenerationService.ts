/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Backend-neutral image generation service contract.
 *
 * This module defines the request/result/error types, the backend capability
 * interface, and a pure prompt-validation helper. It deliberately contains NO
 * implementation, NO fetch, and NO concrete backend — concrete backends (e.g.
 * the Codex OAuth adapter) live in `@vybestack/llxprt-code-providers` and
 * implement {@link ImageGenerationBackend}.
 */

/**
 * Request to generate one or more images.
 *
 * Mirrors the Codex `gpt-image-2` generate endpoint shape; backend-neutral so
 * future backends (OpenRouter, LM Studio, local models) can reuse it.
 */
export interface ImageGenerateRequest {
  readonly prompt: string;
  readonly model?: string;
  readonly background?: 'auto' | 'transparent' | 'opaque';
  readonly quality?: 'auto' | 'high' | 'medium' | 'low';
  readonly size?: 'auto' | '1024x1024' | '1024x1536' | '1536x1024';
  readonly n?: number;
  readonly sessionId?: string;
}

/**
 * A normalized image-generation result.
 *
 * `encoding` distinguishes inline base64 from a URL reference. The Codex
 * generate endpoint returns `b64_json`, so the first adapter normalizes to
 * `encoding: 'base64'`.
 */
export interface ImageResult {
  readonly mimeType: string;
  readonly encoding: 'base64' | 'url';
  readonly data: string;
  readonly caption?: string;
  readonly revisedPrompt?: string;
}

/**
 * Error thrown by image backends on non-2xx HTTP responses or missing payload.
 *
 * Carries diagnostic context (status, endpoint, truncated body) so callers can
 * surface a useful message without leaking the entire response body.
 */
export class ImageGenerationError extends Error {
  readonly status?: number;
  readonly endpoint?: string;
  readonly bodySnippet?: string;

  constructor(
    message: string,
    options?: {
      readonly status?: number;
      readonly endpoint?: string;
      readonly bodySnippet?: string;
      readonly cause?: unknown;
    },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'ImageGenerationError';
    if (options?.status !== undefined) {
      this.status = options.status;
    }
    if (options?.endpoint !== undefined) {
      this.endpoint = options.endpoint;
    }
    if (options?.bodySnippet !== undefined) {
      this.bodySnippet = options.bodySnippet;
    }
  }
}

/**
 * Error thrown when an image-generation request fails input validation.
 */
export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageValidationError';
  }
}

/**
 * A single image-generation backend (e.g. Codex OAuth).
 *
 * Backends own transport details (auth, endpoint, fetch, error mapping) and
 * expose a uniform `generate` capability. The capability interface keeps the
 * service and tool decoupled from any specific provider.
 */
export interface ImageGenerationBackend {
  readonly name: string;
  generate(
    request: ImageGenerateRequest,
    signal: AbortSignal,
  ): Promise<ImageResult>;
}

/**
 * The application-level image-generation service.
 *
 * A concrete service composes one or more {@link ImageGenerationBackend}s;
 * this interface is the contract consumers depend on.
 */
export interface ImageGenerationService {
  generate(
    request: ImageGenerateRequest,
    signal: AbortSignal,
  ): Promise<ImageResult>;
}

/**
 * Validate that a prompt is non-empty after trimming whitespace.
 *
 * Throws {@link ImageValidationError} for empty or whitespace-only prompts so
 * that callers can reject invalid input before any network call.
 */
export function validateImagePrompt(prompt: string): void {
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new ImageValidationError(
      'Image generation prompt must not be empty or whitespace-only.',
    );
  }
}

/**
 * Error thrown when persisting a generated image to the workspace fails.
 */
export class ImagePersistenceError extends Error {
  constructor(message: string, options?: { readonly cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = 'ImagePersistenceError';
  }
}

const PERSIST_DIR_NAME = 'generated-images';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const STANDARD_BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Set of bytes allowed in canonical (standard-alphabet, padded) base64.
 * Membership is checked via direct indexing (no regex backtracking).
 */
const BASE64_VALID_BYTES = (() => {
  const set = new Uint8Array(256);
  for (let i = 0; i < STANDARD_BASE64_ALPHABET.length; i++) {
    set[STANDARD_BASE64_ALPHABET.charCodeAt(i)] = 1;
  }
  // '=' (0x3d) is allowed only as terminal padding, validated separately.
  set[0x3d] = 1;
  return set;
})();

const PNG_IEND_TYPE = Buffer.from([0x49, 0x45, 0x4e, 0x44]); // "IEND"
const PNG_IHDR_TYPE = Buffer.from([0x49, 0x48, 0x44, 0x52]); // "IHDR"

// PNG CRC-32 table (IEEE 802.3, reflected, init/final xor 0xffffffff).
const PNG_CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function pngCrc32(buf: Buffer): number {
  let crc = 0xff_ff_ff_ff;
  for (let i = 0; i < buf.length; i++) {
    crc = PNG_CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

/**
 * Strictly validate a canonical standard-alphabet base64 string and decode it.
 *
 * Rejects:
 *  - empty input;
 *  - characters outside the standard alphabet (no URL-safe, no whitespace);
 *  - missing or incorrect padding (`=` padding is required so the total
 *    length is a multiple of 4);
 *  - trailing characters after a fully-padded group (e.g. `XXXX` appended to
 *    valid data);
 *  - stray padding in the middle of the data.
 *
 * Validation uses explicit character/padding checks (no backtracking regex).
 * Decoding relies on `Buffer.from(..., 'base64')` only after the input is
 * confirmed canonical, and a round-trip equality check
 * (`bytes.toString('base64') === input`) rejects anything Node's permissive
 * decoder would have silently accepted (e.g. truncation, re-canonicalization).
 */
function strictBase64Decode(input: string): Buffer {
  if (typeof input !== 'string') {
    throw new ImagePersistenceError('Image result data must be a string.');
  }
  if (input.length === 0) {
    throw new ImagePersistenceError('Image result data is empty.');
  }
  if (input.length % 4 !== 0) {
    throw new ImagePersistenceError(
      'Image result data is not valid base64: length is not a multiple of 4.',
    );
  }

  const paddingStart = input.indexOf('=');
  if (paddingStart !== -1) {
    // Padding may only occupy the final 1 or 2 positions of the last group;
    // any '=' before that, or more than two, is invalid.
    const padCount = input.length - paddingStart;
    if (padCount > 2) {
      throw new ImagePersistenceError(
        'Image result data is not valid base64: excessive padding.',
      );
    }
    for (let i = paddingStart; i < input.length; i++) {
      if (input.charCodeAt(i) !== 0x3d) {
        // '='
        throw new ImagePersistenceError(
          'Image result data is not valid base64: non-padding character after padding.',
        );
      }
    }
  }

  // Validate every byte is in the standard alphabet (or terminal padding,
  // already confirmed to be terminal above).
  for (let i = 0; i < input.length; i++) {
    if (BASE64_VALID_BYTES[input.charCodeAt(i)] !== 1) {
      throw new ImagePersistenceError(
        'Image result data is not valid base64: invalid character.',
      );
    }
  }

  // Decode and require an exact round-trip. Node's base64 decoder is
  // permissive (it ignores trailing junk and missing padding); the equality
  // check turns that into a strict canonical acceptance test.
  const bytes = Buffer.from(input, 'base64');
  if (bytes.toString('base64') !== input) {
    throw new ImagePersistenceError(
      'Image result data is not valid canonical base64.',
    );
  }

  return bytes;
}

/**
 * Validate the structural integrity of a PNG byte buffer beyond the signature.
 *
 * Requires:
 *  - the 8-byte PNG signature;
 *  - the first chunk to be IHDR with length exactly 13 and positive width/
 *    height;
 *  - a bounded sequence of well-formed chunks (valid length, valid CRC) that
 *    terminates with exactly one IEND;
 *  - no trailing bytes after IEND.
 *
 * Throws {@link ImagePersistenceError} on any structural violation.
 */
function validatePngStructure(bytes: Buffer): void {
  if (bytes.length < PNG_SIGNATURE.length) {
    throw new ImagePersistenceError(
      'Decoded image bytes are shorter than a valid PNG signature.',
    );
  }
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new ImagePersistenceError(
      'Decoded image bytes do not start with a valid PNG signature.',
    );
  }

  let offset = PNG_SIGNATURE.length;
  let sawIhdr = false;
  let sawIend = false;

  while (offset < bytes.length) {
    if (sawIend) {
      throw new ImagePersistenceError(
        'PNG has trailing bytes after the IEND chunk.',
      );
    }
    // Each chunk: 4 bytes length + 4 bytes type + data + 4 bytes CRC.
    if (offset + 8 > bytes.length) {
      throw new ImagePersistenceError('PNG chunk header is truncated.');
    }
    const dataLength = bytes.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = typeStart + 4;
    const crcStart = dataStart + dataLength;
    const chunkEnd = crcStart + 4;
    if (chunkEnd > bytes.length) {
      throw new ImagePersistenceError(
        'PNG chunk length exceeds the buffer bounds.',
      );
    }

    const type = bytes.subarray(typeStart, typeStart + 4);
    const isFirstChunk = !sawIhdr;
    if (isFirstChunk) {
      if (!type.equals(PNG_IHDR_TYPE)) {
        throw new ImagePersistenceError('PNG first chunk is not IHDR.');
      }
      if (dataLength !== 13) {
        throw new ImagePersistenceError(
          `PNG IHDR chunk length must be 13 (received ${dataLength}).`,
        );
      }
      const width = bytes.readUInt32BE(dataStart);
      const height = bytes.readUInt32BE(dataStart + 4);
      if (width === 0 || height === 0) {
        throw new ImagePersistenceError(
          'PNG IHDR dimensions must be positive.',
        );
      }
      sawIhdr = true;
    } else if (type.equals(PNG_IHDR_TYPE)) {
      throw new ImagePersistenceError('PNG contains more than one IHDR chunk.');
    }

    if (type.equals(PNG_IEND_TYPE) && dataLength !== 0) {
      throw new ImagePersistenceError('PNG IEND chunk must have zero length.');
    }

    // Validate the CRC over type + data.
    const crcRegion = bytes.subarray(typeStart, crcStart);
    const storedCrc = bytes.readUInt32BE(crcStart);
    const computedCrc = pngCrc32(crcRegion);
    if (storedCrc !== computedCrc) {
      throw new ImagePersistenceError(
        `PNG chunk has an invalid CRC (type=${type.toString('ascii')}).`,
      );
    }

    if (type.equals(PNG_IEND_TYPE)) {
      sawIend = true;
    }
    offset = chunkEnd;
  }

  if (!sawIhdr) {
    throw new ImagePersistenceError('PNG has no IHDR chunk.');
  }
  if (!sawIend) {
    throw new ImagePersistenceError('PNG has no IEND chunk.');
  }
}

async function resolveExistingPath(
  candidate: string,
  description: string,
): Promise<string> {
  try {
    return await fs.realpath(candidate);
  } catch (error) {
    throw new ImagePersistenceError(
      `Failed to resolve ${description}: ${candidate}.`,
      { cause: error },
    );
  }
}

/**
 * Cross-platform containment check: is `child` inside `parent` (after both
 * are resolved to real, absolute paths)? Uses path.relative so drive letters
 * and separators are handled correctly on Windows and POSIX.
 */
function isPathContained(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return (
    rel === '' ||
    (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  );
}

/**
 * Returns true if the path is a symbolic link or Windows reparse point.
 */
async function isSymlinkOrReparse(p: string): Promise<boolean> {
  try {
    const stat = await fs.lstat(p);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Persist a normalized base64 PNG {@link ImageResult} to the workspace.
 *
 * The result must be `image/png` with `encoding: 'base64'`. The base64 is
 * strictly validated (standard alphabet, correct padding, no trailing junk)
 * before decoding, and the decoded bytes must be a structurally valid PNG
 * (signature, IHDR first with length 13 and positive dimensions, well-formed
 * bounded chunks with valid CRCs, exactly one terminal IEND, no trailing
 * bytes).
 *
 * Output is written beneath a fixed `generated-images` directory inside
 * `workspaceRoot` using a generated opaque filename (no caller-supplied path
 * components). The resolved output directory is rejected if it is a symbolic
 * link / reparse point, and its real path is verified to be contained by the
 * real workspace root before any write — preventing symlink/junction escape.
 * Bytes are written to a same-directory temporary file with flag `wx` (no
 * clobber) and then renamed atomically; the temporary file is removed on
 * failure. Returns the absolute final file path.
 */
export async function persistBase64ImageResult(
  result: ImageResult,
  workspaceRoot: string,
): Promise<string> {
  if (result.mimeType !== 'image/png') {
    throw new ImagePersistenceError(
      `Only image/png results can be persisted, received "${result.mimeType}".`,
    );
  }
  if (result.encoding !== 'base64') {
    throw new ImagePersistenceError(
      `Only base64-encoded results can be persisted, received encoding "${result.encoding}".`,
    );
  }

  const bytes = strictBase64Decode(result.data);
  if (bytes.length === 0) {
    throw new ImagePersistenceError('Image result decoded to empty content.');
  }
  validatePngStructure(bytes);

  // Resolve the real workspace root so symlinked roots are canonicalized.
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const realWorkspaceRoot = await resolveExistingPath(
    resolvedWorkspaceRoot,
    'workspace root',
  );

  const dir = path.join(realWorkspaceRoot, PERSIST_DIR_NAME);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    throw new ImagePersistenceError(
      `Failed to create image output directory: ${dir}.`,
      { cause: error },
    );
  }

  // Reject if the output directory itself is a symlink/reparse point — it
  // could point outside the workspace. Then verify the real, resolved
  // directory is still contained by the real workspace root.
  if (await isSymlinkOrReparse(dir)) {
    throw new ImagePersistenceError(
      'Refusing to persist image: output directory is a symbolic link or reparse point.',
    );
  }
  const realDir = await resolveExistingPath(dir, 'output directory');
  if (!isPathContained(realWorkspaceRoot, realDir)) {
    throw new ImagePersistenceError(
      'Refusing to persist image: resolved output directory escapes the workspace root.',
    );
  }

  const id = crypto.randomBytes(8).toString('hex');
  const finalPath = path.join(dir, `image-${id}.png`);
  const tempPath = path.join(dir, `.image-${id}.png.tmp`);

  try {
    // 'wx' fails (EEXIST) if the temp file already exists — no clobbering.
    await fs.writeFile(tempPath, bytes, { flag: 'wx' });
    await fs.rename(tempPath, finalPath);
  } catch (err) {
    await fs.rm(tempPath, { force: true });
    throw new ImagePersistenceError(
      `Failed to persist generated image to ${finalPath}.`,
      { cause: err },
    );
  }

  return finalPath;
}
