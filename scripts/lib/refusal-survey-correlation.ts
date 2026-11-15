/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Journal } from './refusal-survey-journal-index.ts';

export type JoinMethod =
  | 'exact'
  | 'legacy-prompt-prefix'
  | 'legacy-timestamp'
  | 'none';
export type Correlation = { method: JoinMethod; records: Journal[] };
export type CorrelationCall = {
  projectHash: string;
  session: string;
  prompt: string;
  runtime: string;
  ts: string;
  childRuntime: boolean;
};

function journalSessions(records: Journal[]): Journal[][] {
  const sessions = new Map<string, Journal[]>();
  for (const record of records) {
    const key = JSON.stringify([record.session, record.runtime]);
    const session = sessions.get(key) ?? [];
    session.push(record);
    sessions.set(key, session);
  }
  return [...sessions.values()];
}

export function correlationFor(
  call: CorrelationCall,
  records: Journal[],
): Correlation {
  const sessions = journalSessions(records);
  const exact = sessions.filter((session) =>
    session.some(
      (record) =>
        record.session === call.session && record.runtime === call.runtime,
    ),
  );
  if (exact.length === 1) return { method: 'exact', records: exact[0]! };

  const prefix = sessions.filter((session) => {
    const journalId =
      session.find((record) => record.type === 'session_start')?.session ?? '';
    const runtimeMatch = session.some(
      (record) => record.runtime === call.runtime,
    );
    return (
      journalId !== '' &&
      call.prompt.startsWith(journalId) &&
      (!call.childRuntime || runtimeMatch)
    );
  });
  if (prefix.length === 1)
    return { method: 'legacy-prompt-prefix', records: prefix[0]! };

  const callTime = Date.parse(call.ts);
  const covering = sessions.filter((session) => {
    const times = session
      .map((record) => Date.parse(record.ts))
      .filter(Number.isFinite);
    const runtimeMatch = session.some(
      (record) => record.runtime === call.runtime,
    );
    const coversCall =
      times.length > 0 &&
      callTime >= Math.min(...times) &&
      callTime <= Math.max(...times);
    const allowedRuntime = !call.childRuntime || runtimeMatch;
    return coversCall && allowedRuntime;
  });
  return covering.length === 1
    ? { method: 'legacy-timestamp', records: covering[0]! }
    : { method: 'none', records: [] };
}
