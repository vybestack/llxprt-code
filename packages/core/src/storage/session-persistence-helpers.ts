/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '../services/history/IContent.js';
import { MediaAdmissionError } from './media-admission-service.js';
import { MediaReferenceValidationError } from './media-reference-lifecycle.js';
import type {
  PersistedSession,
  PersistedUIHistoryItem,
} from './SessionPersistenceService.js';

const MAX_MEDIA_DIAGNOSTIC_DEPTH = 32;

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null
    ? Reflect.get(error, 'code')
    : undefined;
}

export function containsMediaDiagnostic(
  error: unknown,
  seen: Set<object> = new Set<object>(),
  depth = 0,
): boolean {
  if (
    error instanceof MediaReferenceValidationError ||
    error instanceof MediaAdmissionError
  ) {
    return true;
  }
  if (
    depth >= MAX_MEDIA_DIAGNOSTIC_DEPTH ||
    typeof error !== 'object' ||
    error === null ||
    seen.has(error)
  ) {
    return false;
  }
  seen.add(error);
  const nested = Reflect.get(error, 'errors');
  return (
    (isUnknownArray(nested) &&
      nested.some((entry) =>
        containsMediaDiagnostic(entry, seen, depth + 1),
      )) ||
    containsMediaDiagnostic(Reflect.get(error, 'cause'), seen, depth + 1)
  );
}

function serializedStringContentLowerBound(
  value: unknown,
  visited: Set<object>,
): number {
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8');
  if (typeof value !== 'object' || value === null || visited.has(value)) {
    return 0;
  }
  visited.add(value);
  return Object.values(value).reduce(
    (bytes, nested) =>
      Math.min(
        Number.MAX_SAFE_INTEGER,
        bytes + serializedStringContentLowerBound(nested, visited),
      ),
    0,
  );
}

export function persistenceRequestLowerBound(
  history: readonly IContent[],
  metadata: PersistedSession['metadata'] | undefined,
  uiHistory: readonly PersistedUIHistoryItem[] | undefined,
): number {
  return serializedStringContentLowerBound(
    [history, metadata, uiHistory],
    new Set<object>(),
  );
}
