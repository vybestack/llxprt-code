/**
 * @plan:PLAN-20260608-ISSUE1585.P05
 * @requirement:REQ-API-001, REQ-TEMPORARY-INTERFACES
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Package-local media classification utilities.
 *
 * Provides media block classification using a package-local MediaBlock
 * type instead of importing from core. Self-contained with zero core imports.
 */

/** Package-local media block representation. */
export interface MediaBlock {
  /** Media block discriminator. */
  type?: 'media';
  /** MIME type of the media. */
  mimeType: string;
  /** Base64-encoded data or URL. */
  data?: string;
  /** Whether data is a URL or base64. */
  encoding?: 'url' | 'base64';
  /** Optional caption or alt text. */
  caption?: string;
  /** Original filename if applicable. */
  filename?: string;
}

/** Category of media content. */
export type MediaCategory = 'image' | 'pdf' | 'audio' | 'video' | 'unknown';

/**
 * Classifies a media block by its MIME type.
 * @param media - The media block to classify.
 * @returns The media category.
 */
export function classifyMediaBlock(media: MediaBlock): MediaCategory {
  const mime = media.mimeType.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'unknown';
}
