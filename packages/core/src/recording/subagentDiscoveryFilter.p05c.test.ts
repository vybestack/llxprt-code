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

import { afterEach, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { JournalRecordingService } from './journalRecordingService.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { getAllJsonlSessionFiles } from './sessionCleanupUtils.js';
import type { ContinueTarget, SessionSummary } from './types.js';

/** Proposed P05c extension of SessionSummary (tmp/verify854/p05c/api_sketch.md). */
type SummaryWithKind = SessionSummary & { kind?: 'main' | 'subagent' };

const PROJECT_HASH = 'p05c-discovery-hash';

let fixtureDir: string | null = null;

function targetTargetId(target: ContinueTarget): string {
  return target.kind === 'session'
    ? target.session.sessionId
    : target.source.sessionId;
}

async function writeJournal(
  chatsDir: string,
  sessionId: string,
  modifiedAt: Date,
  parentSessionId?: string,
): Promise<void> {
  const recorder = JournalRecordingService.create({
    sessionId,
    chatsDir,
    projectHash: PROJECT_HASH,
    workspaceDirs: ['/w'],
    provider: 'anthropic',
    model: 'claude-4',
    kind: parentSessionId === undefined ? 'main' : 'subagent',
    ...(parentSessionId === undefined ? {} : { parentSessionId }),
  });
  let filePath: string;
  try {
    const session = await recorder.session();
    if (parentSessionId !== undefined) {
      await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'child row' }] },
      ]);
      await recorder.createCheckpoint('child-cp');
    }
    const materialized = recorder.getFilePath();
    if (materialized === null) throw new Error('Missing fixture journal');
    filePath = materialized;
  } finally {
    await recorder.dispose();
  }
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
  await writeJournal(chatsDir, parentId, old);
  await writeJournal(chatsDir, childId, fresh, parentId);
  return { chatsDir, parentId, childId };
}

describe('P05c discovery filters child journals @plan:PLAN-20260917-ISSUE854.P05c', () => {
  afterEach(async () => {
    if (fixtureDir !== null) {
      await rm(fixtureDir, { recursive: true, force: true });
      fixtureDir = null;
    }
  });

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
    expect(targets.length).toBeGreaterThan(0);
    const latest = targets[0];
    if (latest.kind !== 'session') {
      throw new Error(
        'Expected the latest continuation target to be a session',
      );
    }
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
      expect(entry.fileName).toMatch(/^session-.*\.llxj$/);
    }
  });
});
