/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { deleteSessionWithDiagnostics } from './sessionManagement.js';
import { SessionLockManager } from './SessionLockManager.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import {
  readJournalCheckpoints,
  readJournalFileFacts,
} from './journalSessionListing.js';
import { pinHistoryBackend } from './__tests__/support/backendEnv.js';
import {
  remainderConfig,
  remainderDirectory,
  remainderRows,
} from './__tests__/support/discovery-remainder-fixture.js';
import {
  PROJECT,
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';
import { replaceFact } from './__tests__/support/native-discovery-fixture.js';

pinHistoryBackend('journal');

describe('native direct metadata lifecycle', () => {
  it('returns distinct saved sequences for concurrent checkpoints and preserves their timestamps through rename and delete', async () => {
    const chats = await remainderDirectory('checkpoint-metadata');
    const recorder = JournalRecordingService.create(
      remainderConfig(chats, 'metadata'),
    );
    try {
      const session = await recorder.session();
      await session.append([userRow('saved')]);
      const before = Date.now();
      const checkpoints = await Promise.all([
        recorder.createCheckpoint('first'),
        recorder.createCheckpoint('second'),
      ]);
      const after = Date.now();
      const initial = await readJournalCheckpoints(session.path);
      expect(new Set(checkpoints.map((c) => c.sequence)).size).toBe(2);
      for (const checkpoint of checkpoints) {
        const persisted = initial.find(
          (c) => c.checkpointId === checkpoint.checkpointId,
        );
        expect(persisted).toMatchObject({
          name: checkpoint.name,
          sequence: checkpoint.sequence,
        });
        if (persisted === undefined) throw new Error('No checkpoint');
        expect(persisted.createdAtMs).toBeGreaterThanOrEqual(before);
        expect(persisted.createdAtMs).toBeLessThanOrEqual(after);
      }
      await recorder.renameCheckpoint(checkpoints[0].checkpointId, 'renamed');
      await recorder.deleteCheckpoint(checkpoints[1].checkpointId);
      const expected = initial
        .filter((c) => c.checkpointId === checkpoints[0].checkpointId)
        .map((c) => ({ ...c, name: 'renamed' }));
      expect(await readJournalCheckpoints(session.path)).toStrictEqual(
        expected,
      );
      expect(await remainderRows(session.path)).toStrictEqual([
        userRow('saved'),
      ]);
      const listing = await SessionDiscovery.listContinueTargetsDetailedBounded(
        chats,
        PROJECT,
      );
      expect(listing.recordingErrors).toStrictEqual([]);
      expect(listing.targets.map((t) => t.kind)).toStrictEqual([
        'session',
        'checkpoint',
      ]);
      expect(
        SessionDiscovery.resolveContinueRef('renamed', listing.targets),
      ).toMatchObject({
        target: {
          kind: 'checkpoint',
          checkpointId: checkpoints[0].checkpointId,
          sequence: checkpoints[0].sequence,
        },
      });
    } finally {
      await recorder.dispose();
    }
  });

  it('materializes a name before rows, clears only that name and leaves the title and later rows intact', async () => {
    const chats = await remainderDirectory('name-materialization');
    const recorder = JournalRecordingService.create(
      remainderConfig(chats, 'named'),
    );
    try {
      await recorder.setSessionName('  before-first-turn  ');
      const file = recorder.getFilePath();
      if (file === null) throw new Error('No named file');
      expect((await readJournalFileFacts(file))?.facts.name).toBe(
        'before-first-turn',
      );
      expect(await remainderRows(file)).toStrictEqual([]);
      recorder.recordSessionMetadata('independent title');
      await recorder.setSessionName(null);
      await (await recorder.session()).append([userRow('after naming')]);
      expect((await readJournalFileFacts(file))?.facts).toMatchObject({
        name: null,
        title: 'independent title',
      });
      expect(await remainderRows(file)).toStrictEqual([
        userRow('after naming'),
      ]);
    } finally {
      await recorder.dispose();
    }
  });

  it('refuses missing and inactive checkpoint operations without poisoning a usable recorder or changing closed bytes', async () => {
    const chats = await remainderDirectory('metadata-refusals');
    const recorder = JournalRecordingService.create(
      remainderConfig(chats, 'refusals'),
    );
    try {
      await expect(
        recorder.renameCheckpoint('missing', 'renamed'),
      ).rejects.toThrow('does not exist');
      await expect(recorder.deleteCheckpoint('missing')).rejects.toThrow(
        'does not exist',
      );
      expect(recorder.getFilePath()).toBeNull();
      expect(await readdir(chats)).toStrictEqual([]);
      expect(recorder.isActive()).toBe(true);
      const session = await recorder.session();
      await session.append([userRow('still usable')]);
      const checkpoint = await recorder.createCheckpoint('live');
      await recorder.dispose();
      const bytes = await readFile(session.path);
      await expect(recorder.createCheckpoint('late')).rejects.toThrow(
        'not active',
      );
      await expect(
        recorder.renameCheckpoint(checkpoint.checkpointId, 'late'),
      ).rejects.toThrow('not active');
      await expect(
        recorder.deleteCheckpoint(checkpoint.checkpointId),
      ).rejects.toThrow('not active');
      expect(Buffer.compare(await readFile(session.path), bytes)).toBe(0);
    } finally {
      await recorder.dispose();
    }
  });
});

describe('native public deletion after discovery', () => {
  it('refuses a live lock and checkpoints before deleting only the selected file and reporting unreadable siblings', async () => {
    const chats = await remainderDirectory('discovery-deletion');
    const target = await recordJournal(chats, 'delete-target', {
      rows: [userRow('delete me')],
      checkpoints: ['blocker'],
    });
    const sibling = await recordJournal(chats, 'keep-sibling', {
      rows: [userRow('keep me')],
    });
    const damaged = `${chats}/session-damaged.llxj`;
    await writeFile(damaged, 'malformed external file');
    const siblingBytes = await readFile(sibling.filePath);
    const lock = await SessionLockManager.acquire(chats, 'delete-target');
    try {
      const outcome = await deleteSessionWithDiagnostics(
        'delete-target',
        chats,
        PROJECT,
      );
      expect(outcome.result).toStrictEqual({
        ok: false,
        error: 'Cannot delete: session is in use by another process',
      });
      expect(await remainderRows(target.filePath)).toStrictEqual([
        userRow('delete me'),
      ]);
    } finally {
      await lock.release();
    }
    const blocked = await deleteSessionWithDiagnostics(
      'delete-target',
      chats,
      PROJECT,
    );
    expect(blocked.result).toStrictEqual({
      ok: false,
      error: `Cannot delete session: live checkpoints block deletion: blocker (${target.checkpoints[0].checkpointId})`,
    });
    expect(await SessionLockManager.isLocked(chats, 'delete-target')).toBe(
      false,
    );
    const recorder = await JournalRecordingService.open(
      remainderConfig(chats, 'delete-target'),
      target.filePath,
    );
    try {
      await recorder.deleteCheckpoint(target.checkpoints[0].checkpointId);
    } finally {
      await recorder.dispose();
    }
    const deleted = await deleteSessionWithDiagnostics(
      'delete-target',
      chats,
      PROJECT,
    );
    expect(deleted.result).toStrictEqual({
      ok: true,
      deletedSessionId: 'delete-target',
    });
    expect(deleted.unreadableRecordings).toContainEqual(
      expect.objectContaining({ filePath: damaged }),
    );
    await expect(readFile(target.filePath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await SessionLockManager.isLocked(chats, 'delete-target')).toBe(
      false,
    );
    expect(Buffer.compare(await readFile(sibling.filePath), siblingBytes)).toBe(
      0,
    );
    expect(await readFile(damaged, 'utf8')).toBe('malformed external file');
  });
});

const malformedDescriptors: readonly unknown[] = [
  null,
  [],
  { name: 42 },
  { name: 'bad' },
  {
    name: 'bad',
    trailerOffset: -1,
    commitSeq: 1,
    createdAtMs: 0,
    liveBytes: 0,
  },
  {
    name: 'bad',
    trailerOffset: 0,
    commitSeq: Number.MAX_SAFE_INTEGER + 1,
    createdAtMs: 0,
    liveBytes: 0,
  },
];

const descriptorReasons = [
  'A checkpoint descriptor is a JSON object',
  'A checkpoint descriptor is a JSON object',
  'Checkpoint descriptor field name is missing',
  'Checkpoint descriptor field trailerOffset is not a non-negative integer',
  'Checkpoint descriptor field trailerOffset is not a non-negative integer',
  'Checkpoint descriptor field commitSeq is not a non-negative integer',
];

describe('external checkpoint descriptor isolation', () => {
  for (const [index, value] of malformedDescriptors.entries()) {
    it(`reports malformed descriptor ${index} without hiding a healthy sibling or rewriting bytes`, async () => {
      const chats = await remainderDirectory('malformed-checkpoint');
      const bad = await recordJournal(chats, 'malformed', {
        rows: [userRow('bad file')],
      });
      const good = await recordJournal(chats, 'healthy', {
        rows: [userRow('healthy')],
        checkpoints: ['healthy-point'],
      });
      await replaceFact(bad.filePath, 'ckpt:invalid-external', value);
      const bytes = await readFile(bad.filePath);
      const listing = await SessionDiscovery.listContinueTargetsDetailedBounded(
        chats,
        PROJECT,
      );
      expect(listing.targets.map((t) => t.kind)).toStrictEqual([
        'session',
        'checkpoint',
      ]);
      expect(listing.targets[0]).toMatchObject({
        session: { filePath: good.filePath, sessionId: 'healthy' },
      });
      expect(listing.unreadableRecordings).toStrictEqual([
        {
          filePath: bad.filePath,
          sessionId: 'malformed',
          reason: descriptorReasons[index],
        },
      ]);
      expect(listing.recordingErrors).toStrictEqual([
        `${bad.filePath}: ${descriptorReasons[index]}`,
      ]);
      expect(listing.skippedCount).toBe(1);
      expect(Buffer.compare(await readFile(bad.filePath), bytes)).toBe(0);
    });
  }
});
