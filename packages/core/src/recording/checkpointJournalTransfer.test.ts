/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SessionTransitionService,
  type ForkResult,
} from './SessionTransitionService.js';
import { SessionLockManager } from './SessionLockManager.js';
import { replaySession, replaySessionThroughSequence } from './ReplayEngine.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import { MediaAdmissionService } from '../storage/media-admission-service.js';
import { HistoryMediaOwnership } from '../storage/history-media-ownership.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { createRowCounters } from './journalCounters.js';
import type { IContent } from '../services/history/IContent.js';
import type { ContinueTarget } from './types.js';

const time = '2026-09-21T00:00:00.000Z';
function row(text: string, seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: seq, step: 1, recordedAt: 1 } },
  };
}

let root: string;

let source: string;

let forks: ForkResult[];

async function fixture(
  events: ReadonlyArray<{ type: string; payload: unknown }>,
): Promise<Extract<ContinueTarget, { kind: 'checkpoint' }>> {
  const header = {
    type: 'session_start',
    payload: {
      sessionId: 'source',
      projectHash: 'project',
      provider: 'old',
      model: 'old',
      workspaceDirs: [],
      startTime: time,
      kind: 'subagent',
    },
  };
  const checkpoint = {
    type: 'checkpoint_created',
    payload: { checkpointId: 'checkpoint', name: 'cut' },
  };
  const sequence = events.length + 2;
  const lines = [
    header,
    ...events,
    checkpoint,
    { type: 'content', payload: { content: row('after', 999) } },
  ].map((event, index) =>
    JSON.stringify({ v: 1, seq: index + 1, ts: time, ...event }),
  );
  await writeFile(source, `${lines.join('\n')}\n`);
  return {
    kind: 'checkpoint',
    source: {
      sessionId: 'source',
      projectHash: 'project',
      filePath: source,
      startTime: time,
      lastModified: new Date(time),
      fileSize: 0,
      provider: 'old',
      model: 'old',
    },
    checkpointId: 'checkpoint',
    checkpointName: 'cut',
    sequence,
  };
}

async function fork(
  target: Extract<ContinueTarget, { kind: 'checkpoint' }>,
  maxQueueBytes?: number,
  mediaStore?: LocalMediaStore,
): Promise<ForkResult> {
  const kit = createRowCounters();
  const result = await new SessionTransitionService({
    counters: kit.counters,
    maxQueueBytes,
    mediaStore,
  }).forkFromCheckpoint(target, root, 'project', 'new', 'new', []);
  if (!result.ok) throw new Error(result.error);
  forks.push(result);
  expect(kit.snapshot().recordsDecoded).toBeGreaterThan(0);
  expect(kit.snapshot().rowsDecoded).toBe(0);
  return result;
}

describe('checkpoint logical journal range', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'checkpoint-range-'));
    source = join(root, 'session-source.jsonl');
    forks = [];
  });
  afterEach(async () => {
    for (const fork of forks) await fork.recording.dispose();
    await rm(root, { recursive: true, force: true });
  });

  it(
    'copies purge, compression and chronology rewinds without reconstructing rows',
    verifyCopiesPurgeCompressionAndChronologyRewindsWithoutReconstructingRows,
  );

  it(
    'preserves density replacements, removals, synthetic placement and subsequent rewinds',
    verifyPreservesDensityReplacementsRemovalsSyntheticPlacementAndSubsequentRewinds,
  );

  it(
    'copies legacy chronology bindings before addressed mutations',
    verifyCopiesLegacyChronologyBindingsBeforeAddressedMutations,
  );

  it(
    'releases cursor resources on stream cancellation and recording disposal while preserving append continuity',
    verifyReleasesCursorResourcesOnStreamCancellationAndRecordingDisposalWhilePreservingAppend,
  );

  it(
    'adopts copied media references and releases live ownership on disposal',
    verifyAdoptsCopiedMediaReferencesAndReleasesLiveOwnershipOnDisposal,
  );

  it(
    'removes a prepared child if releasing the source lock fails',
    verifyRemovesAPreparedChildIfReleasingTheSourceLockFails,
  );

  it(
    'removes the child and both locks when recorder creation fails after range copying',
    verifyRemovesTheChildAndBothLocksWhenRecorderCreationFailsAfterRange,
  );

  it(
    'refuses an empty checkpoint fold without leaving a child or source lock',
    verifyRefusesAnEmptyCheckpointFoldWithoutLeavingAChildOrSourceLock,
  );
});

async function verifyCopiesPurgeCompressionAndChronologyRewindsWithoutReconstructingRows(): Promise<void> {
  const target = await fixture([
    { type: 'content', payload: { content: row('old', 1) } },
    {
      type: 'compressed',
      payload: { summary: row('summary', 2), itemsCompressed: 1 },
    },
    { type: 'content', payload: { content: row('head', 3) } },
    {
      type: 'semantic_media_purge',
      payload: {
        history: [row('purged summary', 2), row('purged head', 3)],
        frontier: { contentIndex: 0, blockIndex: 0 },
      },
    },
    { type: 'content', payload: { content: row('discard', 4) } },
    { type: 'rewind', payload: { itemsRemoved: 1, cutSeq: 4 } },
  ]);
  const result = await fork(target);
  const oracle = await replaySessionThroughSequence(
    source,
    'project',
    target.sequence,
  );
  if (!oracle.ok) throw new Error(oracle.error);
  const rows = await Array.fromAsync(result.boot.streamRows());
  expect(rows).toStrictEqual(oracle.history);
  const child = await replaySession(result.boot.filePath, 'project');
  if (!child.ok) throw new Error(child.error);
  expect(child.history).toStrictEqual(oracle.history);
  expect(child.metadata).toMatchObject({
    sessionId: result.metadata.sessionId,
    kind: 'main',
    provider: 'new',
    model: 'new',
  });
  expect(child.ancestry?.parentSequence).toBe(target.sequence);
}

async function verifyPreservesDensityReplacementsRemovalsSyntheticPlacementAndSubsequentRewinds(): Promise<void> {
  const target = await fixture([
    { type: 'content', payload: { content: row('A', 1) } },
    { type: 'content', payload: { content: row('B', 2) } },
    { type: 'content', payload: { content: row('C', 3) } },
    {
      type: 'density_mutation',
      payload: {
        removedSeqs: [2],
        replacements: [{ replacedSeq: 1, replacement: row('A replaced', 1) }],
      },
    },
    {
      type: 'synthetic_insert',
      payload: { content: row('inserted', 4), chronologySeq: 4, afterSeq: 1 },
    },
    { type: 'rewind', payload: { itemsRemoved: 1, cutSeq: 3 } },
  ]);
  const result = await fork(target);
  expect(await Array.fromAsync(result.boot.streamRows())).toStrictEqual([
    row('A replaced', 1),
    row('inserted', 4),
  ]);
}

async function verifyCopiesLegacyChronologyBindingsBeforeAddressedMutations(): Promise<void> {
  const target = await fixture([
    {
      type: 'content',
      payload: {
        content: {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'legacy' }],
        },
      },
    },
    {
      type: 'chronology_bind',
      payload: {
        rowIndex: 0,
        chronology: row('legacy', 10).metadata?.chronology,
      },
    },
    {
      type: 'synthetic_insert',
      payload: {
        content: row('inserted', 11),
        chronologySeq: 11,
        afterSeq: 10,
      },
    },
  ]);
  const result = await fork(target);
  expect(await Array.fromAsync(result.boot.streamRows())).toStrictEqual([
    row('legacy', 10),
    row('inserted', 11),
  ]);
}

async function verifyReleasesCursorResourcesOnStreamCancellationAndRecordingDisposalWhilePreservingAppend(): Promise<void> {
  const target = await fixture([
    { type: 'content', payload: { content: row('prefix', 1) } },
  ]);
  const result = await fork(target);
  for await (const content of result.boot.streamRows()) {
    expect(content.blocks).toStrictEqual(row('prefix', 1).blocks);
    break;
  }
  await expect(Array.fromAsync(result.boot.streamRows())).rejects.toThrow(
    'closed',
  );
  result.recording.recordContent(row('continued', 2));
  await result.recording.dispose();
  expect(
    await SessionLockManager.isLocked(root, result.metadata.sessionId),
  ).toBe(false);
  const replay = await replaySession(result.boot.filePath, 'project');
  if (!replay.ok) throw new Error(replay.error);
  expect(replay.history).toStrictEqual([row('prefix', 1), row('continued', 2)]);
  expect(replay.sequenceCorrupt).toBe(false);
}

async function verifyAdoptsCopiedMediaReferencesAndReleasesLiveOwnershipOnDisposal(): Promise<void> {
  const store = new LocalMediaStore({
    rootDirectory: join(root, 'media'),
    quotaBytes: 1024 * 1024,
  });
  const admission = new MediaAdmissionService(store);
  const context = { turnId: 'fixture', source: 'user-input' };
  const admitted = await admission.admitContents(
    [
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'base64',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
          },
        ],
      },
    ],
    context,
  );
  const block = admitted[0].blocks[0];
  if (block.type !== 'media' || block.encoding !== 'reference')
    throw new Error('Missing reference');
  await admission.releaseContents(admitted, context);
  const target = await fixture([
    { type: 'content', payload: { content: admitted[0] } },
  ]);
  const result = await fork(target, undefined, store);
  expect(await store.hasReservations(block.contentId)).toBe(false);
  const history = new HistoryService();
  history.registerMediaOwner(new HistoryMediaOwnership(store));
  try {
    await history.adoptResumeBoot(result.recording, result.boot);
    expect(await store.hasReservations(block.contentId)).toBe(true);
    expect(
      (await Array.fromAsync(result.boot.streamRows()))[0].blocks,
    ).toStrictEqual(admitted[0].blocks);
  } finally {
    history.dispose();
    await history.waitForOwnershipSettlement();
  }
  expect(await store.hasReservations(block.contentId)).toBe(false);
  await store.close();
}

async function verifyRemovesAPreparedChildIfReleasingTheSourceLockFails(): Promise<void> {
  const target = await fixture([
    { type: 'content', payload: { content: row('prefix', 1) } },
  ]);
  const acquire = SessionLockManager.acquire.bind(SessionLockManager);
  const injected = spyOn(SessionLockManager, 'acquire').mockImplementation(
    async (directory, id) => {
      const handle = await acquire(directory, id);
      if (id !== 'source') return handle;
      return {
        ...handle,
        release: async () => {
          await handle.release();
          throw new Error('source release failed');
        },
      };
    },
  );
  try {
    const result = await new SessionTransitionService().forkFromCheckpoint(
      target,
      root,
      'project',
      'new',
      'new',
      [],
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      forks.push(result);
      throw new Error('Unexpected successful fork');
    }
    expect(result.error).toContain('source release failed');
    expect(await readdir(root)).toStrictEqual(['session-source.jsonl']);
  } finally {
    injected.mockRestore();
  }
}

async function verifyRemovesTheChildAndBothLocksWhenRecorderCreationFailsAfterRange(): Promise<void> {
  const target = await fixture([
    { type: 'content', payload: { content: row('prefix', 1) } },
  ]);
  await expect(fork(target, -1)).rejects.toThrow('queue byte limit');
  expect(await readdir(root)).toStrictEqual(['session-source.jsonl']);
}

async function verifyRefusesAnEmptyCheckpointFoldWithoutLeavingAChildOrSourceLock(): Promise<void> {
  const target = await fixture([
    { type: 'content', payload: { content: row('removed', 1) } },
    { type: 'rewind', payload: { itemsRemoved: 1 } },
  ]);
  await expect(fork(target)).rejects.toThrow('no conversation history');
  expect(await readdir(root)).toStrictEqual(['session-source.jsonl']);
}
