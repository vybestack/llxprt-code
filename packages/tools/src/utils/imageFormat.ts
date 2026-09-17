/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';

import sharp from 'sharp';
import { decodeBmpToRawRgb } from './bmpDecoder.js';
import { debugLogger } from './debugLogger.js';
import { resizeImageIfNeeded, type ImageResizePolicy } from './imageResize.js';

/**
 * Inline image formats every vision-capable endpoint we ship accepts
 * (zai, native Anthropic, OpenAI). Bytes with any other image mime must be
 * transcoded before they reach a request body (#3693).
 */
export const VISION_SUPPORTED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

const PNG_MIME_TYPE = 'image/png';
const BMP_MIME_TYPE = 'image/bmp';

async function encodeRawRgbAsPng(image: {
  width: number;
  height: number;
  data: Buffer;
}): Promise<Buffer> {
  return sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: 3 },
  })
    .png()
    .toBuffer();
}

/**
 * Normalize an image read through the file tools to a vision-supported
 * format (#3693): bytes whose mime is outside the supported set are
 * transcoded to PNG; supported mimes return the original buffer untouched so
 * passthrough stays byte-identical (no re-encode, animations preserved).
 *
 * BMP is decoded by the bundled BI_RGB decoder because sharp's prebuilt
 * libvips has no BMP input loader; every other unsupported mime goes through
 * sharp directly.
 *
 * Returns `null` when the bytes cannot be decoded. Callers degrade such files
 * to the binary placeholder path — the bytes matched an image signature but
 * are not decodable image data, so they must never be forwarded raw.
 */
export async function transcodeImageToSupportedFormat(
  content: Buffer,
  mimeType: string,
): Promise<Buffer | null> {
  if (VISION_SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
    return content;
  }
  try {
    if (mimeType === BMP_MIME_TYPE) {
      const raw = decodeBmpToRawRgb(content);
      if (raw === null) {
        return null;
      }
      return await encodeRawRgbAsPng(raw);
    }
    return await sharp(content, { failOn: 'warning' }).png().toBuffer();
  } catch {
    return null;
  }
}

export interface NormalizedReadImage {
  readonly buffer: Buffer;
  readonly mimeType: string;
  /** Pre-resize source bytes; equals `buffer` when no resize was applied. */
  readonly resizeSource: Buffer;
}

/**
 * Full ingest normalization for a file-tools image read (#3693): transcode to
 * a vision-supported format, then apply the resize policy to the normalized
 * bytes. Returns `null` when the bytes are undecodable — callers degrade such
 * files to the binary placeholder path.
 */
export async function normalizeImageForRead(
  content: Buffer,
  mimeType: string,
  displayName: string,
  resizePolicy: ImageResizePolicy | undefined,
): Promise<NormalizedReadImage | null> {
  const transcoded = await transcodeImageToSupportedFormat(content, mimeType);
  if (transcoded === null) {
    return null;
  }
  const passthrough = transcoded === content;
  const normalizedMimeType = passthrough ? mimeType : PNG_MIME_TYPE;
  const source = passthrough ? content : transcoded;
  const buffer = await resizeImageIfNeeded(
    source,
    normalizedMimeType,
    displayName,
    resizePolicy,
  );
  return { buffer, mimeType: normalizedMimeType, resizeSource: source };
}

// --- Media magic-byte signatures --------------------------------------------
// Before trusting an extension-derived media mime we verify the file's actual
// bytes against known magic-number signatures. This prevents text/source files
// whose extension collides with a media mime (e.g. .fh -> image/x-freehand,
// .ts -> video/mp2t) from being misclassified and sent as base64 media, which
// causes provider 400 errors. Files whose signature does not verify fall
// through to the content sniff; the check reads only the leading bytes and
// costs sub-ms / sub-KB, so no caching is needed. Lives here (not fileUtils)
// with the rest of the ingest format logic (#3693).

interface BytePattern {
  readonly offset: number;
  readonly bytes: readonly number[];
}

type MediaSignature = readonly BytePattern[];

const IMAGE_SIGNATURES: readonly MediaSignature[] = [
  [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }],
  [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
  [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }],
  [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }],
  [{ offset: 0, bytes: [0x42, 0x4d] }],
  [{ offset: 0, bytes: [0x49, 0x49, 0x2a, 0x00] }],
  [{ offset: 0, bytes: [0x4d, 0x4d, 0x00, 0x2a] }],
  [{ offset: 0, bytes: [0x00, 0x00, 0x01, 0x00] }],
  [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
  ],
  [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }],
];

const AUDIO_SIGNATURES: readonly MediaSignature[] = [
  [{ offset: 0, bytes: [0x49, 0x44, 0x33] }],
  [{ offset: 0, bytes: [0xff, 0xfb] }],
  [{ offset: 0, bytes: [0xff, 0xfa] }],
  [{ offset: 0, bytes: [0xff, 0xf3] }],
  [{ offset: 0, bytes: [0xff, 0xf2] }],
  [{ offset: 0, bytes: [0xff, 0xe3] }],
  [{ offset: 0, bytes: [0xff, 0xe2] }],
  [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { offset: 8, bytes: [0x57, 0x41, 0x56, 0x45] },
  ],
  [{ offset: 0, bytes: [0x66, 0x4c, 0x61, 0x43] }],
  [{ offset: 0, bytes: [0x4f, 0x67, 0x67, 0x53] }],
  [{ offset: 0, bytes: [0xff, 0xf1] }],
  [{ offset: 0, bytes: [0xff, 0xf9] }],
  [{ offset: 0, bytes: [0xff, 0xf0] }],
  [{ offset: 0, bytes: [0xff, 0xf8] }],
  [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }],
  [{ offset: 0, bytes: [0x4d, 0x54, 0x68, 0x64] }],
  [
    { offset: 0, bytes: [0x46, 0x4f, 0x52, 0x4d] },
    { offset: 8, bytes: [0x41, 0x49, 0x46, 0x46] },
  ],
];

const VIDEO_SIGNATURES: readonly MediaSignature[] = [
  [{ offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] }],
  [
    { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
    { offset: 8, bytes: [0x41, 0x56, 0x49, 0x20] },
  ],
  [{ offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] }],
  [
    { offset: 0, bytes: [0x47] },
    { offset: 188, bytes: [0x47] },
  ],
];

const PDF_SIGNATURES: readonly MediaSignature[] = [
  [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }],
];

interface MediaCategory {
  readonly type: 'image' | 'audio' | 'video' | 'pdf';
  readonly signatures: readonly MediaSignature[];
}

export function resolveMediaCategory(mimeType: string): MediaCategory | null {
  if (mimeType.startsWith('image/')) {
    return { type: 'image', signatures: IMAGE_SIGNATURES };
  }
  if (mimeType.startsWith('audio/')) {
    return { type: 'audio', signatures: AUDIO_SIGNATURES };
  }
  if (mimeType.startsWith('video/')) {
    return { type: 'video', signatures: VIDEO_SIGNATURES };
  }
  if (mimeType === 'application/pdf') {
    return { type: 'pdf', signatures: PDF_SIGNATURES };
  }
  return null;
}

function headerMatches(
  header: Buffer,
  signatures: readonly MediaSignature[],
): boolean {
  return signatures.some((sig) =>
    sig.every(({ offset, bytes }) => {
      if (offset + bytes.length > header.length) return false;
      return bytes.every((b, i) => header[offset + i] === b);
    }),
  );
}

export async function verifyMediaSignature(
  filePath: string,
  signatures: readonly MediaSignature[],
): Promise<boolean> {
  let fh: fs.promises.FileHandle | null = null;
  try {
    fh = await fs.promises.open(filePath, 'r');
    const buf = Buffer.alloc(512);
    const { bytesRead } = await fh.read(buf, 0, 512, 0);
    const header = buf.subarray(0, bytesRead);
    if (header.length === 0) return false;
    return headerMatches(header, signatures);
  } catch (error) {
    debugLogger.warn(
      `Failed to verify media signature for: ${filePath}`,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  } finally {
    if (fh) {
      try {
        await fh.close();
      } catch {
        // ignore close errors
      }
    }
  }
}
