/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * P05d RED tests — resumeSession cursor boot (issue #854).
 *
 * `resumeSession` currently replays the whole target journal into
 * `ResumeResult.history` (resumeSession.ts:200, resumeSession.ts:64).
 * These tests define its replacement: the result carries a cursor boot
 * (`boot.cursor` opened at the journal tail, `boot.lastSeq`,
 * `boot.streamRows()`) and NO materialized history array, while the whole
 * command — discovery header reads through streamed boot rows — keeps peak
 * decoded rows bounded regardless of session length, including large
 * journals with no compression events (the shape that exposes
 * whole-context buffering in the current replay fold).
 *
 * Matrix: CONTINUE_LATEST / index / UUID refs, legacy v:1 journals, corrupt
 * mid-file garbage, sequence-corrupt, empty sessions, locked sessions.
 * (Name and checkpoint refs resolve in the targets layer — covered by
 * sessionDiscovery.p05d.test.ts and sessionTransition.p05d.test.ts.)
 *
 * Expected state: RED. `boot` and the `counters` seam do not exist yet;
 * the no-history assertions fail against today's `history` field.
 *
 * @plan PLAN-20260917-ISSUE854.P05d
 * @requirement G3, G4, G5
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { replaySession } from './ReplayEngine.js';
import { SessionLockManager } from './SessionLockManager.js';
import {
  bootOf,
  collectRows,
  corruptMidFile,
  createRecordedSession,
  createRowCounters,
  duplicateSeqLine,
  expectNoHistoryField,
  LARGE_N,
  PAGE_BOUND,
  pinMtime,
  PROJECT_HASH,
  SMALL_N,
  withCounters,
  writeRawJournal,
  type ResumeRequest,
} from './p05dTestKit.js';
import { CONTINUE_LATEST, resumeSession } from './resumeSession.js';
import type { IContent } from '../services/history/IContent.js';

let chatsDir: string;
let tempRoot: string;

function makeRequest(overrides: Partial<ResumeRequest> = {}): ResumeRequest {
  return {
    continueRef: CONTINUE_LATEST,
    projectHash: PROJECT_HASH,
    chatsDir,
    currentProvider: 'anthropic',
    currentModel: 'claude-4',
    workspaceDirs: ['/test/workspace'],
    ...overrides,
  };
}

async function resumeWithCounters(
  kit: ReturnType<typeof createRowCounters>,
  overrides: Partial<ResumeRequest> = {},
) {
  return resumeSession(withCounters(makeRequest(overrides), kit.counters));
}

describe('P05d resumeSession cursor boot @issue:854', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'p05d-res-'));
    chatsDir = path.join(tempRoot, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it(
    'boot contract: cursor boot replaces the materialized history array',
    verifyBootContractCursorBootReplacesTheMaterializedHistoryArray,
  );

  it(
    'streamRows skips corrupt mid-file lines and torn tails',
    verifyStreamRowsSkipsCorruptMidFileLinesAndTornTails,
  );

  it(
    'sequence-corrupt journal refuses to boot with the replay error',
    verifySequenceCorruptJournalRefusesToBootWithTheReplayError,
  );

  it(
    'booted recording appends to the same journal past boot.lastSeq',
    verifyBootedRecordingAppendsToTheSameJournalPastBootLastSeq,
  );

  it(
    'CONTINUE_LATEST resumes the newest unlocked session',
    verifyCONTINUELATESTResumesTheNewestUnlockedSession,
  );

  it(
    'index ref resumes the Nth newest session',
    verifyIndexRefResumesTheNthNewestSession,
  );

  it(
    'legacy v:1 journal resumes by UUID with exact rows',
    verifyLegacyV1JournalResumesByUUIDWithExactRows,
  );

  it('empty session boots with zero rows', verifyEmptySessionBootsWithZeroRows);

  it(
    'locked session: explicit ref errors, CONTINUE_LATEST skips to unlocked',
    verifyLockedSessionExplicitRefErrorsCONTINUELATESTSkipsToUnlocked,
  );

  it(
    'no-compression large journal: whole command stays page-bounded',
    verifyNoCompressionLargeJournalWholeCommandStaysPageBounded,
    60_000,
  );
});

async function verifyBootContractCursorBootReplacesTheMaterializedHistoryArray(): Promise<void> {
  const session = await createRecordedSession(chatsDir, {
    rows: SMALL_N,
    name: 'boots',
  });
  const kit = createRowCounters();

  const result = await resumeWithCounters(kit, {
    continueRef: session.sessionId,
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expectNoHistoryField(result);
  const boot = bootOf(result);
  expect(boot.lastSeq).toBe(SMALL_N + 2);
  expect(result.metadata.sessionId).toBe(session.sessionId);
  expect(result.recording.getFilePath()).toBe(session.filePath);
  expect(result.recording.isActive()).toBe(true);

  const rows = await collectRows(boot);
  expect(rows).toStrictEqual(session.contents);
  const stats = kit.snapshot();
  expect(stats.recordsDecoded).toBeGreaterThanOrEqual(1);
  expect(stats.rowsDecoded).toBe(SMALL_N);
  expect(stats.peakDecodedRows).toBeLessThanOrEqual(PAGE_BOUND);
}

async function verifyStreamRowsSkipsCorruptMidFileLinesAndTornTails(): Promise<void> {
  const session = await createRecordedSession(chatsDir, { rows: 3 });
  await corruptMidFile(session.filePath);
  const kit = createRowCounters();

  const result = await resumeWithCounters(kit, {
    continueRef: session.sessionId,
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expectNoHistoryField(result);
  const rows = await collectRows(bootOf(result));
  expect(rows).toStrictEqual(session.contents);
  expect(result.warnings.length).toBeGreaterThan(0);
}

async function verifySequenceCorruptJournalRefusesToBootWithTheReplayError(): Promise<void> {
  const session = await createRecordedSession(chatsDir, { rows: 4 });
  await duplicateSeqLine(session.filePath);
  const kit = createRowCounters();

  const result = await resumeWithCounters(kit, {
    continueRef: session.sessionId,
  });

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toContain('non-monotonic');
}

async function verifyBootedRecordingAppendsToTheSameJournalPastBootLastSeq(): Promise<void> {
  const session = await createRecordedSession(chatsDir, { rows: 2 });
  const kit = createRowCounters();

  const result = await resumeWithCounters(kit, {
    continueRef: session.sessionId,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const boot = bootOf(result);

  result.recording.recordContent({
    speaker: 'human',
    blocks: [{ type: 'text', text: 'post-resume' }],
  });
  await result.recording.flush();

  const replay = await replaySession(session.filePath, PROJECT_HASH);
  expect(replay.ok).toBe(true);
  if (!replay.ok) return;
  const texts = replay.history.map((row) =>
    row.blocks.map((block) => (block.type === 'text' ? block.text : '')),
  );
  expect(texts[texts.length - 1]).toStrictEqual(['post-resume']);
  expect(replay.lastSeq).toBeGreaterThan(boot.lastSeq);
  await result.recording.dispose();
}

async function verifyCONTINUELATESTResumesTheNewestUnlockedSession(): Promise<void> {
  const older = await createRecordedSession(chatsDir, { rows: 2 });
  const newest = await createRecordedSession(chatsDir, { rows: 2 });
  await pinMtime(older.filePath, 1_000_000_000_000);
  await pinMtime(newest.filePath, 2_000_000_000_000);
  const kit = createRowCounters();

  const result = await resumeWithCounters(kit);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expectNoHistoryField(result);
  expect(result.metadata.sessionId).toBe(newest.sessionId);
  void older;
  await result.recording.dispose();
}

async function verifyIndexRefResumesTheNthNewestSession(): Promise<void> {
  const older = await createRecordedSession(chatsDir, { rows: 2 });
  const newest = await createRecordedSession(chatsDir, { rows: 2 });
  await pinMtime(older.filePath, 1_000_000_000_000);
  await pinMtime(newest.filePath, 2_000_000_000_000);
  const kit = createRowCounters();

  const result = await resumeWithCounters(kit, { continueRef: '2' });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expectNoHistoryField(result);
  expect(bootOf(result).lastSeq).toBe(3);
  expect(result.metadata.sessionId).toBe(older.sessionId);
  await result.recording.dispose();
}

async function verifyLegacyV1JournalResumesByUUIDWithExactRows(): Promise<void> {
  const legacy = await writeRawJournal(chatsDir, { rows: SMALL_N });
  const kit = createRowCounters();

  const result = await resumeWithCounters(kit, {
    continueRef: legacy.sessionId,
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expectNoHistoryField(result);
  const rows = await collectRows(bootOf(result));
  expect(rows).toStrictEqual(legacy.contents);
  await result.recording.dispose();
}

async function verifyEmptySessionBootsWithZeroRows(): Promise<void> {
  const empty = await writeRawJournal(chatsDir, { rows: 0 });
  const kit = createRowCounters();

  const result = await resumeWithCounters(kit, {
    continueRef: empty.sessionId,
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const rows = await collectRows(bootOf(result));
  const noRows: IContent[] = [];
  expect(rows).toStrictEqual(noRows);
  expect(bootOf(result).lastSeq).toBe(1);
  await result.recording.dispose();
}

async function verifyLockedSessionExplicitRefErrorsCONTINUELATESTSkipsToUnlocked(): Promise<void> {
  const older = await createRecordedSession(chatsDir, { rows: 2 });
  const newest = await createRecordedSession(chatsDir, { rows: 2 });
  await pinMtime(older.filePath, 1_000_000_000_000);
  await pinMtime(newest.filePath, 2_000_000_000_000);
  const lock = await SessionLockManager.acquire(chatsDir, newest.sessionId);
  try {
    const kit = createRowCounters();

    const locked = await resumeWithCounters(kit, {
      continueRef: newest.sessionId,
    });
    expect(locked.ok).toBe(false);
    if (locked.ok) return;
    expect(locked.error).toContain('in use');

    const latest = await resumeWithCounters(kit);
    expect(latest.ok).toBe(true);
    if (!latest.ok) return;
    expectNoHistoryField(latest);
    expect(latest.metadata.sessionId).toBe(older.sessionId);
    await latest.recording.dispose();
  } finally {
    await lock.release();
  }
}

async function verifyNoCompressionLargeJournalWholeCommandStaysPageBounded(): Promise<void> {
  const session = await writeRawJournal(chatsDir, { rows: LARGE_N });
  const kit = createRowCounters();

  const result = await resumeWithCounters(kit, {
    continueRef: session.sessionId,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const rows = await collectRows(bootOf(result));
  expect(rows.length).toBe(LARGE_N);
  expect(rows[0]).toStrictEqual(session.contents[0]);
  expect(rows[rows.length - 1]).toStrictEqual(session.contents[LARGE_N - 1]);

  const stats = kit.snapshot();
  // Aliveness: every row was streamed exactly once through the boot.
  expect(stats.rowsDecoded).toBe(LARGE_N);
  expect(stats.recordsDecoded).toBeGreaterThanOrEqual(1);
  // The bound: peak held rows are independent of session length.
  expect(stats.peakDecodedRows).toBeLessThanOrEqual(PAGE_BOUND);
  await result.recording.dispose();
}
