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
 * P05d RED tests — checkpoint continuation via journal-range copy
 * (issue #854).
 *
 * `SessionTransitionService.loadCheckpointHistory` currently replays the
 * source session TWICE (full + through-sequence,
 * SessionTransitionService.ts:66/:88) and `materializeChild` re-records the
 * decoded history row by row (SessionTransitionService.ts:187). These tests
 * define the replacement: the child journal is seeded by copying the
 * parent's journal byte range through the checkpoint watermark (decoding
 * zero content rows), the fork result carries a cursor boot instead of a
 * history array, and child correctness is asserted through the existing
 * replay oracle at sizes where materialization is tolerable.
 *
 * Expected state: RED. The `counters` option and `ForkResult.boot` do not
 * exist yet; the zero-content-decode assertions fail under exactly that
 * condition.
 *
 * @plan PLAN-20260917-ISSUE854.P05d
 * @requirement G3, G5
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { replaySession } from './ReplayEngine.js';
import { SessionTransitionService } from './SessionTransitionService.js';
import {
  checkpointTarget,
  collectRows,
  createRecordedSession,
  createRowCounters,
  expectNoHistoryField,
  forkBootOf,
  LARGE_N,
  PAGE_BOUND,
  PROJECT_HASH,
  SMALL_N,
  transitionOptions,
  type RecordedSession,
} from './p05dTestKit.js';

let chatsDir: string;
let tempRoot: string;

async function forkCheckpoint(
  session: RecordedSession,
  counters: ReturnType<typeof createRowCounters>,
) {
  if (session.checkpoints.length === 0) {
    throw new Error('fixture session has no checkpoint');
  }
  const target = await checkpointTarget(session, session.checkpoints[0]);
  return new SessionTransitionService(
    transitionOptions(counters.counters),
  ).forkFromCheckpoint(
    target,
    chatsDir,
    PROJECT_HASH,
    'anthropic',
    'claude-4',
    ['/test/workspace'],
  );
}

describe('P05d checkpoint fork journal-range copy @issue:854', () => {
  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'p05d-fork-'));
    chatsDir = path.join(tempRoot, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it(
    'fork seeds the child by range copy: correct prefix, zero content decode',
    verifyForkSeedsTheChildByRangeCopyCorrectPrefixZeroContentDecode,
  );

  it(
    'fork boot streams exactly the checkpoint prefix',
    verifyForkBootStreamsExactlyTheCheckpointPrefix,
  );

  it(
    'large no-compression checkpoint forks with bounded peak rows',
    verifyLargeNoCompressionCheckpointForksWithBoundedPeakRows,
    60_000,
  );

  it(
    'deleted checkpoint refuses to fork and counters still observe the pass',
    verifyDeletedCheckpointRefusesToForkAndCountersStillObserveThePass,
  );
});

async function verifyForkSeedsTheChildByRangeCopyCorrectPrefixZeroContentDecode(): Promise<void> {
  const session = await createRecordedSession(chatsDir, {
    rows: SMALL_N,
    checkpoint: 'keep',
    checkpointAfter: SMALL_N / 2,
  });
  const kit = createRowCounters();

  const fork = await forkCheckpoint(session, kit);

  expect(fork.ok).toBe(true);
  if (!fork.ok) return;
  expectNoHistoryField(fork);
  expect(fork.metadata.sessionId).not.toBe(session.sessionId);

  // Oracle: replay the seeded child with the existing engine.
  const childPath = fork.recording.getFilePath();
  expect(childPath).not.toBeNull();
  const child = await replaySession(childPath ?? '', PROJECT_HASH);
  expect(child.ok).toBe(true);
  if (!child.ok) return;
  expect(child.history).toStrictEqual(session.contents.slice(0, SMALL_N / 2));
  const childRaw = await fs.readFile(childPath ?? '', 'utf-8');
  expect(childRaw).toContain('session_forked');

  // The copy decoded zero content rows; envelope scans prove liveness.
  const stats = kit.snapshot();
  expect(stats.recordsDecoded).toBeGreaterThanOrEqual(1);
  expect(stats.rowsDecoded).toBe(0);
  expect(stats.peakDecodedRows).toBe(0);
}

async function verifyForkBootStreamsExactlyTheCheckpointPrefix(): Promise<void> {
  const session = await createRecordedSession(chatsDir, {
    rows: SMALL_N,
    checkpoint: 'keep',
    checkpointAfter: SMALL_N / 2,
  });
  const kit = createRowCounters();

  const fork = await forkCheckpoint(session, kit);

  expect(fork.ok).toBe(true);
  if (!fork.ok) return;
  const rows = await collectRows(forkBootOf(fork));
  expect(rows).toStrictEqual(session.contents.slice(0, SMALL_N / 2));
  const stats = kit.snapshot();
  expect(stats.peakDecodedRows).toBeLessThanOrEqual(PAGE_BOUND);
}

async function verifyLargeNoCompressionCheckpointForksWithBoundedPeakRows(): Promise<void> {
  const session = await createRecordedSession(chatsDir, {
    rows: LARGE_N,
    checkpoint: 'mid',
    checkpointAfter: LARGE_N / 2,
  });
  const kit = createRowCounters();

  const fork = await forkCheckpoint(session, kit);

  expect(fork.ok).toBe(true);
  if (!fork.ok) return;
  const stats = kit.snapshot();
  expect(stats.recordsDecoded).toBeGreaterThanOrEqual(1);
  expect(stats.rowsDecoded).toBe(0);
  expect(stats.peakDecodedRows).toBe(0);
  await fork.recording.dispose();
}

async function verifyDeletedCheckpointRefusesToForkAndCountersStillObserveThePass(): Promise<void> {
  const session = await createRecordedSession(chatsDir, {
    rows: 4,
    checkpoint: 'gone',
  });
  const kit = createRowCounters();
  if (session.checkpoints.length === 0) {
    throw new Error('fixture has no checkpoint');
  }
  const info = session.checkpoints[0];
  const target = await checkpointTarget(session, info);
  // Tombstone the checkpoint directly in the journal bytes.
  const raw = await fs.readFile(session.filePath, 'utf-8');
  const lines = raw
    .trimEnd()
    .split('\n')
    .map((line) => {
      if (!line.includes(info.checkpointId)) return line;
      const envelope = JSON.parse(line) as {
        type: string;
        payload: Record<string, unknown>;
      };
      envelope.type = 'checkpoint_deleted';
      envelope.payload = { checkpointId: info.checkpointId };
      return JSON.stringify(envelope);
    });
  await fs.writeFile(session.filePath, `${lines.join('\n')}\n`, 'utf-8');

  const fork = await new SessionTransitionService(
    transitionOptions(kit.counters),
  ).forkFromCheckpoint(
    target,
    chatsDir,
    PROJECT_HASH,
    'anthropic',
    'claude-4',
    ['/test/workspace'],
  );

  expect(fork.ok).toBe(false);
  if (fork.ok) return;
  expect(fork.error).toContain('not live');
  const stats = kit.snapshot();
  expect(stats.recordsDecoded).toBeGreaterThanOrEqual(1);
  expect(stats.rowsDecoded).toBe(0);
}
