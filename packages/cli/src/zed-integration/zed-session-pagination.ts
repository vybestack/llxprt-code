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
}

interface CursorPayload {
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

function compareSessions(a: LifecycleSession, b: LifecycleSession): number {
  return compareByUpdatedAtAndId(
    a.updatedAt,
    a.sessionId,
    b.updatedAt,
    b.sessionId,
  );
}

function compareWithCursor(
  session: LifecycleSession,
  cursor: CursorPayload,
): number {
  return compareByUpdatedAtAndId(
    session.updatedAt,
    session.sessionId,
    cursor.updatedAt,
    cursor.sessionId,
  );
}

function compareByUpdatedAtAndId(
  aUpdatedAt: string,
  aId: string,
  bUpdatedAt: string,
  bId: string,
): number {
  const timestamp = compareDescending(aUpdatedAt, bUpdatedAt);
  return timestamp === 0 ? compareDescending(aId, bId) : timestamp;
}

function compareDescending(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a > b ? -1 : 1;
}

function encodeCursor(session: LifecycleSession, cwd: string | null): string {
  const payload: CursorPayload = {
    version: 1,
    cwd,
    updatedAt: session.updatedAt,
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
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (!isCursorPayload(value) || value.cwd !== cwd) {
      throw new Error('cursor does not match this request');
    }
    return value;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'invalid encoding';
    throw acp.RequestError.invalidParams(
      { cursor },
      `Invalid session cursor: ${detail}`,
    );
  }
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  const hasValidCwd = record.cwd === null || typeof record.cwd === 'string';
  return (
    record.version === 1 &&
    hasValidCwd &&
    typeof record.updatedAt === 'string' &&
    typeof record.sessionId === 'string'
  );
}
