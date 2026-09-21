/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P05c target contract: subagent child journals must be invisible to every
 * session discovery resolution path — listSessions, listContinueTargets
 * (the `--continue`/`/resume` feed whose first target is the "latest"
 * session), and checkpoint enumeration folded through continue targets —
 * while janitor globs keep seeing the files so crashed children are still
 * reclaimable.
 *
 * RED on assertion: all imports exist at HEAD, but discovery has no kind
 * filter yet, so child journals surface as resumable sessions (and their
 * checkpoints as continue targets) until the green session adds filtering.
 *
 * @plan:PLAN-20260917-ISSUE854.P05c
 * @requirement:G7
 */

import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { SessionDiscovery } from './SessionDiscovery.js';
import { getAllJsonlSessionFiles } from './sessionCleanupUtils.js';
import type { ContinueTarget, SessionSummary } from './types.js';

/** Proposed P05c extension of SessionSummary (tmp/verify854/p05c/api_sketch.md). */
type SummaryWithKind = SessionSummary & { kind?: 'main' | 'subagent' };

const PROJECT_HASH = 'p05c-discovery-hash';

let fixtureDir: string | null = null;

afterEach(async () => {
  if (fixtureDir !== null) {
    await rm(fixtureDir, { recursive: true, force: true });
    fixtureDir = null;
  }
});

interface StartFields {
  sessionId: string;
  startTime: string;
  kind?: 'main' | 'subagent';
  parentSessionId?: string;
}

function startLine(seq: number, fields: StartFields): string {
  const payload: Record<string, unknown> = {
    sessionId: fields.sessionId,
    projectHash: PROJECT_HASH,
    workspaceDirs: ['/w'],
    provider: 'anthropic',
    model: 'claude-4',
    startTime: fields.startTime,
    ...(fields.kind === undefined ? {} : { kind: fields.kind }),
    ...(fields.parentSessionId === undefined
      ? {}
      : { parentSessionId: fields.parentSessionId }),
  };
  return JSON.stringify({
    v: 1,
    seq,
    ts: fields.startTime,
    type: 'session_start',
    payload,
  });
}

function checkpointLine(
  seq: number,
  checkpointId: string,
  name: string,
): string {
  return JSON.stringify({
    v: 1,
    seq,
    ts: '2026-02-11T16:00:01.000Z',
    type: 'checkpoint_created',
    payload: { checkpointId, name },
  });
}

function targetTargetId(target: ContinueTarget): string {
  return target.kind === 'session'
    ? target.session.sessionId
    : target.source.sessionId;
}

async function writeJournal(
  chatsDir: string,
  sessionId: string,
  lines: readonly string[],
  modifiedAt: Date,
): Promise<void> {
  const filePath = path.join(chatsDir, `session-${sessionId}.jsonl`);
  await appendFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  await utimes(filePath, modifiedAt, modifiedAt);
}

async function makeFixture(): Promise<{
  chatsDir: string;
  parentId: string;
  childId: string;
}> {
  fixtureDir = await mkdtemp(path.join(tmpdir(), 'p05c-discovery-'));
  const chatsDir = path.join(fixtureDir, 'chats');
  await mkdir(chatsDir, { recursive: true });
  const parentId = randomUUID();
  const childId = randomUUID();
  const old = new Date('2026-02-11T15:00:00.000Z');
  const fresh = new Date('2026-02-11T16:00:00.000Z');
  await writeJournal(
    chatsDir,
    parentId,
    [startLine(1, { sessionId: parentId, startTime: old.toISOString() })],
    old,
  );
  // The child is deliberately the NEWEST recording: without a filter it is
  // the `--continue` latest target.
  await writeJournal(
    chatsDir,
    childId,
    [
      startLine(1, {
        sessionId: childId,
        startTime: fresh.toISOString(),
        kind: 'subagent',
        parentSessionId: parentId,
      }),
      checkpointLine(2, 'cp-child-p05c', 'child-cp'),
    ],
    fresh,
  );
  return { chatsDir, parentId, childId };
}

describe('P05c discovery filters child journals @plan:PLAN-20260917-ISSUE854.P05c', () => {
  it('listSessions returns only main sessions', async () => {
    const { chatsDir, parentId, childId } = await makeFixture();
    const sessions = await SessionDiscovery.listSessions(
      chatsDir,
      PROJECT_HASH,
    );
    const ids = sessions.map((session) => session.sessionId);
    expect(ids).not.toContain(childId);
    expect(ids).toStrictEqual([parentId]);
  });

  it('listContinueTargets never offers a child session', async () => {
    const { chatsDir, childId } = await makeFixture();
    const targets = await SessionDiscovery.listContinueTargets(
      chatsDir,
      PROJECT_HASH,
    );
    const sessionIds = targets.map((target) => targetTargetId(target));
    expect(sessionIds).not.toContain(childId);
  });

  it('the `--continue` latest target is the parent, never the newest child', async () => {
    const { chatsDir, parentId } = await makeFixture();
    const targets = await SessionDiscovery.listContinueTargets(
      chatsDir,
      PROJECT_HASH,
    );
    if (targets.length === 0) return;
    const latest = targets[0];
    expect(latest.kind).toBe('session');
    if (latest.kind !== 'session') return;
    expect(latest.session.sessionId).toBe(parentId);
  });

  it('child checkpoints never surface as continue targets', async () => {
    const { chatsDir } = await makeFixture();
    const targets = await SessionDiscovery.listContinueTargets(
      chatsDir,
      PROJECT_HASH,
    );
    const checkpointIds = targets
      .filter((target) => target.kind === 'checkpoint')
      .map((target) => target.checkpointId);
    expect(checkpointIds).not.toContain('cp-child-p05c');
  });

  it('summaries expose kind=main for legacy main journals', async () => {
    const { chatsDir, parentId } = await makeFixture();
    const sessions = await SessionDiscovery.listSessions(
      chatsDir,
      PROJECT_HASH,
    );
    const parent = sessions.find(
      (session) => session.sessionId === parentId,
    ) as SummaryWithKind | undefined;
    expect(parent).toBeDefined();
    expect(parent?.kind).toBe('main');
  });

  it('janitor globs still see child journals for reclamation', async () => {
    const { chatsDir } = await makeFixture();
    const entries = await getAllJsonlSessionFiles(chatsDir);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.fileName).toMatch(/^session-.*\.jsonl$/);
    }
  });
});
