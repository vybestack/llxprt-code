/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as acp from '@agentclientprotocol/sdk';

export interface LifecycleSession {
  readonly sessionId: string;
  readonly cwd: string;
  readonly updatedAt: string;
  readonly title?: string;
  /**
   * Immutable creation timestamp used for stable ordering (issue #1611).
   * Falls back to updatedAt for legacy sessions without a persisted createdAt.
   */
  readonly createdAt?: string;
}

/**
 * Self-contained, process-independent snapshot cursor (issue #1611).
 *
 * The cursor encodes the full (createdAt, sessionId) tuple of the last item on
 * the previous page so the next page can be computed from the cursor alone,
 * without any shared in-process state. The `v` field distinguishes v1 (legacy
 * updatedAt-based, unstable) from v2 (createdAt-based, immutable).
 */
interface CursorPayload {
  readonly v: 2;
  readonly cwd: string | null;
  readonly createdAt: string;
  readonly sessionId: string;
}

interface LegacyCursorPayload {
  readonly version: 1;
  readonly cwd: string | null;
  readonly updatedAt: string;
  readonly sessionId: string;
}

interface PaginationRequest {
  readonly cwd: string | null;
  readonly cursor: string | null;
}

interface PaginationResult {
  readonly sessions: readonly LifecycleSession[];
  readonly nextCursor?: string;
}

export function paginateSessions(
  sessions: readonly LifecycleSession[],
  request: PaginationRequest,
  pageSize: number,
): PaginationResult {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw acp.RequestError.invalidParams(
      { pageSize },
      'pageSize must be a positive integer',
    );
  }
  const cursor = decodeCursor(request.cursor, request.cwd);
  const ordered = [...sessions]
    .filter((session) => request.cwd === null || session.cwd === request.cwd)
    .sort(compareSessions);
  const remaining =
    cursor === null
      ? ordered
      : ordered.filter((session) => compareWithCursor(session, cursor) > 0);
  const page = remaining.slice(0, pageSize);
  if (remaining.length <= pageSize) {
    return { sessions: page };
  }
  const last = page.at(-1);
  if (last === undefined) {
    return { sessions: page };
  }
  return { sessions: page, nextCursor: encodeCursor(last, request.cwd) };
}

/**
 * Orders sessions by createdAt DESC then sessionId DESC.
 *
 * createdAt is the immutable session_start timestamp — it never changes when
 * a session is updated (issue #1611). Falls back to updatedAt when createdAt
 * is absent (legacy sessions recorded before this change) so they still sort
 * deterministically. Using updatedAt as a fallback is acceptable because legacy
 * sessions are static (no new writes), so their updatedAt is effectively
 * immutable too.
 */
function compareSessions(a: LifecycleSession, b: LifecycleSession): number {
  return compareByCreatedAtAndId(
    getCreatedAt(a),
    a.sessionId,
    getCreatedAt(b),
    b.sessionId,
  );
}

function compareWithCursor(
  session: LifecycleSession,
  cursor: CursorPayload,
): number {
  return compareByCreatedAtAndId(
    getCreatedAt(session),
    session.sessionId,
    cursor.createdAt,
    cursor.sessionId,
  );
}

function compareByCreatedAtAndId(
  aCreatedAt: string,
  aId: string,
  bCreatedAt: string,
  bId: string,
): number {
  const timestamp = compareDescending(aCreatedAt, bCreatedAt);
  return timestamp === 0 ? compareDescending(aId, bId) : timestamp;
}

function compareDescending(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a > b ? -1 : 1;
}

function getCreatedAt(session: LifecycleSession): string {
  const value = session.createdAt ?? session.updatedAt;
  const timestamp = Date.parse(value);
  if (Number.isFinite(timestamp)) {
    return new Date(timestamp).toISOString();
  }
  // Invalid or non-standard timestamp (corrupted/legacy data). Fall back to
  // the epoch sentinel so sort order is deterministic and cursor encoding
  // never embeds an invalid value that would break decode (issue #1611).
  return new Date(0).toISOString();
}

function encodeCursor(session: LifecycleSession, cwd: string | null): string {
  const payload: CursorPayload = {
    v: 2,
    cwd,
    createdAt: getCreatedAt(session),
    sessionId: session.sessionId,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodeCursor(
  cursor: string | null,
  cwd: string | null,
): CursorPayload | null {
  if (cursor === null) {
    return null;
  }
  let detail: string;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    const decoded = normalizeCursorPayload(value);
    if (decoded === null) {
      throw new Error('malformed cursor payload');
    }
    if (decoded.cwd !== cwd) {
      throw new Error('cursor cwd does not match request cwd');
    }
    return decoded;
  } catch (error) {
    detail = error instanceof Error ? error.message : 'invalid encoding';
  }
  throw acp.RequestError.invalidParams(
    { cursor },
    `Invalid session cursor: ${detail}`,
  );
}

function normalizeCursorPayload(value: unknown): CursorPayload | null {
  if (isCursorPayload(value)) {
    return value;
  }
  if (!isLegacyCursorPayload(value)) {
    return null;
  }
  return {
    v: 2,
    cwd: value.cwd,
    createdAt: new Date(Date.parse(value.updatedAt)).toISOString(),
    sessionId: value.sessionId,
  };
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.v === 2 &&
    hasValidCursorIdentity(record) &&
    isCanonicalTimestamp(record.createdAt)
  );
}

function isLegacyCursorPayload(value: unknown): value is LegacyCursorPayload {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.version === 1 &&
    hasValidCursorIdentity(record) &&
    typeof record.updatedAt === 'string' &&
    Number.isFinite(Date.parse(record.updatedAt))
  );
}

function hasValidCursorIdentity(record: Record<string, unknown>): boolean {
  const hasValidCwd = record.cwd === null || typeof record.cwd === 'string';
  const hasValidSessionId =
    typeof record.sessionId === 'string' && record.sessionId.length > 0;
  return hasValidCwd && hasValidSessionId;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}
