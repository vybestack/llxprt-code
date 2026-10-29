/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it, spyOn, vi } from 'bun:test';
import * as fs from 'node:fs/promises';
import { basename, join } from 'node:path';
import { forkJournalFromCheckpoint } from './journalFork.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { journalSessionFileName } from './sessionFileName.js';
import { SessionLockManager } from './SessionLockManager.js';

import {
  remainderConfig,
  remainderDirectory,
  remainderRows,
} from './__tests__/support/discovery-remainder-fixture.js';
import {
  journalSeams,
  PROJECT,
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';

const INSTANCE = '550e8400-e29b-41d4-a716-446655440000';
const START = '2026-10-19T12:34:56.000Z';

describe('native recorder pathname ownership', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps same-label files independently discoverable and resumes the selected original pathname', async () => {
    const chats = await remainderDirectory('same-label');
    spyOn(Date.prototype, 'toISOString').mockReturnValue(START);
    const first = JournalRecordingService.create(
      remainderConfig(chats, 'same-label'),
    );
    const second = JournalRecordingService.create(
      remainderConfig(chats, 'same-label'),
    );
    try {
      await (await first.session()).append([userRow('first')]);
      await (await second.session()).append([userRow('second')]);
      await first.dispose();
      await (await second.session()).append([userRow('second survives')]);
      const a = first.getFilePath();
      const b = second.getFilePath();
      if (a === null || b === null) throw new Error('No recorded file');
      expect(a).not.toBe(b);
      const discovery =
        await SessionDiscovery.listContinueTargetsDetailedBounded(
          chats,
          PROJECT,
        );
      expect(discovery.recordingErrors).toStrictEqual([]);
      expect(discovery.targets.map((t) => t.kind)).toStrictEqual([
        'session',
        'session',
      ]);
      const sessions = await SessionDiscovery.listSessions(chats, PROJECT);
      expect(sessions.map((s) => s.sessionId)).toStrictEqual([
        'same-label',
        'same-label',
      ]);
      expect(new Set(sessions.map((s) => s.filePath))).toStrictEqual(
        new Set([a, b]),
      );
      const reopened = await JournalRecordingService.open(
        remainderConfig(chats, 'same-label'),
        a,
      );
      try {
        await (await reopened.session()).append([userRow('first resumed')]);
        expect(reopened.getFilePath()).toBe(a);
      } finally {
        await reopened.dispose();
      }
      expect(await remainderRows(a)).toStrictEqual([
        userRow('first'),
        userRow('first resumed'),
      ]);
      expect(await remainderRows(b)).toStrictEqual([
        userRow('second'),
        userRow('second survives'),
      ]);
      expect((await fs.readdir(chats)).sort()).toStrictEqual(
        [basename(a), basename(b)].sort(),
      );
    } finally {
      await first.dispose();
      await second.dispose();
    }
  });

  for (const bytes of ['previous owner bytes\n', '']) {
    it(`preserves an occupied ${bytes.length === 0 ? 'empty' : 'nonempty'} pathname and permits a fresh recorder afterwards`, async () => {
      const chats = await remainderDirectory('allocation');
      spyOn(Date.prototype, 'toISOString').mockReturnValue(START);
      spyOn(crypto, 'randomUUID').mockReturnValue(INSTANCE);
      const file = join(chats, journalSessionFileName('collision'));
      await fs.writeFile(file, bytes);
      const recording = JournalRecordingService.create(
        remainderConfig(chats, 'collision'),
      );
      try {
        await expect(recording.session()).rejects.toThrow('EEXIST');
        await expect(recording.flush()).rejects.toThrow('EEXIST');
        expect(recording.getFilePath()).toBeNull();
        expect(recording.isActive()).toBe(false);
        expect(await fs.readFile(file, 'utf8')).toBe(bytes);
        expect(await fs.readdir(chats)).toStrictEqual([basename(file)]);
        await fs.rename(file, `${file}.held`);
        const next = JournalRecordingService.create(
          remainderConfig(chats, 'collision'),
        );
        try {
          await (await next.session()).append([userRow('next recorder')]);
        } finally {
          await next.dispose();
        }
        expect(await remainderRows(file)).toStrictEqual([
          userRow('next recorder'),
        ]);
        expect(await fs.readFile(`${file}.held`, 'utf8')).toBe(bytes);
      } finally {
        await recording.dispose();
      }
    });
  }

  it('preserves an occupied fork destination and releases child and source locks on refusal', async () => {
    const chats = await remainderDirectory('fork-collision');
    const source = await recordJournal(chats, 'source', {
      rows: [userRow('source row')],
      checkpoints: ['branch'],
    });
    const listing = await SessionDiscovery.listContinueTargetsDetailedBounded(
      chats,
      PROJECT,
    );
    const target = listing.targets.find((t) => t.kind === 'checkpoint');
    if (target?.kind !== 'checkpoint') throw new Error('No checkpoint');
    const before = await fs.readFile(source.filePath);
    spyOn(Date.prototype, 'toISOString').mockReturnValue(START);
    spyOn(crypto, 'randomUUID').mockReturnValue(INSTANCE);
    const occupied = join(chats, journalSessionFileName(INSTANCE));
    await fs.writeFile(occupied, 'another owner');
    const result = await forkJournalFromCheckpoint({
      target,
      chatsDir: chats,
      projectHash: PROJECT,
      currentProvider: 'anthropic',
      currentModel: 'model-1',
      workspaceDirs: ['/work/a'],
      journal: journalSeams(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      await result.recording.dispose();
      throw new Error('Expected refusal');
    }
    expect(result.error).toContain('EEXIST');
    expect(await SessionLockManager.isLocked(chats, INSTANCE)).toBe(false);
    expect(await SessionLockManager.isLocked(chats, 'source')).toBe(false);
    expect(await fs.readFile(occupied, 'utf8')).toBe('another owner');
    expect(Buffer.compare(await fs.readFile(source.filePath), before)).toBe(0);
    expect((await fs.readdir(chats)).sort()).toStrictEqual(
      [basename(source.filePath), basename(occupied)].sort(),
    );
  });
});
