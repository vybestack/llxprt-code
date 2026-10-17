/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { parseCheckpointDescriptor } from '../journal/checkpointDescriptor.js';
import { testJournalSeams } from '../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import type { CommitAck } from '../journal/groupWriter.js';
import type { IContent } from '../services/history/IContent.js';
import { JournalSession } from '../services/history/journalSession.js';
import {
  JournalRecordingService,
  type JournalRecordingConfig,
} from './journalRecordingService.js';
import { SESSION_FILE_EXTENSION } from './sessionFileExtension.js';
import {
  SESSION_KEYS,
  decodeDirectoriesFact,
  decodeProviderFact,
  decodeSessionFact,
  decodeTitleFact,
} from './sessionMetaKeys.js';

const USER: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'hello' }],
};

describe('journal recording service', () => {
  const directory = useTempDir('journal-recording-');
  const live: JournalRecordingService[] = [];
  afterEach(async () => {
    for (const recording of live.splice(0)) {
      await recording.dispose().catch(() => undefined);
    }
  });

  function config(
    overrides: Partial<JournalRecordingConfig> = {},
  ): JournalRecordingConfig {
    return {
      sessionId: 'session-aaaaaaaa-1111',
      projectHash: 'project',
      chatsDir: path.join(directory(), 'chats'),
      workspaceDirs: ['/work/a'],
      provider: 'anthropic',
      model: 'model-1',
      journal: { journal: testJournalSeams().dependencies },
      ...overrides,
    };
  }

  function created(
    overrides: Partial<JournalRecordingConfig> = {},
  ): JournalRecordingService {
    const recording = JournalRecordingService.create(config(overrides));
    live.push(recording);
    return recording;
  }

  async function stateOf(
    recording: JournalRecordingService,
    key: string,
  ): Promise<Uint8Array | undefined> {
    return (await recording.session()).store.getState(key);
  }

  it('creates no file until something needs it', async () => {
    const recording = created();
    recording.recordProviderSwitch('openai', 'gpt');
    recording.recordDirectoriesChanged(['/work/b']);
    recording.recordSessionEvent('info', 'ignored');
    await recording.flush();

    expect(recording.getFilePath()).toBeNull();
    await expect(fsp.readdir(config().chatsDir)).rejects.toThrow('ENOENT');
  });

  it('creates the file on first use with the start facts and the provider in effect then', async () => {
    const recording = created({
      resolveProviderModel: () => ({ provider: 'openai', model: 'gpt-late' }),
      kind: 'subagent',
      parentSessionId: 'parent-1',
      cwd: '/work/a/sub',
    });
    recording.recordDirectoriesChanged(['/work/b', '/work/c']);
    const session = await recording.session();

    expect(path.extname(session.path)).toBe(SESSION_FILE_EXTENSION);
    expect(recording.getFilePath()).toBe(session.path);
    const state = (key: string) => session.store.getState(key);
    expect(decodeSessionFact((await state(SESSION_KEYS.id))!)).toBe(
      'session-aaaaaaaa-1111',
    );
    expect(
      decodeProviderFact((await state(SESSION_KEYS.provider))!),
    ).toStrictEqual({
      provider: 'openai',
      model: 'gpt-late',
    });
    expect(
      decodeDirectoriesFact((await state(SESSION_KEYS.directories))!),
    ).toStrictEqual(['/work/b', '/work/c']);
    expect(decodeSessionFact((await state(SESSION_KEYS.start))!)).toMatchObject(
      {
        projectHash: 'project',
        kind: 'subagent',
        parentSessionId: 'parent-1',
        cwd: '/work/a/sub',
        workspaceDirs: ['/work/a'],
      },
    );
  });

  it('writes each fact as its own acked group, in the order asked', async () => {
    const recording = created();
    const acks: CommitAck[] = [];
    recording.onCommitAck((ack) => acks.push(ack));
    await recording.session();
    recording.recordProviderSwitch('openai', 'gpt');
    recording.recordDirectoriesChanged(['/work/z']);
    recording.recordSessionMetadata('A title');
    await recording.setSessionName('  Named  ');
    recording.recordSessionFork({
      parentSessionId: 'p',
      parentSequence: 3,
      checkpointId: 'c',
      checkpointName: 'n',
    });
    await recording.flush();

    expect(acks.map((ack) => ack.commitSeq)).toStrictEqual([1, 2, 3, 4, 5, 6]);
    expect(
      acks.every(
        (ack, i) => i === 0 || ack.durableEnd > acks[i - 1].durableEnd,
      ),
    ).toBe(true);
    expect(recording.lastAck).toStrictEqual(acks[5]);
    expect(recording.getSessionMetadataTitle()).toBe('A title');
    expect(
      decodeProviderFact((await stateOf(recording, SESSION_KEYS.provider))!),
    ).toStrictEqual({
      provider: 'openai',
      model: 'gpt',
    });
    expect(
      decodeTitleFact((await stateOf(recording, SESSION_KEYS.title))!),
    ).toBe('A title');
    expect(
      decodeSessionFact((await stateOf(recording, SESSION_KEYS.name))!),
    ).toBe('Named');
    expect(
      decodeSessionFact((await stateOf(recording, SESSION_KEYS.fork))!),
    ).toMatchObject({
      parentSessionId: 'p',
      checkpointId: 'c',
    });
  });

  it('keeps an explicitly untitled session distinct from one never titled', async () => {
    const recording = created();
    expect(recording.getSessionMetadataTitle()).toBeUndefined();
    recording.recordSessionMetadata(null);
    await recording.flush();

    expect(recording.getSessionMetadataTitle()).toBeNull();
    expect(
      decodeTitleFact((await stateOf(recording, SESSION_KEYS.title))!),
    ).toBeNull();
  });

  it('rejects an empty session name and writes nothing for it', async () => {
    const recording = created();
    await expect(recording.setSessionName('   ')).rejects.toThrow(
      'name must not be empty',
    );
    expect(recording.getFilePath()).toBeNull();
  });

  it('keeps session facts when the rows are popped', async () => {
    const recording = created();
    const session = await recording.session();
    await session.append([USER, USER]);
    recording.recordSessionMetadata('kept');
    await recording.flush();
    const first = (await session.store.rows().next()).value!;
    await session.store.commit([
      { kind: 'pop', cutLabel: first.label, expectedRemoved: 2 },
    ]);

    expect(
      decodeTitleFact((await stateOf(recording, SESSION_KEYS.title))!),
    ).toBe('kept');
  });

  it('creates a checkpoint of the version it was asked on, and renames it', async () => {
    const recording = created();
    await expect(recording.createCheckpoint('empty')).rejects.toThrow(
      'no content yet',
    );
    const session = await recording.session();
    await expect(recording.createCheckpoint('empty')).rejects.toThrow(
      'no content yet',
    );
    const appended = await session.append([USER]);
    const info = await recording.createCheckpoint('  first  ');

    expect(info.name).toBe('first');
    expect(info.sequence).toBe(appended.commitSeq);
    const descriptor = parseCheckpointDescriptor(
      (await session.store.getState(`ckpt:${info.checkpointId}`))!,
    );
    expect(descriptor.name).toBe('first');
    await recording.renameCheckpoint(info.checkpointId, 'second');
    const renamed = parseCheckpointDescriptor(
      (await session.store.getState(`ckpt:${info.checkpointId}`))!,
    );
    expect(renamed).toStrictEqual({ ...descriptor, name: 'second' });
    await expect(recording.renameCheckpoint('missing', 'x')).rejects.toThrow(
      'does not exist',
    );
    await expect(
      recording.renameCheckpoint(info.checkpointId, ' '),
    ).rejects.toThrow('empty');
  });

  it('deletes a checkpoint: the entry is gone, the version it kept is released, a second delete refuses', async () => {
    const recording = created();
    const session = await recording.session();
    await session.append([USER]);
    const kept = await recording.createCheckpoint('kept');
    const dropped = await recording.createCheckpoint('dropped');
    const before = session.store.published!;
    const droppedBytes = parseCheckpointDescriptor(
      (await session.store.getState(`ckpt:${dropped.checkpointId}`))!,
    ).liveBytes;

    await recording.deleteCheckpoint(dropped.checkpointId);

    expect(
      await session.store.checkpoint(dropped.checkpointId),
    ).toBeUndefined();
    expect((await session.store.checkpoint(kept.checkpointId))?.name).toBe(
      'kept',
    );
    expect(session.store.published!.ckptBytes).toBe(
      before.ckptBytes - droppedBytes,
    );
    await expect(
      recording.deleteCheckpoint(dropped.checkpointId),
    ).rejects.toThrow('does not exist');
    await expect(
      recording.renameCheckpoint(dropped.checkpointId, 'again'),
    ).rejects.toThrow('does not exist');
    expect(recording.isActive()).toBe(true);
  });

  it('reopens a file with its facts, and refuses another session', async () => {
    const first = created();
    first.recordProviderSwitch('openai', 'gpt');
    first.recordDirectoriesChanged(['/work/q']);
    first.recordSessionMetadata('Saved');
    await first.flush();
    const file = first.getFilePath()!;
    await first.dispose();

    const reopened = await JournalRecordingService.open(config(), file);
    live.push(reopened);
    expect(reopened.getFilePath()).toBe(file);
    expect(reopened.getSessionMetadataTitle()).toBe('Saved');
    reopened.recordSessionMetadata('Renamed');
    await reopened.flush();
    expect(
      decodeTitleFact((await stateOf(reopened, SESSION_KEYS.title))!),
    ).toBe('Renamed');
    await reopened.dispose();

    await expect(
      JournalRecordingService.open(
        config({ sessionId: 'other-session' }),
        file,
      ),
    ).rejects.toThrow('does not belong to session other-session');
  });

  it('reports a failed write once at flush, then stops being active', async () => {
    const blocker = path.join(directory(), 'blocked');
    await fsp.writeFile(blocker, 'a file where the chats directory should be');
    const recording = created({ chatsDir: path.join(blocker, 'chats') });
    recording.recordSessionMetadata('never written');

    await expect(recording.flush()).rejects.toThrow('ENOTDIR');
    await expect(recording.flush()).resolves.toBeUndefined();
    expect(recording.isActive()).toBe(false);
    await expect(recording.setSessionName('x')).rejects.toThrow('not active');
    expect(() =>
      recording.recordSessionFork({
        parentSessionId: 'p',
        parentSequence: 1,
        checkpointId: 'c',
        checkpointName: 'n',
      }),
    ).toThrow('inactive');
  });

  it('holds the session lock until disposed', async () => {
    const chatsDir = config().chatsDir;
    await fsp.mkdir(chatsDir, { recursive: true });
    const recording = await JournalRecordingService.createLocked(config());
    live.push(recording);
    const handle = recording.getOwnedLockHandle()!;

    expect(recording.ownsLockFor('session-aaaaaaaa-1111')).toBe(true);
    expect(recording.ownsLockFor('another')).toBe(false);
    expect(await handle.ownsLock()).toBe(true);
    await recording.dispose();
    expect(recording.getOwnedLockHandle()).toBeNull();
    expect(await handle.ownsLock()).toBe(false);
  });

  it('closes the file on dispose and ignores later facts', async () => {
    const recording = created();
    const session = await recording.session();
    await recording.dispose();
    recording.recordSessionMetadata('late');

    expect(recording.isActive()).toBe(false);
    const reopened = await JournalSession.open(session.path, {
      journal: testJournalSeams().dependencies,
    });
    try {
      expect(await reopened.store.getState(SESSION_KEYS.title)).toBeUndefined();
    } finally {
      await reopened.close();
    }
  });
});
