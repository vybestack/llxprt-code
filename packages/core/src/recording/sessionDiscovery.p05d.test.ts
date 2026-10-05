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
 * P05d RED tests — bounded continue-target discovery (issue #854).
 *
 * `listContinueTargetsDetailed` currently replays EVERY session's full
 * history (SessionDiscovery.ts:192) just to read the session name and
 * checkpoint metadata. These tests define its replacement:
 * `listContinueTargetsDetailedBounded`, a metadata pass that decodes only
 * header/name/checkpoint envelopes and never materializes a content row —
 * with peak decoded rows bounded regardless of session length — plus the
 * full continuation reference matrix (latest/index/name/UUID/checkpoint,
 * legacy, corrupt, empty, locked, subagent-children excluded) resolved
 * against the bounded targets.
 *
 * Expected state: RED. The bounded method does not exist yet; every test
 * here fails at the bounded call with the kit's intent message.
 *
 * @plan PLAN-20260917-ISSUE854.P05d
 * @requirement G3, G5
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SessionLockManager } from './SessionLockManager.js';
import {
  callBoundedDiscovery,
  corruptMidFile,
  createRecordedSession,
  createRowCounters,
  duplicateSeqLine,
  LARGE_N,
  makeTempChatsDir,
  PAGE_BOUND,
  pinMtime,
  PROJECT_HASH,
  SMALL_N,
  writeRawJournal,
  type BoundedContinueTargets,
  type RecordedSession,
} from './p05dTestKit.js';

let chatsDir: string;
let tempRoot: string;

interface MixedDir {
  newest: RecordedSession;
  older: RecordedSession;
  child: RecordedSession;
  legacy: RecordedSession;
  empty: RecordedSession;
}

/** Named+checkpointed newest, plain SMALL_N older, child, legacy, empty. */
async function createMixedDir(withCorruption: boolean): Promise<MixedDir> {
  const newest = await createRecordedSession(chatsDir, {
    rows: 4,
    name: 'alpha',
    checkpoint: 'keep',
  });
  const older = await createRecordedSession(chatsDir, { rows: SMALL_N });
  const child = await writeRawJournal(chatsDir, {
    rows: 2,
    kind: 'subagent',
  });
  const legacy = await writeRawJournal(chatsDir, { rows: 2 });
  const empty = await writeRawJournal(chatsDir, { rows: 0 });
  if (withCorruption) {
    await corruptMidFile(older.filePath);
  }
  await pinMtime(newest.filePath, 2_000_000_000_000);
  await pinMtime(older.filePath, 1_900_000_000_000);
  await pinMtime(child.filePath, 1_800_000_000_000);
  await pinMtime(legacy.filePath, 1_700_000_000_000);
  await pinMtime(empty.filePath, 1_600_000_000_000);
  return { newest, older, child, legacy, empty };
}

type TargetOf = BoundedContinueTargets['targets'][number];

function sessionIds(targets: readonly TargetOf[]): string[] {
  return targets
    .filter(
      (target): target is Extract<TargetOf, { kind: 'session' }> =>
        target.kind === 'session',
    )
    .map((target) => target.session.sessionId)
    .slice()
    .sort();
}

function resumedSessionId(
  resolution: ReturnType<typeof SessionDiscovery.resolveContinueRef>,
): string {
  if (!('target' in resolution)) return `error: ${resolution.error}`;
  const target = resolution.target;
  if (target.kind !== 'session') return 'not-a-session';
  return target.session.sessionId;
}

function checkpointNamed(
  targets: readonly TargetOf[],
  name: string,
): Extract<TargetOf, { kind: 'checkpoint' }> {
  const match = targets.find(
    (target) => target.kind === 'checkpoint' && target.checkpointName === name,
  );
  if (match === undefined || match.kind !== 'checkpoint') {
    throw new Error(`checkpoint target '${name}' not found`);
  }
  return match;
}

describe('P05d bounded continue-target discovery @issue:854', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'p05d-disc-'));
    chatsDir = path.join(tempRoot, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it(
    'latest eligibility reads only metadata until the first content envelope',
    verifyLatestEligibilityReadsOnlyMetadataUntilTheFirstContentEnvelope,
  );

  it(
    'the production discovery entry point scans metadata without replaying history',
    verifyTheProductionDiscoveryEntryPointScansMetadataWithoutReplayingHistory,
  );

  it(
    'metadata pass lists sessions and checkpoints without decoding content rows',
    verifyMetadataPassListsSessionsAndCheckpointsWithoutDecodingContentRows,
  );

  it(
    'peak stays bounded regardless of session length (SMALL_N vs LARGE_N)',
    verifyPeakStaysBoundedRegardlessOfSessionLengthSMALLNVsLARGEN,
    30_000,
  );

  it(
    'discovery must not replay contents of a large no-compression journal',
    verifyDiscoveryMustNotReplayContentsOfALargeNoCompressionJournal,
    30_000,
  );

  it(
    'resolution matrix over bounded targets: latest, index, name, UUID, prefix, checkpoint',
    verifyResolutionMatrixOverBoundedTargetsLatestIndexNameUUIDPrefixCheckpoint,
  );

  it(
    'ambiguous prefix errors, unknown ref errors',
    verifyAmbiguousPrefixErrorsUnknownRefErrors,
  );

  it(
    'subagent child journals are never continue targets',
    verifySubagentChildJournalsAreNeverContinueTargets,
  );

  it(
    'corrupt mid-file garbage still lists (replay-tolerant) with zero content decode',
    verifyCorruptMidFileGarbageStillListsReplayTolerantWithZeroContentDecode,
  );

  it(
    'sequence-corrupt journal is skipped with a recording error entry',
    verifySequenceCorruptJournalIsSkippedWithARecordingErrorEntry,
  );

  it(
    'legacy v:1 journal without kind resolves by UUID and carries no name',
    verifyLegacyV1JournalWithoutKindResolvesByUUIDAndCarriesNo,
  );

  it(
    'empty session (header only) is listed with no checkpoints',
    verifyEmptySessionHeaderOnlyIsListedWithNoCheckpoints,
  );

  it(
    'locked sessions are still listed by discovery (locking is resume policy)',
    verifyLockedSessionsAreStillListedByDiscoveryLockingIsResumePolicy,
  );
});

async function verifyLatestEligibilityReadsOnlyMetadataUntilTheFirstContentEnvelope(): Promise<void> {
  const session = await writeRawJournal(chatsDir, { rows: LARGE_N });
  const kit = createRowCounters();
  expect(
    await SessionDiscovery.hasContentEvents(session.filePath, kit.counters),
  ).toBe(true);
  expect(kit.snapshot()).toStrictEqual({
    recordsDecoded: 2,
    rowsDecoded: 0,
    peakDecodedRows: 0,
  });
}

async function verifyTheProductionDiscoveryEntryPointScansMetadataWithoutReplayingHistory(): Promise<void> {
  const session = await writeRawJournal(chatsDir, { rows: LARGE_N });
  const kit = createRowCounters();
  const detailed = await SessionDiscovery.listContinueTargetsDetailed(
    chatsDir,
    PROJECT_HASH,
    undefined,
    { counters: kit.counters },
  );
  expect(sessionIds(detailed.targets)).toStrictEqual([session.sessionId]);
  expect(kit.snapshot().recordsDecoded).toBeGreaterThanOrEqual(LARGE_N + 1);
  expect(kit.snapshot().rowsDecoded).toBe(0);
}

async function verifyMetadataPassListsSessionsAndCheckpointsWithoutDecodingContentRows(): Promise<void> {
  const dir = await createMixedDir(false);
  const kit = createRowCounters();

  const detailed = await callBoundedDiscovery(chatsDir, PROJECT_HASH, {
    counters: kit.counters,
  });

  expect(sessionIds(detailed.targets)).toStrictEqual(
    [dir.empty, dir.legacy, dir.newest, dir.older]
      .map((session) => session.sessionId)
      .slice()
      .sort(),
  );
  const checkpoint = checkpointNamed(detailed.targets, 'keep');
  expect(checkpoint.source.sessionId).toBe(dir.newest.sessionId);
  expect(checkpoint.checkpointName).toBe('keep');

  // Aliveness: headers were decoded; content rows were not.
  const stats = kit.snapshot();
  expect(stats.recordsDecoded).toBeGreaterThanOrEqual(5);
  expect(stats.rowsDecoded).toBe(0);
  expect(stats.peakDecodedRows).toBe(0);
}

async function verifyPeakStaysBoundedRegardlessOfSessionLengthSMALLNVsLARGEN(): Promise<void> {
  await createRecordedSession(chatsDir, { rows: SMALL_N });
  const largeDir = await makeTempChatsDir();
  const large = await writeRawJournal(largeDir, { rows: LARGE_N });
  const kit = createRowCounters();

  const smallResult = await callBoundedDiscovery(chatsDir, PROJECT_HASH, {
    counters: kit.counters,
  });
  const largeResult = await callBoundedDiscovery(largeDir, PROJECT_HASH, {
    counters: kit.counters,
  });

  expect(sessionIds(smallResult.targets).length).toBe(1);
  expect(sessionIds(largeResult.targets)).toStrictEqual([large.sessionId]);
  const stats = kit.snapshot();
  expect(stats.rowsDecoded).toBe(0);
  expect(stats.peakDecodedRows).toBeLessThanOrEqual(PAGE_BOUND);
}

async function verifyDiscoveryMustNotReplayContentsOfALargeNoCompressionJournal(): Promise<void> {
  const session = await writeRawJournal(chatsDir, { rows: LARGE_N });
  const kit = createRowCounters();

  const detailed = await callBoundedDiscovery(chatsDir, PROJECT_HASH, {
    counters: kit.counters,
  });

  expect(sessionIds(detailed.targets)).toStrictEqual([session.sessionId]);
  const stats = kit.snapshot();
  expect(stats.recordsDecoded).toBeGreaterThanOrEqual(1);
  expect(stats.rowsDecoded).toBe(0);
}

async function verifyResolutionMatrixOverBoundedTargetsLatestIndexNameUUIDPrefixCheckpoint(): Promise<void> {
  const dir = await createMixedDir(false);

  const detailed = await callBoundedDiscovery(chatsDir, PROJECT_HASH, {});
  const targets = detailed.targets;

  expect(
    resumedSessionId(SessionDiscovery.resolveContinueRef('latest', targets)),
  ).toBe(dir.newest.sessionId);
  expect(
    resumedSessionId(SessionDiscovery.resolveContinueRef('1', targets)),
  ).toBe(dir.newest.sessionId);
  expect(
    resumedSessionId(SessionDiscovery.resolveContinueRef('2', targets)),
  ).toBe(dir.older.sessionId);
  expect(
    resumedSessionId(SessionDiscovery.resolveContinueRef('alpha', targets)),
  ).toBe(dir.newest.sessionId);
  expect(
    resumedSessionId(
      SessionDiscovery.resolveContinueRef(dir.legacy.sessionId, targets),
    ),
  ).toBe(dir.legacy.sessionId);
  expect(
    resumedSessionId(
      SessionDiscovery.resolveContinueRef(
        dir.newest.sessionId.slice(0, 9),
        targets,
      ),
    ),
  ).toBe(dir.newest.sessionId);

  const checkpoint = checkpointNamed(targets, 'keep');
  expect(SessionDiscovery.resolveContinueRef('keep', targets)).toStrictEqual({
    target: checkpoint,
  });
  expect(
    SessionDiscovery.resolveContinueRef(checkpoint.checkpointId, targets),
  ).toStrictEqual({ target: checkpoint });
}

async function verifyAmbiguousPrefixErrorsUnknownRefErrors(): Promise<void> {
  const shared = 'aaaaaaaa';
  await writeRawJournal(chatsDir, {
    sessionId: `${shared}-1111`,
    rows: 2,
  });
  await writeRawJournal(chatsDir, {
    sessionId: `${shared}-2222`,
    rows: 2,
  });

  const detailed = await callBoundedDiscovery(chatsDir, PROJECT_HASH, {});
  const targets = detailed.targets;

  const ambiguous = SessionDiscovery.resolveContinueRef(shared, targets);
  expect('error' in ambiguous && ambiguous.error).toContain('Ambiguous');
  const missing = SessionDiscovery.resolveContinueRef('no-such-ref', targets);
  expect('error' in missing).toBe(true);
}

async function verifySubagentChildJournalsAreNeverContinueTargets(): Promise<void> {
  const dir = await createMixedDir(false);

  const detailed = await callBoundedDiscovery(chatsDir, PROJECT_HASH, {});

  expect(sessionIds(detailed.targets)).not.toContain(dir.child.sessionId);
  expect(sessionIds(detailed.targets)).toContain(dir.newest.sessionId);
}

async function verifyCorruptMidFileGarbageStillListsReplayTolerantWithZeroContentDecode(): Promise<void> {
  const dir = await createMixedDir(true);
  const kit = createRowCounters();

  const detailed = await callBoundedDiscovery(chatsDir, PROJECT_HASH, {
    counters: kit.counters,
  });

  expect(sessionIds(detailed.targets)).toContain(dir.older.sessionId);
  expect(detailed.recordingErrors).toStrictEqual([]);
  expect(kit.snapshot().rowsDecoded).toBe(0);
}

async function verifySequenceCorruptJournalIsSkippedWithARecordingErrorEntry(): Promise<void> {
  const corrupt = await createRecordedSession(chatsDir, { rows: 4 });
  await duplicateSeqLine(corrupt.filePath);

  const detailed = await callBoundedDiscovery(chatsDir, PROJECT_HASH, {});

  expect(sessionIds(detailed.targets)).toStrictEqual([]);
  expect(detailed.skippedCount).toBe(1);
  expect(
    detailed.recordingErrors.some((entry) =>
      entry.startsWith(corrupt.filePath),
    ),
  ).toBe(true);
}

async function verifyLegacyV1JournalWithoutKindResolvesByUUIDAndCarriesNo(): Promise<void> {
  const dir = await createMixedDir(false);

  const detailed = await callBoundedDiscovery(chatsDir, PROJECT_HASH, {});
  const targets = detailed.targets;

  expect(
    resumedSessionId(
      SessionDiscovery.resolveContinueRef(dir.legacy.sessionId, targets),
    ),
  ).toBe(dir.legacy.sessionId);
  const summary = targets
    .filter(
      (target): target is Extract<TargetOf, { kind: 'session' }> =>
        target.kind === 'session',
    )
    .map((target) => target.session)
    .find((session) => session.sessionId === dir.legacy.sessionId);
  expect(summary?.name).toBeUndefined();
}

async function verifyEmptySessionHeaderOnlyIsListedWithNoCheckpoints(): Promise<void> {
  const dir = await createMixedDir(false);

  const detailed = await callBoundedDiscovery(chatsDir, PROJECT_HASH, {});

  expect(sessionIds(detailed.targets)).toContain(dir.empty.sessionId);
  expect(
    detailed.targets.filter(
      (target) =>
        target.kind === 'checkpoint' &&
        target.source.sessionId === dir.empty.sessionId,
    ),
  ).toStrictEqual([]);
}

async function verifyLockedSessionsAreStillListedByDiscoveryLockingIsResumePolicy(): Promise<void> {
  const dir = await createMixedDir(false);
  const lock = await SessionLockManager.acquire(chatsDir, dir.newest.sessionId);
  try {
    const detailed = await callBoundedDiscovery(chatsDir, PROJECT_HASH, {});
    expect(sessionIds(detailed.targets)).toContain(dir.newest.sessionId);
  } finally {
    await lock.release();
  }
}
