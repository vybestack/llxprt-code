/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, open, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionTransitionService } from './SessionTransitionService.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { JournalSession } from '../services/history/journalSession.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';
import type { IContent } from '../services/history/IContent.js';
import { HistoryMediaOwnership } from '../storage/history-media-ownership.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import { MediaAdmissionService } from '../storage/media-admission-service.js';
import { readJournalSnapshot } from './__tests__/support/journalSnapshot.js';
import {
  recordingConfig,
  requireBoot,
} from './__tests__/support/journalRecordingFixture.js';
import { SessionLockManager } from './SessionLockManager.js';
import type { ContinueTarget } from './types.js';

function row(text: string, seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { chronology: { seq, userTurn: seq, step: 1, recordedAt: 1 } },
  };
}
const draft = (content: IContent): ReturnType<typeof encodeContentRow> =>
  encodeContentRow(content, { owner: 0 });
type Target = Extract<ContinueTarget, { kind: 'checkpoint' }>;
type Child = Extract<
  Awaited<ReturnType<SessionTransitionService['forkFromCheckpoint']>>,
  { ok: true }
>;
let root: string;
let source: string;
let children: Child[];

async function fixture(
  seed: (session: JournalSession) => Promise<void>,
): Promise<Target> {
  const recording = JournalRecordingService.create(
    recordingConfig(root, {
      sessionId: 'source',
      projectHash: 'project',
      kind: 'subagent',
    }),
  );
  try {
    const session = await recording.session();
    await seed(session);
    const cp = await recording.createCheckpoint('cut');
    await session.append([row('after', 999)]);
    const file = recording.getFilePath();
    if (file === null) throw new Error('Missing source journal');
    source = file;
    return {
      kind: 'checkpoint',
      checkpointId: cp.checkpointId,
      checkpointName: cp.name,
      sequence: cp.sequence,
      source: {
        sessionId: 'source',
        projectHash: 'project',
        filePath: file,
        startTime: new Date().toISOString(),
        lastModified: new Date(),
        fileSize: 0,
        provider: 'test',
        model: 'model',
      },
    };
  } finally {
    await recording.dispose();
  }
}
async function fork(
  target: Target,
  mediaStore?: LocalMediaStore,
): Promise<Child> {
  const result = await new SessionTransitionService({
    mediaStore,
  }).forkFromCheckpoint(target, root, 'project', 'new', 'new', []);
  if (!result.ok) throw new Error(result.error);
  requireBoot(result);
  children.push(result);
  return result;
}

describe('checkpoint logical journal range', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'checkpoint-range-'));
    children = [];
  });
  afterEach(async () => {
    for (const child of children) await child.recording.dispose();
    await rm(root, { recursive: true, force: true });
  });

  it('copies purge, compression and chronology rewinds into the child', async () => {
    const target = await fixture(async (session) => {
      await session.append([row('old', 1)]);
      await session.store.commit([
        {
          kind: 'compress',
          summary: draft(row('summary', 2)),
          retainFromLabel: session.store.published?.nextLabel ?? 1n,
          expectedReplaced: 1,
        },
      ]);
      await session.append([row('head', 3)]);
      const entries = await Array.fromAsync(session.rows());
      await session.store.commit([
        {
          kind: 'purge',
          rows: entries.map((entry, index) => ({
            label: entry.entry.label,
            draft: draft(
              row(index === 0 ? 'purged summary' : 'purged head', index + 2),
            ),
          })),
        },
      ]);
      await session.append([row('discard', 4)]);
      const tail = (await Array.fromAsync(session.rows()))[2];
      await session.store.commit([
        { kind: 'pop', cutLabel: tail.entry.label, expectedRemoved: 1 },
      ]);
    });
    const child = await fork(target);
    const expected = [row('purged summary', 2), row('purged head', 3)];
    expect(await Array.fromAsync(child.boot.streamRows())).toStrictEqual(
      expected,
    );
    const file = child.recording.getFilePath();
    if (file === null) throw new Error('Missing child');
    const saved = await readJournalSnapshot(file, 'project');
    expect(saved.history).toStrictEqual(expected);
    expect(saved.metadata).toMatchObject({
      sessionId: child.metadata.sessionId,
      kind: 'main',
      provider: 'new',
      model: 'new',
    });
    expect(saved.ancestry).toMatchObject({ parentSequence: target.sequence });
  });

  it('preserves density replacements, removals, synthetic placement and subsequent rewinds', async () => {
    const target = await fixture(async (session) => {
      await session.append([row('A', 1), row('B', 2), row('C', 3)]);
      const entries = await Array.fromAsync(session.rows());
      await session.store.commit([
        {
          kind: 'density',
          removed: [entries[1].entry.label],
          replacements: [
            {
              label: entries[0].entry.label,
              draft: draft(row('A replaced', 1)),
            },
          ],
        },
      ]);
      await session.store.commit([
        {
          kind: 'insert',
          afterLabel: entries[0].entry.label,
          draft: draft(row('inserted', 4)),
        },
      ]);
      await session.store.commit([
        { kind: 'pop', cutLabel: entries[2].entry.label, expectedRemoved: 1 },
      ]);
    });
    expect(
      await Array.fromAsync((await fork(target)).boot.streamRows()),
    ).toStrictEqual([row('A replaced', 1), row('inserted', 4)]);
  });

  it('allows stream cancellation and disposal while preserving append continuity', async () => {
    const target = await fixture(async (session) => {
      await session.append([row('prefix', 1)]);
    });
    const child = await fork(target);
    for await (const content of child.boot.streamRows()) {
      expect(content).toStrictEqual(row('prefix', 1));
      break;
    }
    const recording = child.recording;
    if (!(recording instanceof JournalRecordingService))
      throw new Error('Expected journal');
    await (await recording.session()).append([row('continued', 2)]);
    const file = recording.getFilePath();
    if (file === null) throw new Error('Missing child');
    await recording.dispose();
    expect(
      await SessionLockManager.isLocked(root, recording.getSessionId()),
    ).toBe(false);
    expect((await readJournalSnapshot(file, 'project')).history).toStrictEqual([
      row('prefix', 1),
      row('continued', 2),
    ]);
  });

  it('adopts copied media references and releases live ownership on disposal', async () => {
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
    const target = await fixture(async (session) => {
      await session.append(admitted);
    });
    const child = await fork(target, store);
    expect(await store.hasReservations(block.contentId)).toBe(false);
    const history = new HistoryService();
    await history.registerMediaOwner(new HistoryMediaOwnership(store));
    try {
      await history.adoptResumeBoot(child.recording, child.boot);
      expect(await store.hasReservations(block.contentId)).toBe(true);
      expect(
        (await Array.fromAsync(history.streamRawHistory()))[0].blocks,
      ).toStrictEqual(admitted[0].blocks);
    } finally {
      await history.dispose();
      await history.waitForOwnershipSettlement();
    }
    expect(await store.hasReservations(block.contentId)).toBe(false);
    await store.close();
  });

  it('removes a prepared child if releasing the source lock fails', async () => {
    const target = await fixture(async (session) => {
      await session.append([row('prefix', 1)]);
    });
    const acquire = SessionLockManager.acquire.bind(SessionLockManager);
    const injected = spyOn(SessionLockManager, 'acquire').mockImplementation(
      async (directory, id) => {
        const handle = await acquire(directory, id);
        return id !== 'source'
          ? handle
          : {
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
        children.push(result);
        throw new Error('Unexpected successful fork');
      }
      expect(result.error).toContain('source release failed');
      expect(await readdir(root)).toStrictEqual([
        source.slice(root.length + 1),
      ]);
    } finally {
      injected.mockRestore();
    }
  });

  it('removes the child and both locks when recorder creation fails after copying', async () => {
    const target = await fixture(async (session) => {
      await session.append([row('prefix', 1)]);
    });
    let childOpens = 0;
    const result = await new SessionTransitionService({
      journal: {
        journal: {
          open: async (file, flags) => {
            if (file !== source && flags === 'r+' && ++childOpens === 2)
              throw new Error('recorder creation failed');
            return open(file, flags);
          },
        },
      },
    }).forkFromCheckpoint(target, root, 'project', 'new', 'new', []);
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('recorder creation failed'),
    });
    expect(await readdir(root)).toStrictEqual([source.slice(root.length + 1)]);
    expect(await SessionLockManager.isLocked(root, 'source')).toBe(false);
  });

  it('refuses an empty checkpoint without leaving a child or source lock', async () => {
    const target = await fixture(async (session) => {
      await session.append([row('removed', 1)]);
    });
    const recording = await JournalRecordingService.open(
      recordingConfig(root, { sessionId: 'source', projectHash: 'project' }),
      source,
    );
    const session = await recording.session();
    await session.store.commit([{ kind: 'clear' }]);
    await session.store.commit([
      { kind: 'checkpoint', id: 'empty', name: 'empty', createdAtMs: 1 },
    ]);
    await recording.dispose();
    await expect(
      fork({ ...target, checkpointId: 'empty', checkpointName: 'empty' }),
    ).rejects.toThrow('no conversation history');
    expect(await readdir(root)).toStrictEqual([source.slice(root.length + 1)]);
  });
});
