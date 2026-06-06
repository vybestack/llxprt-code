/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core-owned media classification helper used by compression.
 *
 * This duplicates only the runtime classification that core needs so core does
 * not import provider utility implementations after provider extraction.
 *
 * @plan:PLAN-20260603-ISSUE1584.P11
 * @requirement:REQ-DEP-001
 * @requirement:REQ-SHIM-001
 */

import type { MediaBlock } from '../services/history/IContent.js';

export type MediaCategory = 'image' | 'pdf' | 'audio' | 'video' | 'unknown';

export function classifyMediaBlock(media: MediaBlock): MediaCategory {
  const mime = media.mimeType.toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'unknown';
}
