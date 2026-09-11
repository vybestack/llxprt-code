/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ImageValidationError } from '@vybestack/llxprt-code-core/services/image/ImageGenerationService.js';

const MAX_INPUT_IMAGE_BYTES = 20 * 1024 * 1024;

export const PNG_SIGNATURE_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

const JPEG_SIGNATURE_BYTES_PREFIX = Buffer.from([0xff, 0xd8, 0xff]);

const WEBP_SIGNATURE_BYTES = Buffer.from([
  0x52,
  0x49,
  0x46,
  0x46, // "RIFF"
]);

const WEBP_FOURCC_BYTES = Buffer.from([0x57, 0x45, 0x42, 0x50]); // "WEBP"

/**
 * Read an input image from the filesystem, validate it (no URLs, no escaping
 * symlinks, valid image signature, bounded size), and return bytes with MIME.
 *
 * Never logs the image bytes.
 */
export async function readInputImage(
  inputPath: string,
): Promise<{ readonly bytes: Buffer; readonly mimeType: string }> {
  // Reject URLs — only local file inputs are supported initially.
  if (/^https?:\/\//i.test(inputPath) || /^file:\/\//i.test(inputPath)) {
    throw new ImageValidationError(
      `Remote URL input images are not supported: ${inputPath}. Use a local workspace file.`,
    );
  }

  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');

  // Reject symlinks before reading.
  let bytes: Buffer;
  try {
    const stat = await fs.lstat(inputPath);
    if (stat.isSymbolicLink()) {
      throw new ImageValidationError(
        `Input image is a symbolic link and cannot be used safely: ${inputPath}.`,
      );
    }
    if (!stat.isFile()) {
      throw new ImageValidationError(
        `Input image is not a regular file: ${inputPath}.`,
      );
    }
    if (stat.size > MAX_INPUT_IMAGE_BYTES) {
      throw new ImageValidationError(
        `Input image exceeds the maximum size: ${inputPath}.`,
      );
    }
    bytes = await fs.readFile(inputPath);
  } catch (error) {
    if (error instanceof ImageValidationError) {
      throw error;
    }
    throw new ImageValidationError(
      `Input image could not be accessed: ${inputPath}.`,
    );
  }

  // Validate the image signature by extension and magic bytes.
  const ext = path.extname(inputPath).toLowerCase();
  const mimeType = detectImageMimeType(ext, bytes);
  if (mimeType === null) {
    throw new ImageValidationError(
      `Input image has an unsupported or unrecognized format: ${inputPath}.`,
    );
  }

  return { bytes, mimeType };
}

function detectImageMimeType(ext: string, bytes: Buffer): string | null {
  if (ext === '.png') {
    if (
      bytes.length >= PNG_SIGNATURE_BYTES.length &&
      bytes.subarray(0, PNG_SIGNATURE_BYTES.length).equals(PNG_SIGNATURE_BYTES)
    ) {
      return 'image/png';
    }
    return null;
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    if (
      bytes.length >= 3 &&
      bytes.subarray(0, 3).equals(JPEG_SIGNATURE_BYTES_PREFIX)
    ) {
      return 'image/jpeg';
    }
    return null;
  }
  if (ext === '.webp') {
    // Verify BOTH the RIFF container prefix AND the WEBP fourCC at byte
    // offset 8, so a RIFF file that is NOT WebP (e.g. WAV/AVI renamed .webp)
    // is rejected instead of being misclassified as image/webp.
    if (
      bytes.length >= WEBP_SIGNATURE_BYTES.length &&
      bytes
        .subarray(0, WEBP_SIGNATURE_BYTES.length)
        .equals(WEBP_SIGNATURE_BYTES)
    ) {
      const fourccStart = WEBP_SIGNATURE_BYTES.length + 4; // skip RIFF(4) + size(4)
      if (
        bytes.length >= fourccStart + WEBP_FOURCC_BYTES.length &&
        bytes
          .subarray(fourccStart, fourccStart + WEBP_FOURCC_BYTES.length)
          .equals(WEBP_FOURCC_BYTES)
      ) {
        return 'image/webp';
      }
    }
    return null;
  }
  return null;
}
