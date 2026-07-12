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

const SESSION_PAGE_SIZE = 50;

export async function listRecordedSessions(
  chatsDir: string,
  projectHash: string,
  fallbackCwd: string,
  request: acp.ListSessionsRequest,
  liveSessions: readonly LifecycleSession[] = [],
): Promise<acp.ListSessionsResponse> {
  const summaries = await SessionDiscovery.listSessions(chatsDir, projectHash);
  const records = await Promise.all(
    summaries.map((summary) => toLifecycleSession(summary, fallbackCwd)),
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
      updatedAt:
        durable.updatedAt > live.updatedAt ? durable.updatedAt : live.updatedAt,
      ...(durable.title === undefined ? {} : { title: durable.title }),
    };
  }
}

async function toLifecycleSession(
  summary: SessionSummary,
  fallbackCwd: string,
): Promise<LifecycleSession> {
  const title = await SessionDiscovery.readFirstUserMessage(summary.filePath);
  return {
    sessionId: summary.sessionId,
    cwd: summary.cwd ?? fallbackCwd,
    updatedAt: summary.lastModified.toISOString(),
    ...(title === null ? {} : { title }),
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
