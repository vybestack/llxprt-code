/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SessionSummary } from '@vybestack/llxprt-code-core';
import { SessionDiscovery } from '@vybestack/llxprt-code-core';
import type * as acp from '@agentclientprotocol/sdk';
import {
  paginateSessions,
  type LifecycleSession,
} from './zed-session-pagination.js';

// Keep responses responsive without returning an unwieldy session list.
const SESSION_PAGE_SIZE = 50;
// Bound concurrent metadata reads to avoid I/O spikes on large histories.
const LIST_CONCURRENCY_LIMIT = 8;

async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new RangeError('Concurrency limit must be a positive integer');
  }
  const results: R[] = [];
  let index = 0;
  let aborted = false;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (!aborted && index < items.length) {
        const current = index++;
        results[current] = await fn(items[current]);
      }
    },
  );
  try {
    await Promise.all(workers);
  } catch (error) {
    aborted = true;
    await Promise.allSettled(workers);
    throw error;
  }
  return results;
}

export async function listRecordedSessions(
  chatsDir: string,
  projectHash: string,
  fallbackCwd: string,
  request: acp.ListSessionsRequest,
  liveSessions: readonly LifecycleSession[] = [],
): Promise<acp.ListSessionsResponse> {
  const summaries = await SessionDiscovery.listSessions(chatsDir, projectHash);
  const records = await mapWithConcurrencyLimit(
    summaries,
    LIST_CONCURRENCY_LIMIT,
    (summary) => toLifecycleSession(summary, fallbackCwd),
  );
  const merged = new Map(
    records.map((session) => [session.sessionId, session] as const),
  );
  for (const session of liveSessions) {
    const durable = merged.get(session.sessionId);
    merged.set(session.sessionId, mergeLifecycleSession(durable, session));
  }
  const page = paginateSessions(
    [...merged.values()],
    { cwd: request.cwd ?? null, cursor: request.cursor ?? null },
    SESSION_PAGE_SIZE,
  );
  return {
    sessions: page.sessions.map(toSessionInfo),
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  };

  function mergeLifecycleSession(
    durable: LifecycleSession | undefined,
    live: LifecycleSession,
  ): LifecycleSession {
    if (durable === undefined) {
      return live;
    }
    return {
      ...live,
      // createdAt is immutable — durable recording wins (live sessions may not
      // have it until the session_start is persisted). Issue #1611.
      ...(durable.createdAt !== undefined
        ? { createdAt: durable.createdAt }
        : {}),
      updatedAt: resolveUpdatedAt(durable.updatedAt, live.updatedAt),
      ...(durable.title === undefined ? {} : { title: durable.title }),
    };
  }
}

function resolveUpdatedAt(
  durableUpdatedAt: string,
  liveUpdatedAt: string,
): string {
  const durableTimestamp = Date.parse(durableUpdatedAt);
  const liveTimestamp = Date.parse(liveUpdatedAt);
  if (Number.isNaN(liveTimestamp)) {
    return durableUpdatedAt;
  }
  if (Number.isNaN(durableTimestamp)) {
    return liveUpdatedAt;
  }
  return durableTimestamp >= liveTimestamp ? durableUpdatedAt : liveUpdatedAt;
}

/**
 * Resolves the tri-state title for a durable session.
 *
 * Issue #1611: a persisted `session_metadata` event is the source of truth.
 * For legacy files without one (title === undefined), fall back to the first
 * human message (which returns null for no-human-text sessions, omitted from
 * the output). A null metadata title remains explicitly untitled by suppressing
 * that legacy fallback and omitting the ACP title property.
 */
async function toLifecycleSession(
  summary: SessionSummary,
  fallbackCwd: string,
): Promise<LifecycleSession> {
  const metadataTitle = await SessionDiscovery.readSessionMetadataTitle(
    summary.filePath,
  );
  const displayTitle =
    metadataTitle === undefined
      ? await SessionDiscovery.readFirstUserMessage(summary.filePath)
      : metadataTitle;
  return {
    sessionId: summary.sessionId,
    cwd: summary.cwd ?? fallbackCwd,
    updatedAt: summary.lastModified.toISOString(),
    ...(summary.createdAt !== undefined
      ? { createdAt: summary.createdAt }
      : {}),
    ...(typeof displayTitle === 'string' ? { title: displayTitle } : {}),
  };
}

function toSessionInfo(session: LifecycleSession): acp.SessionInfo {
  return {
    sessionId: session.sessionId,
    cwd: session.cwd,
    updatedAt: session.updatedAt,
    ...(session.title === undefined ? {} : { title: session.title }),
  };
}
