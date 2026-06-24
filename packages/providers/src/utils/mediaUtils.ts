/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { MediaBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export type MediaCategory = 'image' | 'pdf' | 'audio' | 'video' | 'unknown';

export function classifyMediaBlock(media: MediaBlock): MediaCategory {
  const mime = media.mimeType.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'unknown';
}

const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47];
const JPEG_SIGNATURE: readonly number[] = [0xff, 0xd8, 0xff];
const GIF_SIGNATURE: readonly number[] = [0x47, 0x49, 0x46, 0x38];
const RIFF_SIGNATURE: readonly number[] = [0x52, 0x49, 0x46, 0x46];
const WEBP_TAG: readonly number[] = [0x57, 0x45, 0x42, 0x50];

function bytesStartWith(
  bytes: Uint8Array,
  signature: readonly number[],
  offset: number,
): boolean {
  if (bytes.length < offset + signature.length) {
    return false;
  }
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) {
      return false;
    }
  }
  return true;
}

export function detectImageMimeTypeFromBase64(
  base64Data: string,
): string | null {
  if (typeof base64Data !== 'string' || base64Data.trim() === '') {
    return null;
  }
  let bytes: Uint8Array;
  try {
    const normalized = base64Data.replace(/\s/g, '');
    bytes = Buffer.from(normalized.slice(0, 24), 'base64');
  } catch {
    return null;
  }
  if (bytesStartWith(bytes, PNG_SIGNATURE, 0)) {
    return 'image/png';
  }
  if (bytesStartWith(bytes, JPEG_SIGNATURE, 0)) {
    return 'image/jpeg';
  }
  if (bytesStartWith(bytes, GIF_SIGNATURE, 0)) {
    return 'image/gif';
  }
  if (
    bytesStartWith(bytes, RIFF_SIGNATURE, 0) &&
    bytesStartWith(bytes, WEBP_TAG, 8)
  ) {
    return 'image/webp';
  }
  return null;
}

export function buildUnsupportedMediaPlaceholder(
  media: MediaBlock,
  providerName: string,
): string {
  const mime = media.mimeType || 'unknown';
  const filePart = media.filename ? ` (${media.filename})` : '';
  const category = classifyMediaBlock(media);
  const label = getMediaLabel(category);
  return `[Unsupported ${label}: ${mime}${filePart} — ${providerName} does not support ${label} input]`;
}

/**
 * Get human-readable label for media category.
 */
function getMediaLabel(category: string): string {
  if (category === 'pdf') return 'PDF';
  if (category === 'unknown') return 'media';
  return category;
}

/**
 * Normalizes a MediaBlock to a data URI format suitable for API consumption.
 * Handles both URL-encoded and base64-encoded media.
 */
export function normalizeMediaToDataUri(media: MediaBlock): string {
  // Already a data URI
  if (media.data.startsWith('data:')) {
    return media.data;
  }

  // URL encoding (e.g., https://example.com/image.png)
  if (media.encoding === 'url') {
    return media.data;
  }

  // Base64 encoding - construct data URI
  const prefix = media.mimeType
    ? `data:${media.mimeType};base64,`
    : 'data:image/*;base64,';
  return `${prefix}${media.data}`;
}
