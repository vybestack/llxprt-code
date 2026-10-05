import { collectRowsForAssertions } from '../../test-utils/collect-rows-for-assertions.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, afterEach, beforeEach, expect, it, spyOn } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import * as filesystem from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HistoryService } from './HistoryService.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import type { IContent } from './IContent.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import { ResumeCursorBoot } from '../../recording/resumeCursorBoot.js';
import { JournalResolver } from '../../recording/journalResolver.js';
import { copyCheckpointRange } from '../../recording/checkpointJournalTransfer.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { HistoryMediaOwnership } from '../../storage/history-media-ownership.js';
import { reclaimSessionMedia } from '../../recording/janitor/mediaReclamation.js';

const inline: IContent = {
  speaker: 'human',
  blocks: [
    {
      type: 'media',
      mimeType: 'image/png',
      encoding: 'base64',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
    },
  ],
};
function response(text: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { responsesStored: true },
  };
}
async function rows(file: string): Promise<IContent[]> {
  const resolver = await JournalResolver.open(file);
  try {
    return (await Array.fromAsync(resolver.resolve())).map(
      (entry) => entry.content,
    );
  } finally {
    await resolver.close();
  }
}
function pathOf(history: HistoryService): string {
  const file = history.journalPath();
  if (!file) throw new Error('Missing journal');
  return file;
}

let root: string;
let project: string;
let store: LocalMediaStore;
let history: HistoryService;
let recording: SessionRecordingService;
let boot: ResumeCursorBoot;
const expectedReopened = {
  rows: 3,
  storedRows: [2],
  chronology: [2, 1, 3],
  verifiedMedia: 1,
  skippedProjects: 0,
};
describe('durable resume projection', () => {
  beforeEach(setupDurability);
  afterEach(async () => {
    history.dispose();
    await history.waitForOwnershipSettlement();
    await boot.close();
    await recording.dispose();
    await store.close();
    await rm(root, { recursive: true, force: true });
  });
  it(
    'does not carry resumed invalidation into later addressed replacements, insertions or compression',
    preserveLiveMutations,
  );
  it(
    'reopens in a fresh process after closing every resume and media owner',
    reopenInChild,
  );
  it(
    'reopens durable JSONL in a child launched outside the repository',
    reopenOutsideRepository,
  );
  it(
    'releases only temporary ownership after deleting the permanent source',
    releaseTemporaryOwner,
  );
  it(
    'keeps partial durable media bindings valid when the next binding fails and rolls back the live owner',
    recoverPartialBindings,
  );
  it(
    'persists admitted media and invalidates only resumed markers before any later mutation',
    persistProjection,
  );
  it(
    'survives mutate, raw detach, reattach and checkpoint range copy without a projection owner',
    detachAndCopy,
  );
  it(
    'protects permanent references through the existing journal reclamation scan after owner shutdown',
    protectPermanentMedia,
  );
  it(
    'removes the projection even when committed retirement reports an observer failure',
    retireFailedObserver,
  );
});

async function setupDurability(): Promise<void> {
  root = await mkdtemp(join(tmpdir(), 'resume-durability-'));
  project = join(root, 'a'.repeat(64));
  store = new LocalMediaStore({
    rootDirectory: join(project, 'media'),
    quotaBytes: 1024 * 1024,
  });
  recording = new SessionRecordingService({
    sessionId: 'durability',
    projectHash: 'project',
    chatsDir: join(project, 'chats'),
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  await recording.commit('content', { content: inline });
  const watermark = await recording.commit('content', {
    content: {
      ...response('old'),
      metadata: {
        responsesStored: true,
        chronology: { seq: 1, userTurn: 1, step: 2, recordedAt: 1 },
      },
    },
  });
  const file = recording.getFilePath();
  if (!file) throw new Error('Missing file');
  boot = await ResumeCursorBoot.open(
    file,
    watermark.seq,
    watermark.byteOffset,
    undefined,
    store,
  );
  history = new HistoryService();
  history.registerMediaOwner(new HistoryMediaOwnership(store));
}

async function retireFailedObserver(): Promise<void> {
  const remove = filesystem.rm;
  const directories: string[] = [];
  const capture = spyOn(filesystem, 'rm').mockImplementation(
    async (...args: Parameters<typeof filesystem.rm>) => {
      await remove(...args);
      if (String(args[0]).includes('history-projection-'))
        directories.push(String(args[0]));
    },
  );
  history.onJournalRetired(() => {
    throw new Error('retirement observer fault');
  });
  try {
    const warnings = await history.adoptResumeBoot(recording, boot);
    expect(warnings.join(' ')).toContain('retirement observer fault');
    expect(directories).toHaveLength(1);
    await expect(access(directories[0])).rejects.toThrow('ENOENT');
    expect((await rows(boot.filePath))[0].blocks[0]).toMatchObject({
      encoding: 'reference',
    });
  } finally {
    capture.mockRestore();
  }
}

async function preserveLiveMutations(): Promise<void> {
  await history.adoptResumeBoot(recording, boot);
  await collectRowsForAssertions(
    history.streamRawHistory(),
    async (snapshotRows) => {
      const replacement = {
        ...response('replacement'),
        metadata: {
          ...response('replacement').metadata,
          chronology: snapshotRows[1].metadata?.chronology,
        },
      };
      await recording.commit('density_mutation', {
        removedSeqs: [2],
        replacements: [{ replacedSeq: 1, replacement }],
      });
      const synthetic = {
        ...response('inserted'),
        metadata: {
          responsesStored: true,
          chronology: { seq: 3, userTurn: 1, step: 3, recordedAt: 3 },
        },
      };
      await recording.commit('synthetic_insert', {
        chronologySeq: 3,
        afterSeq: 1,
        content: synthetic,
      });
      expect(await rows(boot.filePath)).toStrictEqual([replacement, synthetic]);
      await recording.commit('rewind', { itemsRemoved: 1, cutSeq: 3 });
      expect(await rows(boot.filePath)).toStrictEqual([replacement]);
      await recording.commit('compressed', {
        summary: response('summary'),
        itemsCompressed: 1,
      });
      expect(await rows(boot.filePath)).toStrictEqual([response('summary')]);
      const independent = new HistoryJournalStore(recording);
      expect(independent.materialize()).toStrictEqual([response('summary')]);
      independent.dispose();
    },
  );
}

async function reopenInChild(): Promise<void> {
  expect(JSON.parse(await reopenFromCwd())).toStrictEqual(expectedReopened);
}

async function reopenOutsideRepository(): Promise<void> {
  expect(JSON.parse(await reopenFromCwd(root))).toStrictEqual(expectedReopened);
}

async function reopenFromCwd(cwd?: string): Promise<string> {
  await history.adoptResumeBoot(recording, boot);
  history.add(response('live child-visible response'));
  await history.waitForCommit();
  const file = pathOf(history);
  const resultFile = join(project, 'reopen-result.json');
  await boot.close();
  history.dispose();
  await history.waitForOwnershipSettlement();
  await recording.dispose();
  await store.close();
  const child = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL(
          '../../../../../scripts/tests/durability-reopen-child.ts',
          import.meta.url,
        ),
      ),
      file,
      join(project, 'media'),
      root,
      resultFile,
    ],
    { encoding: 'utf8', cwd },
  );
  expect(child.stderr).toBe('');
  expect(child.status).toBe(0);
  return readFile(resultFile, 'utf8');
}

async function releaseTemporaryOwner(): Promise<void> {
  await history.adoptResumeBoot(recording, boot);
  await collectRowsForAssertions(
    history.streamRawHistory(),
    async (snapshotRows) => {
      const reference = snapshotRows[0].blocks[0];
      if (reference.type !== 'media' || reference.encoding !== 'reference')
        throw new Error('Expected reference');
      await boot.close();
      await history.detachJournal(recording);
      await recording.dispose();
      await rm(boot.filePath);
      expect(
        (await store.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(0);
      expect((await rows(pathOf(history)))[0].blocks[0]).toStrictEqual(
        reference,
      );
      history.dispose();
      await history.waitForOwnershipSettlement();
      expect(await store.hasReservations(reference.contentId)).toBe(false);
      expect(
        (await store.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(1);
    },
  );
}

async function recoverPartialBindings(): Promise<void> {
  const commit = recording.commit.bind(recording);
  let bindings = 0;
  const fault = spyOn(recording, 'commit').mockImplementation(
    async (type, payload) => {
      if (type === 'chronology_bind' && ++bindings === 2)
        throw new Error('second binding failed');
      return commit(type, payload);
    },
  );
  try {
    await expect(history.adoptResumeBoot(recording, boot)).rejects.toThrow(
      'second binding failed',
    );
  } finally {
    fault.mockRestore();
  }
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    expect(rows).toStrictEqual([]);
  });
  const partial = await rows(boot.filePath);
  const reference = partial[0].blocks[0];
  if (reference.type !== 'media' || reference.encoding !== 'reference')
    throw new Error('Expected durable reference');
  expect(await store.hasReservations(reference.contentId)).toBe(false);
  expect(await reclaimSessionMedia(root, undefined)).toBe(0);
  expect((await store.readVerified(reference)).length).toBeGreaterThan(0);
  boot = await ResumeCursorBoot.open(
    boot.filePath,
    recording.getLastEnqueuedSequence(),
    (await stat(boot.filePath)).size,
    undefined,
    store,
  );
  await history.adoptResumeBoot(recording, boot);
  expect(
    (await rows(boot.filePath))[1].metadata?.responsesStored,
  ).toBeUndefined();
  expect(
    (await rows(boot.filePath)).map((row) => row.metadata?.chronology?.seq),
  ).toStrictEqual([2, 1]);
}

async function persistProjection(): Promise<void> {
  await history.adoptResumeBoot(recording, boot);
  const serialized = await readFile(pathOf(history), 'utf8');
  expect(serialized.match(/"text":"old"/g)).toHaveLength(1);
  const reopened = await rows(pathOf(history));
  expect(reopened[0].blocks[0]).toMatchObject({
    type: 'media',
    encoding: 'reference',
  });
  expect(reopened[1].metadata?.responsesStored).toBeUndefined();
  expect(reopened.map((row) => row.metadata?.chronology?.seq)).toStrictEqual([
    2, 1,
  ]);
  const independent = new HistoryJournalStore(recording);
  expect(independent.materialize()).toStrictEqual(reopened);
  independent.dispose();
}

async function detachAndCopy(): Promise<void> {
  await history.adoptResumeBoot(recording, boot);
  history.add(response('live'));
  await history.waitForCommit();
  await boot.close();
  await history.detachJournal(recording);
  const detached = pathOf(history);
  expect((await rows(detached))[1].metadata?.responsesStored).toBeUndefined();
  expect((await rows(detached))[2].metadata?.responsesStored).toBe(true);
  expect((await rows(detached))[0].blocks[0]).toMatchObject({
    encoding: 'reference',
  });
  const checkpoint = join(project, 'checkpoint.jsonl');
  await copyCheckpointRange(
    detached,
    checkpoint,
    (await stat(detached)).size,
    recording.getLastEnqueuedSequence(),
  );
  await history.attachJournal(recording, true);
  const file = pathOf(history);
  history.dispose();
  await history.waitForOwnershipSettlement();
  expect(await rows(checkpoint)).toStrictEqual(await rows(file));
  expect((await rows(file))[2].metadata?.responsesStored).toBe(true);
}

async function protectPermanentMedia(): Promise<void> {
  await history.adoptResumeBoot(recording, boot);
  await collectRowsForAssertions(
    history.streamRawHistory(),
    async (snapshotRows) => {
      const reference = snapshotRows[0].blocks[0];
      if (reference.type !== 'media' || reference.encoding !== 'reference')
        throw new Error('Expected reference');
      await boot.close();
      history.dispose();
      await history.waitForOwnershipSettlement();
      await recording.dispose();
      await store.close();
      expect(await reclaimSessionMedia(root, undefined)).toBe(0);
      const reopenedStore = new LocalMediaStore({
        rootDirectory: join(project, 'media'),
        quotaBytes: 1024 * 1024,
      });
      try {
        expect(await reopenedStore.hasReservations(reference.contentId)).toBe(
          false,
        );
        expect((await rows(boot.filePath))[0].blocks[0]).toStrictEqual(
          reference,
        );
        expect(
          (await reopenedStore.readVerified(reference)).length,
        ).toBeGreaterThan(0);
      } finally {
        await reopenedStore.close();
      }
    },
  );
}
