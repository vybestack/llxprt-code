/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as files from 'node:fs/promises';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '../storage/local-media-store.js';
import { JournalRecordingService } from './journalRecordingService.js';

import {
  readJournalCheckpoints,
  readJournalFileFacts,
} from './journalSessionListing.js';
import { resumeSession } from './resumeSession.js';
import {
  exportSessionMediaPackage,
  importSessionMediaPackage,
  validateSessionMediaPackage,
} from './session-media-package.js';
import { SessionLockManager } from './SessionLockManager.js';
import { SESSION_KEYS, encodeSessionFact } from './sessionMetaKeys.js';
import { JournalArrivalRecorder } from '../journal/arrival-recorder.js';
import { ROW_BLOCK_TYPE } from '../journal/rowRecord.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';

describe('native recording export', () => {
  let root = '';
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'native-export-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function fixture() {
    const media = new LocalMediaStore({
      rootDirectory: join(root, 'media'),
      quotaBytes: 4096,
    });
    const reference = await media.admit({
      bytes: new Uint8Array([3, 5, 8]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const recording = await JournalRecordingService.createLocked({
      sessionId: 'source',
      projectHash: 'project',
      chatsDir: join(root, 'chats'),
      workspaceDirs: ['/private'],
      provider: 'test',
      model: 'test',
    });
    const session = await recording.session();
    await session.append([{ speaker: 'human', blocks: [reference] }]);
    await session.store.commit([
      {
        kind: 'setState',
        key: SESSION_KEYS.title,
        value: encodeSessionFact('Export title'),
      },
      {
        kind: 'setState',
        key: SESSION_KEYS.name,
        value: encodeSessionFact('Export name'),
      },
      {
        kind: 'setState',
        key: SESSION_KEYS.fork,
        value: encodeSessionFact({
          parentSessionId: 'parent',
          parentCheckpointId: 'prior',
          parentCheckpointName: 'Prior',
          parentCutSeq: 1,
        }),
      },
      { kind: 'checkpoint', id: 'saved', name: 'Saved', createdAtMs: 123 },
    ]);
    return {
      media,
      recording,
      session,
      reference,
      path: session.path,
      destination: join(root, 'package'),
    };
  }

  it.each(['completed', 'cancelled'])(
    'exports ended media from %s arrival rows without parsing unfinished progress blocks',
    async (outcome) => {
      const f = await fixture();
      const reference = await f.media.admit({
        bytes: new Uint8Array([13, 21, 34]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      const arrival = new JournalArrivalRecorder(f.session.store);
      try {
        const row = await arrival.beginRow(
          encodeContentRow({ speaker: 'ai', blocks: [] }, { owner: 0 }),
          { id: 'media-arrival', submissionId: 'prompt' },
        );
        const media = await arrival.beginBlock(row, ROW_BLOCK_TYPE.media);
        const bytes = new TextEncoder().encode(JSON.stringify(reference));
        await arrival.appendField(media, bytes.subarray(0, 8));
        await arrival.flush();
        await arrival.appendField(media, bytes.subarray(8));
        await arrival.endBlock(media);
        const text = await arrival.beginBlock(row, ROW_BLOCK_TYPE.text);
        await arrival.flush();
        if (outcome === 'completed') {
          await arrival.appendField(
            text,
            new TextEncoder().encode(
              JSON.stringify({ type: 'text', text: 'completed response' }),
            ),
          );
          await arrival.endBlock(text);
          await arrival.sealRow(row);
        } else {
          await arrival.appendField(text, new TextEncoder().encode('{"type":'));
          await arrival.finishAttempt(row, 'cancelled');
        }
      } finally {
        await arrival.close();
        await f.recording.dispose();
      }
      await exportSessionMediaPackage(
        f.path,
        'project',
        f.media,
        f.destination,
      );
      const validated = await validateSessionMediaPackage(f.destination);
      expect(validated.references).toStrictEqual([f.reference, reference]);
    },
  );

  it('exports a closed recording with checkpoint media then validates imports and resumes it', async () => {
    const f = await fixture();
    await f.session.append([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'later' }] },
    ]);
    await f.recording.dispose();
    await exportSessionMediaPackage(f.path, 'project', f.media, f.destination);
    const validated = await validateSessionMediaPackage(f.destination);
    expect(validated.manifest.recording).toBe('session.llxj');
    expect(validated.references).toStrictEqual([f.reference]);
    const target = new LocalMediaStore({
      rootDirectory: join(root, 'target-media'),
      quotaBytes: 4096,
    });
    const chats = join(root, 'target-chats');
    const imported = await importSessionMediaPackage(
      validated,
      chats,
      'moved',
      target,
    );
    expect(
      (await readJournalFileFacts(imported.recordingPath))?.facts,
    ).toMatchObject({
      title: 'Export title',
      name: 'Export name',
      start: { projectHash: 'moved' },
    });
    expect(
      (await readJournalCheckpoints(imported.recordingPath)).map(
        (point) => point.name,
      ),
    ).toStrictEqual(['Saved']);
    const resumed = await resumeSession({
      chatsDir: chats,
      projectHash: 'moved',
      mediaStore: target,
      continueRef: imported.sessionId,
      currentProvider: 'test',
      currentModel: 'test',
      workspaceDirs: [],
    });
    if (!resumed.ok) throw new Error(resumed.error);
    try {
      const rows = [];
      for await (const row of resumed.boot.streamRows()) rows.push(row);
      expect(rows.map((row) => row.speaker)).toStrictEqual(['human', 'ai']);
      expect(rows[0]?.blocks).toStrictEqual([f.reference]);
      expect(
        await target.readObjectVerified(f.reference.originalObject),
      ).toStrictEqual(new Uint8Array([3, 5, 8]));
    } finally {
      await resumed.boot.close();
      await resumed.recording.dispose();
      await resumed.lockHandle.release();
    }
  });

  it('includes media retained only by a checkpoint after its live row is popped', async () => {
    const f = await fixture();
    const read = await f.session.store.snapshot();
    try {
      await f.session.store.commit([
        {
          kind: 'pop',
          cutLabel: (await read.entryAt(0)).label,
          expectedRemoved: 1,
        },
      ]);
    } finally {
      await read.close();
    }
    await f.session.append([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'replacement' }] },
    ]);
    await f.recording.dispose();
    await exportSessionMediaPackage(f.path, 'project', f.media, f.destination);
    const validated = await validateSessionMediaPackage(f.destination);
    expect(validated.references).toStrictEqual([f.reference]);
    expect(
      (await readJournalCheckpoints(join(f.destination, 'session.llxj'))).map(
        (point) => point.name,
      ),
    ).toStrictEqual(['Saved']);
  });

  it('reports media and lock-release errors together and removes partial output', async () => {
    const f = await fixture();
    await f.recording.dispose();
    const acquire = SessionLockManager.acquire.bind(SessionLockManager);
    const locked = spyOn(SessionLockManager, 'acquire').mockImplementation(
      async (chats, id) => {
        const lock = await acquire(chats, id);
        return {
          ...lock,
          release: async () => {
            await lock.release();
            throw new Error('release failed');
          },
        };
      },
    );
    const media = spyOn(f.media, 'readObjectVerified').mockRejectedValue(
      new Error('media failed'),
    );
    try {
      const error = await exportSessionMediaPackage(
        f.path,
        'project',
        f.media,
        f.destination,
      ).then(
        () => undefined,
        (failure: unknown) => failure,
      );
      expect(error).toBeInstanceOf(AggregateError);
      if (!(error instanceof AggregateError)) throw error;
      expect(
        error.errors.map((failure: Error) => failure.message),
      ).toStrictEqual(['media failed', 'release failed']);
      expect((await readdir(root)).sort()).toStrictEqual(['chats', 'media']);
      expect(
        await SessionLockManager.isLocked(join(root, 'chats'), 'source'),
      ).toBe(false);
    } finally {
      locked.mockRestore();
      media.mockRestore();
    }
  });

  it('refuses another live owner and leaves its lock and output untouched', async () => {
    const f = await fixture();
    try {
      await expect(
        exportSessionMediaPackage(f.path, 'project', f.media, f.destination),
      ).rejects.toThrow('Session is in use');
      expect(
        await SessionLockManager.isLocked(join(root, 'chats'), 'source'),
      ).toBe(true);
      expect((await readdir(root)).sort()).toStrictEqual(['chats', 'media']);
    } finally {
      await f.recording.dispose();
    }
  });

  it('rejects wrong project and removes failed output without keeping the source locked', async () => {
    const f = await fixture();
    await f.recording.dispose();
    await expect(
      exportSessionMediaPackage(f.path, 'wrong', f.media, f.destination),
    ).rejects.toThrow('project');
    expect(
      await SessionLockManager.isLocked(join(root, 'chats'), 'source'),
    ).toBe(false);
    expect((await readdir(root)).sort()).toStrictEqual(['chats', 'media']);
  });

  it('copies only the pinned durable boundary when a writer commits before the first source read', async () => {
    const f = await fixture();
    const open = files.open;
    const injected = spyOn(files, 'open').mockImplementation(
      async (path, flags, mode) => {
        if (path === f.path && flags === 'r') {
          await f.session.append([
            { speaker: 'ai', blocks: [{ type: 'text', text: 'after pin' }] },
          ]);
        }
        return open(path, flags, mode);
      },
    );
    try {
      await exportSessionMediaPackage(
        f.path,
        'project',
        f.media,
        f.destination,
        { recording: f.recording },
      );
      expect(
        (await readJournalFileFacts(join(f.destination, 'session.llxj')))?.rows,
      ).toBe(1);
      injected.mockRestore();
      expect((await readJournalFileFacts(f.path))?.rows).toBe(2);
    } finally {
      injected.mockRestore();
      await f.recording.dispose();
    }
  });

  it('keeps a pinned committed prefix when a writer appends during media export', async () => {
    const f = await fixture();
    const original = f.media.readObjectVerified.bind(f.media);
    const injected = spyOn(f.media, 'readObjectVerified').mockImplementation(
      async (object) => {
        await f.session.append([
          { speaker: 'ai', blocks: [{ type: 'text', text: 'concurrent' }] },
        ]);
        await expect(f.session.store.compact()).rejects.toThrow('live pin');
        return original(object);
      },
    );
    try {
      await exportSessionMediaPackage(
        f.path,
        'project',
        f.media,
        f.destination,
        { recording: f.recording },
      );
      expect(
        (await readJournalFileFacts(join(f.destination, 'session.llxj')))?.rows,
      ).toBe(1);
      expect((await readJournalFileFacts(f.path))?.rows).toBe(2);
      await expect(f.session.store.compact()).resolves.toBeDefined();
    } finally {
      injected.mockRestore();
      await f.recording.dispose();
    }
  });

  it('cleans cancelled output and releases its pin without releasing the active owner', async () => {
    const f = await fixture();
    const controller = new AbortController();
    const original = f.media.readObjectVerified.bind(f.media);
    const injected = spyOn(f.media, 'readObjectVerified').mockImplementation(
      async (object) => {
        controller.abort(new Error('export cancelled'));
        return original(object);
      },
    );
    try {
      await expect(
        exportSessionMediaPackage(f.path, 'project', f.media, f.destination, {
          recording: f.recording,
          signal: controller.signal,
        }),
      ).rejects.toThrow('export cancelled');
      expect((await readdir(root)).sort()).toStrictEqual(['chats', 'media']);
      expect(
        await SessionLockManager.isLocked(join(root, 'chats'), 'source'),
      ).toBe(true);
      await expect(f.session.store.compact()).resolves.toBeDefined();
    } finally {
      injected.mockRestore();
      await f.recording.dispose();
    }
  });

  it('preserves an existing destination on publication failure and releases the closed source lock', async () => {
    const f = await fixture();
    await f.recording.dispose();
    await mkdir(f.destination);
    await expect(
      exportSessionMediaPackage(f.path, 'project', f.media, f.destination),
    ).rejects.toThrow('destination already exists');
    expect(await readdir(f.destination)).toStrictEqual([]);
    expect((await readdir(root)).sort()).toStrictEqual([
      'chats',
      'media',
      'package',
    ]);
    expect(
      await SessionLockManager.isLocked(join(root, 'chats'), 'source'),
    ).toBe(false);
  });
});
