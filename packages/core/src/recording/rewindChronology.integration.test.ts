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
 * Behavioural tests for issue #2934: `/chat clear` and `/chat restore N` must
 * stay applied across a resume even when density optimization has shrunk live
 * history without journalling anything.
 *
 * The divergence is produced by the real mechanism — real HistoryService,
 * real RecordingIntegration, real SessionRecordingService, real
 * applyDensityResult, real replaySession, real files — never simulated by
 * hand-writing journal lines.
 *
 * @issue #2934
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { SessionRecordingService } from './SessionRecordingService.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { HistoryMutationService } from './HistoryMutationService.js';
import { replaySession } from './ReplayEngine.js';
import { type SessionRecordingServiceConfig } from './types.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { type IContent } from '../services/history/IContent.js';
import {
  type DensityResult,
  type DensityResultMetadata,
} from '../core/compression/types.js';

const PROJECT_HASH = 'rewind-chronology-hash';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContent(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function makeDensityMetadata(): DensityResultMetadata {
  return {
    readWritePairsPruned: 0,
    fileDeduplicationsPruned: 0,
    recencyPruned: 0,
  };
}

function makeDensityResult(
  removals: readonly number[],
  replacements: ReadonlyMap<number, IContent> = new Map(),
): DensityResult {
  return { removals, replacements, metadata: makeDensityMetadata() };
}

function textOf(content: IContent): string {
  const block = content.blocks[0];
  return block.type === 'text' ? block.text : '';
}

function textsOf(history: readonly IContent[]): string[] {
  return history.map(textOf);
}

function seqsOf(history: readonly IContent[]): Array<number | undefined> {
  return history.map((item) => item.metadata?.chronology?.seq);
}

function requireReplaySuccess(
  result: Awaited<ReturnType<typeof replaySession>>,
): asserts result is Extract<
  Awaited<ReturnType<typeof replaySession>>,
  { ok: true }
> {
  if (!result.ok) throw new Error(`Expected replay success: ${result.error}`);
}

function requireMutationSuccess<T extends { ok: boolean }>(
  result: T,
): asserts result is T & { ok: true } {
  if (!result.ok) throw new Error('Expected history mutation success');
}

/**
 * Registers the temp-dir lifecycle hooks and returns a lazy accessor for the
 * chats directory.
 */
function useChatsDir(): () => string {
  let dir = '';
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rewind-chronology-'));
    await fs.mkdir(path.join(dir, 'chats'), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  return () => path.join(dir, 'chats');
}

function makeConfig(chatsDir: string): SessionRecordingServiceConfig {
  return {
    sessionId: crypto.randomUUID(),
    projectHash: PROJECT_HASH,
    chatsDir,
    workspaceDirs: ['/test/workspace'],
    provider: 'anthropic',
    model: 'claude-4',
  };
}

/**
 * A live session: a real HistoryService whose additions are journalled by a
 * real SessionRecordingService through the real RecordingIntegration bridge.
 */
interface LiveSession {
  readonly history: HistoryService;
  readonly recording: SessionRecordingService;
}

function startSession(chatsDir: string): LiveSession {
  const recording = new SessionRecordingService(makeConfig(chatsDir));
  const history = new HistoryService();
  new RecordingIntegration(recording).subscribeToHistory(history);
  return { history, recording };
}

async function addTurns(
  session: LiveSession,
  entries: readonly IContent[],
): Promise<void> {
  for (const entry of entries) {
    session.history.add(entry);
  }
  await session.history.waitForTokenUpdates();
  await session.recording.flush();
}

/** Replay the session file from disk after closing the recording. */
async function replayFromDisk(
  session: LiveSession,
): Promise<readonly IContent[]> {
  const filePath = session.recording.getFilePath();
  expect(filePath).not.toBeNull();
  await session.recording.dispose();
  const replay = await replaySession(filePath as string, PROJECT_HASH);
  requireReplaySuccess(replay);
  return replay.history;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rewind survives density divergence @issue:2934', () => {
  const chatsDir = useChatsDir();

  it('restore keeps the removed turns removed after replay', async () => {
    const session = startSession(chatsDir());
    // Turn 3 owns a tool result that density will prune from live history.
    // Nothing before the restore cut is pruned, so a correct replay reproduces
    // the live post-restore history exactly.
    await addTurns(session, [
      makeContent('Q1', 'human'),
      makeContent('A1', 'ai'),
      makeContent('Q2', 'human'),
      makeContent('A2', 'ai'),
      makeContent('Q3', 'human'),
      makeContent('A3', 'ai'),
      makeContent('T3', 'tool'),
      makeContent('A3-followup', 'ai'),
    ]);

    // Density prunes the tool result inside the most recent turn. The journal
    // learns nothing about it, so live history is now one item shorter.
    await session.history.applyDensityResult(makeDensityResult([6]));
    await session.history.waitForTokenUpdates();
    expect(textsOf(session.history.getAll())).toStrictEqual([
      'Q1',
      'A1',
      'Q2',
      'A2',
      'Q3',
      'A3',
      'A3-followup',
    ]);

    const live = [...session.history.getAll()];
    const result = await new HistoryMutationService().restore(
      live,
      1,
      session.recording,
    );
    requireMutationSuccess(result);
    expect(textsOf(result.remainingHistory)).toStrictEqual([
      'Q1',
      'A1',
      'Q2',
      'A2',
    ]);

    const replayed = await replayFromDisk(session);

    expect(textsOf(replayed)).toStrictEqual(textsOf(result.remainingHistory));
    expect(textsOf(replayed)).not.toContain('Q3');
  });

  it('clear does not resurrect cleared turns after replay', async () => {
    const session = startSession(chatsDir());
    await addTurns(session, [
      makeContent('Q1', 'human'),
      makeContent('A1', 'ai'),
      makeContent('T1', 'tool'),
      makeContent('Q2', 'human'),
      makeContent('A2', 'ai'),
      makeContent('T2', 'tool'),
      makeContent('Q3', 'human'),
    ]);

    // Density prunes a tool result that belongs to a turn the clear removes.
    await session.history.applyDensityResult(makeDensityResult([5]));
    await session.history.waitForTokenUpdates();

    const live = [...session.history.getAll()];
    const result = await new HistoryMutationService().clear(
      live,
      session.recording,
    );
    requireMutationSuccess(result);
    expect(textsOf(result.remainingHistory)).toStrictEqual(['Q1', 'A1', 'T1']);

    const replayed = await replayFromDisk(session);

    expect(textsOf(replayed)).toStrictEqual(textsOf(result.remainingHistory));
    expect(textsOf(replayed)).not.toContain('Q2');
    expect(textsOf(replayed)).not.toContain('Q3');
  });

  it('token total after replay matches the token total after the live restore', async () => {
    const session = startSession(chatsDir());
    await addTurns(session, [
      makeContent('first question', 'human'),
      makeContent('first answer', 'ai'),
      makeContent('second question', 'human'),
      makeContent('second answer', 'ai'),
      makeContent('third question', 'human'),
      makeContent('third answer', 'ai'),
      makeContent('a tool result that density will prune', 'tool'),
      makeContent('third answer continued', 'ai'),
    ]);

    await session.history.applyDensityResult(makeDensityResult([6]));
    await session.history.waitForTokenUpdates();

    const live = [...session.history.getAll()];
    const result = await new HistoryMutationService().restore(
      live,
      1,
      session.recording,
    );
    requireMutationSuccess(result);

    const replayed = await replayFromDisk(session);

    const estimator = new HistoryService();
    const liveTokens = await estimator.estimateTokensForContents([
      ...result.remainingHistory,
    ]);
    const replayedTokens = await estimator.estimateTokensForContents([
      ...replayed,
    ]);

    expect(liveTokens).toBeGreaterThan(0);
    expect(replayedTokens).toBe(liveTokens);
  });

  it('keeps the cut aligned when density replaced an item before the cut', async () => {
    const session = startSession(chatsDir());
    await addTurns(session, [
      makeContent('Q1', 'human'),
      makeContent('A1', 'ai'),
      makeContent('T1', 'tool'),
      makeContent('Q2', 'human'),
      makeContent('A2', 'ai'),
    ]);

    // A truncating replacement inherits the replaced item's chronology marker,
    // and a removal after the cut shortens live history.
    const truncated = makeContent('T1 (truncated)', 'tool');
    await session.history.applyDensityResult(
      makeDensityResult([4], new Map([[2, truncated]])),
    );
    await session.history.waitForTokenUpdates();

    const live = [...session.history.getAll()];
    const result = await new HistoryMutationService().clear(
      live,
      session.recording,
    );
    requireMutationSuccess(result);
    expect(textsOf(result.remainingHistory)).toStrictEqual([
      'Q1',
      'A1',
      'T1 (truncated)',
    ]);

    const replayed = await replayFromDisk(session);

    // The journal never learned about the truncation (issue #1393), so the
    // replayed tool result still carries its original text. What must hold is
    // that the cut landed on the same chronology positions.
    expect(seqsOf(replayed)).toStrictEqual(seqsOf(result.remainingHistory));
    expect(textsOf(replayed)).not.toContain('Q2');
  });

  it('restoring more turns than exist empties the replayed history', async () => {
    const session = startSession(chatsDir());
    await addTurns(session, [
      makeContent('Q1', 'human'),
      makeContent('A1', 'ai'),
      makeContent('T1', 'tool'),
      makeContent('Q2', 'human'),
    ]);

    await session.history.applyDensityResult(makeDensityResult([2]));
    await session.history.waitForTokenUpdates();

    const live = [...session.history.getAll()];
    const result = await new HistoryMutationService().restore(
      live,
      5,
      session.recording,
    );
    requireMutationSuccess(result);
    expect(result.remainingHistory).toStrictEqual([]);

    const replayed = await replayFromDisk(session);
    expect(replayed).toStrictEqual([]);
  });

  it('records no cut marker when the cut item carries no chronology marker', async () => {
    const recording = new SessionRecordingService(makeConfig(chatsDir()));
    // Unmarked history: recorded directly, never passed through HistoryService,
    // so no chronology marker was ever stamped.
    const history: IContent[] = [
      makeContent('Q1', 'human'),
      makeContent('A1', 'ai'),
      makeContent('Q2', 'human'),
      makeContent('A2', 'ai'),
    ];
    for (const entry of history) recording.recordContent(entry);
    await recording.flush();

    const result = await new HistoryMutationService().restore(
      history,
      1,
      recording,
    );
    requireMutationSuccess(result);

    const filePath = recording.getFilePath();
    expect(filePath).not.toBeNull();
    await recording.dispose();

    const raw = await fs.readFile(filePath as string, 'utf8');
    const rewindLines = raw
      .split('\n')
      .filter((line) => line.includes('"type":"rewind"'));
    expect(rewindLines).toHaveLength(1);
    expect(rewindLines[0]).not.toContain('cutSeq');

    const replay = await replaySession(filePath as string, PROJECT_HASH);
    requireReplaySuccess(replay);
    expect(textsOf(replay.history)).toStrictEqual(['Q1', 'A1']);
  });
});
