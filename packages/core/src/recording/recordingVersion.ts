/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SessionEventType } from './types.js';

function containsMediaReference(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (
    Reflect.get(value, 'type') === 'media' &&
    Reflect.get(value, 'encoding') === 'reference'
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsMediaReference(entry, seen));
  }
  return Reflect.ownKeys(value).some((key) =>
    containsMediaReference(Reflect.get(value, key), seen),
  );
}

function recordingVersion(payload: unknown): number {
  return containsMediaReference(payload) ? 2 : 1;
}

/**
 * Recording line version: media references need version 2 readers, and a
 * semantic media purge is always version 2.
 */
export function recordLineVersion(
  type: SessionEventType,
  payload: unknown,
): number {
  if (type === 'semantic_media_purge') return 2;
  return recordingVersion(payload);
}
