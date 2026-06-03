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

import type { MediaBlock } from '../../services/history/IContent.js';

export type MediaCategory = 'image' | 'pdf' | 'audio' | 'video' | 'unknown';

export function classifyMediaBlock(media: MediaBlock): MediaCategory {
  const mime = media.mimeType.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'unknown';
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
