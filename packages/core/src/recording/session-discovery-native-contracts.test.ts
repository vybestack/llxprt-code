/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdir, symlink, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SessionDiscovery } from './SessionDiscovery.js';
import { SessionLockManager } from './SessionLockManager.js';
import {
  discoveryDirectory,
  replaceFact,
} from './__tests__/support/native-discovery-fixture.js';
import { scanGlobalSessions } from './janitor/sessionScanner.js';
import { JournalCheckpointService } from './journalCheckpointService.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { readJournalFileFacts } from './journalSessionListing.js';
import {
  getAllJsonlSessionFiles,
  shouldDeleteSession,
} from './sessionCleanupUtils.js';

import {
  PROJECT,
  chatsDirIn,
  journalSeams,
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';
import { SESSION_KEYS } from './sessionMetaKeys.js';

describe('native discovery behavioral contracts', () => {
  it('filters project and child sessions before sorting and resolves real native targets by identity, name, prefix, index and checkpoint', async () => {
    const chats = chatsDirIn(await discoveryDirectory('resolution'));
    const tied = new Date('2026-01-01T00:00:00Z');
    await recordJournal(chats, 'prefix-a', {
      name: 'named',
      modifiedAt: tied,
      rows: [userRow('parent')],
      checkpoints: ['saved'],
    });
    await recordJournal(chats, 'prefix-z', { modifiedAt: tied });
    await recordJournal(chats, '123', {
      modifiedAt: new Date('2025-01-01T00:00:00Z'),
    });
    await recordJournal(chats, 'other-project', {
      projectHash: 'foreign',
      modifiedAt: new Date('2027-01-01T00:00:00Z'),
    });
    await recordJournal(chats, 'child', {
      kind: 'subagent',
      rows: [userRow('child')],
      checkpoints: ['child-checkpoint'],
      modifiedAt: new Date('2027-02-01T00:00:00Z'),
    });
    await writeFile(join(chats, 'session-ignored.llxj.gz'), 'archive');
    await writeFile(join(chats, 'session-ignored.llxj.lock'), 'lock');
    await writeFile(join(chats, 'other.llxj'), 'unmanaged');
    const found = await SessionDiscovery.listContinueTargetsDetailed(
      chats,
      PROJECT,
    );
    const sessions = found.targets.flatMap((target) =>
      target.kind === 'session' ? [target.session] : [],
    );
    expect(sessions.map((session) => session.sessionId)).toStrictEqual([
      'prefix-z',
      'prefix-a',
      '123',
    ]);
    expect(
      found.targets
        .filter((target) => target.kind === 'checkpoint')
        .map((target) => target.checkpointName),
    ).toStrictEqual(['saved']);
    expect(found.unreadableRecordings).toStrictEqual([]);
    expect(found.targets.map((target) => target.kind)).toStrictEqual([
      'session',
      'session',
      'session',
      'checkpoint',
    ]);
    for (const [ref, id] of [
      ['latest', 'prefix-z'],
      ['1', 'prefix-z'],
      ['2', 'prefix-a'],
      ['123', '123'],
      ['named', 'prefix-a'],
      ['prefix-a', 'prefix-a'],
    ]) {
      const session = sessions.find((candidate) => candidate.sessionId === id);
      if (session === undefined) throw new Error(`Missing session ${id}`);
      expect(
        SessionDiscovery.resolveContinueRef(ref, found.targets),
      ).toStrictEqual({
        target: {
          kind: 'session',
          session,
        },
      });
    }
    const checkpoint = found.targets.find(
      (target) => target.kind === 'checkpoint',
    );
    if (checkpoint === undefined) throw new Error('Missing checkpoint');
    for (const ref of ['saved', checkpoint.checkpointId])
      expect(
        SessionDiscovery.resolveContinueRef(ref, found.targets),
      ).toStrictEqual({ target: checkpoint });
    expect(
      SessionDiscovery.resolveContinueRef('prefix-', found.targets),
    ).toMatchObject({
      error: expect.stringContaining('Ambiguous session prefix'),
    });
    expect(
      SessionDiscovery.resolveContinueRef('0', found.targets),
    ).toMatchObject({ error: expect.stringContaining('out of range') });
    expect(
      SessionDiscovery.resolveContinueRef('missing', found.targets),
    ).toHaveProperty('error');
    expect(
      SessionDiscovery.resolveContinueRef('saved', [
        ...found.targets,
        checkpoint,
      ]),
    ).toStrictEqual({ error: "Ambiguous continue target name 'saved'" });
    expect(
      SessionDiscovery.resolveContinueRef(checkpoint.checkpointId, [
        ...found.targets,
        checkpoint,
      ]),
    ).toStrictEqual({
      error: `Ambiguous checkpoint ID '${checkpoint.checkpointId}'`,
    });
  });

  it('validates available names and coordinates the native checkpoint namespace beside unreadable files', async () => {
    const chats = chatsDirIn(await discoveryDirectory('names'));
    await recordJournal(chats, 'closed-id', {
      name: 'closed-name',
      rows: [userRow('closed')],
      checkpoints: ['closed-point'],
    });
    await writeFile(join(chats, 'session-broken.llxj'), 'invalid');
    const live = await JournalRecordingService.createLocked({
      sessionId: 'live',
      projectHash: PROJECT,
      chatsDir: chats,
      workspaceDirs: ['/live'],
      provider: 'p',
      model: 'm',
      journal: journalSeams(),
    });
    try {
      await (await live.session()).append([userRow('live')]);
      const service = new JournalCheckpointService(journalSeams());
      await service.setSessionName(live, PROJECT, 'live-name');
      await service.createCheckpoint(live, PROJECT, 'live-point');
      expect(
        await SessionDiscovery.validateAvailableName(
          '  unused  ',
          chats,
          PROJECT,
        ),
      ).toBe('unused');
      for (const name of [
        'closed-id',
        'closed-name',
        'closed-point',
        'live-name',
        'live-point',
      ]) {
        await expect(
          SessionDiscovery.validateAvailableName(name, chats, PROJECT),
        ).rejects.toThrow('already exists');
      }
      for (const name of ['', '   ', 'latest', '1'])
        expect(() => SessionDiscovery.validateName(name)).toThrow(/Name/);
      const targets = await SessionDiscovery.listContinueTargets(
        chats,
        PROJECT,
      );
      expect(
        targets.filter((target) => target.kind === 'session'),
      ).toHaveLength(2);
      expect(
        targets.filter((target) => target.kind === 'checkpoint'),
      ).toHaveLength(2);
    } finally {
      await live.dispose();
    }
  });

  it('keeps latest provider, directories, title and name facts separate from immutable session start facts', async () => {
    const chats = chatsDirIn(await discoveryDirectory('facts'));
    const recorder = JournalRecordingService.create({
      sessionId: 'facts',
      projectHash: PROJECT,
      chatsDir: chats,
      workspaceDirs: ['/start/雪'],
      cwd: '/start',
      provider: 'original',
      model: 'first',
      journal: journalSeams(),
    });
    let filePath: string;
    try {
      await (await recorder.session()).append([userRow('one')]);
      recorder.recordProviderSwitch('new-provider', 'new-model');
      recorder.recordDirectoriesChanged(['/new/雪', '/new/second']);
      recorder.recordSessionMetadata('old-title');
      recorder.recordSessionMetadata(null);
      await recorder.setSessionName('old-name');
      await recorder.setSessionName(null);
      await recorder.flush();
      const file = recorder.getFilePath();
      if (file === null) throw new Error('Missing file');
      filePath = file;
    } finally {
      await recorder.dispose();
    }
    const facts = await readJournalFileFacts(filePath);
    expect(facts?.facts).toMatchObject({
      sessionId: 'facts',
      provider: 'new-provider',
      model: 'new-model',
      directories: ['/new/雪', '/new/second'],
      title: null,
      name: null,
      start: { workspaceDirs: ['/start/雪'], cwd: '/start' },
    });
    expect(
      await SessionDiscovery.readSessionMetadataTitle(filePath),
    ).toBeNull();
    expect(await SessionDiscovery.readSessionHeader(filePath)).toMatchObject({
      sessionId: 'facts',
      workspaceDirs: ['/start/雪'],
      provider: 'new-provider',
      model: 'new-model',
      cwd: '/start',
    });
    const [summary] = await SessionDiscovery.listSessions(chats, PROJECT);
    expect(summary).toMatchObject({
      provider: 'new-provider',
      model: 'new-model',
      title: null,
      name: null,
      messageCount: 1,
      cwd: '/start',
    });
    await replaceFact(filePath, SESSION_KEYS.title, 'final-title');
    expect(await SessionDiscovery.readSessionMetadataTitle(filePath)).toBe(
      'final-title',
    );
  });

  it('counts locked native sessions once and applies native filename rules across discovery, cleanup and global raw/archive scanning', async () => {
    const directory = await discoveryDirectory('matchers');
    const chats = join(directory, 'a'.repeat(64), 'chats');
    const source = await recordJournal(chats, 'source', {
      rows: [userRow('source')],
      checkpoints: ['saved'],
    });
    await recordJournal(chats, 'child', {
      kind: 'subagent',
      rows: [userRow('child')],
    });
    await mkdir(join(chats, 'archive'));
    await writeFile(join(chats, 'archive', 'session-x.llxj.gz'), 'archive');
    await writeFile(
      join(chats, 'archive', 'session-retired.jsonl.gz'),
      'retired archive',
    );
    await writeFile(join(chats, 'session-retired.jsonl'), 'retired');
    await writeFile(join(chats, 'session-ignore.llxj.tmp'), 'temporary');
    await writeFile(join(chats, 'not-session.llxj'), 'unmanaged');
    const lock = await SessionLockManager.acquire(chats, 'source');
    try {
      const targets = await SessionDiscovery.listContinueTargets(
        chats,
        PROJECT,
      );
      expect(targets.map((target) => target.kind)).toStrictEqual([
        'session',
        'checkpoint',
      ]);
      const cleanup = await getAllJsonlSessionFiles(chats, 'source');
      expect(cleanup).toHaveLength(2);
      const entry = cleanup.find(
        (candidate) => candidate.filePath === source.filePath,
      );
      if (entry === undefined) throw new Error('Missing native cleanup entry');
      expect(entry.sessionInfo).toMatchObject({
        id: 'source',
        isCurrentSession: true,
      });
      expect(await shouldDeleteSession(entry)).toBe('skip');
      const global = await scanGlobalSessions(directory, 'source');
      expect(global.candidates).toHaveLength(5);
      expect(
        global.candidates
          .filter((candidate) => candidate.isCurrentSession)
          .map((candidate) => candidate.filePath),
      ).toStrictEqual([source.filePath]);
      expect(
        global.candidates
          .filter((candidate) => candidate.kind === 'archive')
          .map((candidate) => candidate.fileName)
          .sort(),
      ).toStrictEqual(['session-retired.jsonl.gz', 'session-x.llxj.gz']);
      expect(
        global.candidates.filter((candidate) =>
          candidate.fileName.endsWith('.lock'),
        ),
      ).toStrictEqual([]);
    } finally {
      await lock.release();
    }
  });

  it('enforces native scanner file and aggregate byte limits, rejects symlinks and counts valid project directories', async () => {
    const directory = await discoveryDirectory('scan-limits');
    const chats = join(directory, 'a'.repeat(64), 'chats');
    const first = await recordJournal(chats, 'one', { rows: [userRow('one')] });
    await recordJournal(chats, 'two', { rows: [userRow('two')] });
    await symlink(first.filePath, join(chats, 'session-link.llxj'));
    await mkdir(join(directory, 'not-a-project', 'chats'), { recursive: true });
    const bounded = await scanGlobalSessions(directory, undefined, {
      maxProjects: 1,
      maxFiles: 1,
      maxCandidateBytes: 1024 * 1024,
    });
    expect(bounded.candidates).toHaveLength(1);
    expect(bounded.scanSkippedCount).toBeGreaterThan(0);
    const bytes = await scanGlobalSessions(directory, undefined, {
      maxProjects: 1,
      maxFiles: 10,
      maxCandidateBytes: 1,
    });
    expect(bytes.candidates).toStrictEqual([]);
    expect(bytes.scanSkippedCount).toBeGreaterThan(0);
    const complete = await scanGlobalSessions(directory);
    expect(complete.candidates).toHaveLength(2);
    expect(complete.chatsDirs).toStrictEqual([chats]);
    for (const maxFiles of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      await expect(
        scanGlobalSessions(directory, undefined, {
          maxProjects: 1,
          maxFiles,
          maxCandidateBytes: 1024,
        }),
      ).rejects.toThrow('Invalid session scan limit maxFiles');
    }
    const timestamp = new Date('2026-01-01T00:00:00Z');
    await utimes(first.filePath, timestamp, timestamp);
    const sorted = await SessionDiscovery.listSessions(chats, PROJECT);
    expect(sorted[sorted.length - 1].sessionId).toBe('one');
  });
});
