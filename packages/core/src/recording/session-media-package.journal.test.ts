/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readdir,
  rm,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JournalRecordingService } from './journalRecordingService.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import { JOURNAL_HEADER_BYTES } from '../journal/fileHeader.js';
import { RECORD_KIND } from '../journal/recordKinds.js';
import { openJournalReadOnly } from '../journal/journalReader.js';
import { stateReaderOf } from '../journal/journalReaderState.js';
import { sha256KeyHash } from '../journal/idKeys.js';
import { SESSION_KEYS, encodeSessionFact } from './sessionMetaKeys.js';
import {
  readJournalCheckpoints,
  readJournalFileFacts,
} from './journalSessionListing.js';
import { retiredJournalMessage } from '../journal/journalRefusal.js';
import { useBackendEnv } from './__tests__/support/backendEnv.js';
import {
  importSessionMediaPackage,
  validateSessionMediaPackage,
} from './session-media-package.js';
import { resumeSession } from './resumeSession.js';

const PROJECT = 'native-package-project';

describe('native session package validation and import', () => {
  const backend = useBackendEnv();
  let root = '';
  beforeEach(async () => {
    backend('journal');
    root = await mkdtemp(join(tmpdir(), 'llxprt-native-package-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function fixture(): Promise<string> {
    const store = new LocalMediaStore({
      rootDirectory: join(root, 'source-media'),
      quotaBytes: 1024,
    });
    const reference = await store.admit({
      bytes: new Uint8Array([1, 4, 9]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const recorder = JournalRecordingService.create({
      sessionId: 'source',
      projectHash: PROJECT,
      chatsDir: join(root, 'source-chats'),
      workspaceDirs: ['/source'],
      provider: 'test',
      model: 'test',
    });
    const session = await recorder.session();
    await session.append([{ speaker: 'human', blocks: [reference] }]);
    await session.store.commit([
      {
        kind: 'setState',
        key: SESSION_KEYS.title,
        value: encodeSessionFact('Portable title'),
      },
      {
        kind: 'setState',
        key: SESSION_KEYS.name,
        value: encodeSessionFact('Portable name'),
      },
      {
        kind: 'setState',
        key: SESSION_KEYS.fork,
        value: encodeSessionFact({
          parentSessionId: 'parent',
          parentCheckpointId: 'prior',
          parentCheckpointName: 'prior',
          parentCutSeq: 1,
        }),
      },
      {
        kind: 'checkpoint',
        id: 'saved',
        name: 'Saved point',
        createdAtMs: 123,
      },
    ]);
    const directory = join(root, 'package');
    await mkdir(join(directory, 'blobs', 'sha256'), { recursive: true });
    await recorder.dispose();
    await copyFile(session.path, join(directory, 'session.llxj'));
    await writeFile(
      join(directory, 'blobs', 'sha256', reference.contentId.slice(7)),
      new Uint8Array([1, 4, 9]),
    );
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        version: 2,
        recording: 'session.llxj',
        references: [reference],
        objects: [reference.originalObject],
        persistedStates: [],
      }),
    );
    return directory;
  }

  function destination(): LocalMediaStore {
    return new LocalMediaStore({
      rootDirectory: join(root, 'destination-media'),
      quotaBytes: 1024,
    });
  }

  it('validates a real journal and imports it into another project with checkpoint and session metadata intact', async () => {
    const directory = await fixture();
    const validated = await validateSessionMediaPackage(directory);
    const media = destination();
    const chats = join(root, 'destination-chats');
    const imported = await importSessionMediaPackage(
      validated,
      chats,
      'moved-project',
      media,
    );
    expect(imported.recordingPath.endsWith('.llxj')).toBe(true);
    const facts = await readJournalFileFacts(imported.recordingPath);
    expect(facts?.facts.sessionId).toBe(imported.sessionId);
    expect(facts?.facts.start.projectHash).toBe('moved-project');
    expect(facts?.facts.directories).toStrictEqual([]);
    expect(facts?.facts.title).toBe('Portable title');
    expect(facts?.facts.name).toBe('Portable name');
    expect(
      (await readJournalCheckpoints(imported.recordingPath)).map((c) => [
        c.checkpointId,
        c.name,
      ]),
    ).toStrictEqual([['saved', 'Saved point']]);
    const reader = await openJournalReadOnly(imported.recordingPath);
    try {
      expect(
        await stateReaderOf(reader, sha256KeyHash)(SESSION_KEYS.fork),
      ).toStrictEqual(
        encodeSessionFact({
          parentSessionId: 'parent',
          parentCheckpointId: 'prior',
          parentCheckpointName: 'prior',
          parentCutSeq: 1,
        }),
      );
    } finally {
      await reader.close();
    }
    const result = await resumeSession({
      chatsDir: chats,
      projectHash: 'moved-project',
      continueRef: imported.sessionId,
      currentProvider: 'test',
      currentModel: 'test',
      workspaceDirs: [],
    });
    if (!result.ok) throw new Error(result.error);
    try {
      const rows = [];
      for await (const row of result.boot.streamRows()) rows.push(row);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.blocks[0]).toMatchObject({
        type: 'media',
        encoding: 'reference',
      });
      expect(
        await media.readObjectVerified(validated.objects[0]),
      ).toStrictEqual(new Uint8Array([1, 4, 9]));
    } finally {
      await result.boot.close();
      await result.recording.dispose();
      await result.lockHandle.release();
    }
  });

  it('rejects retired JSONL with the exact design message before publication', async () => {
    const directory = await fixture();
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        version: 2,
        recording: 'session.jsonl',
        references: [],
        objects: [],
        persistedStates: [],
      }),
    );
    await expect(
      importSessionMediaPackage(
        directory,
        join(root, 'destination-chats'),
        PROJECT,
        destination(),
      ),
    ).rejects.toThrow(retiredJournalMessage(join(directory, 'session.jsonl')));
    await expect(
      readdir(join(root, 'destination-chats')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a truncated committed journal rather than silently importing an earlier version', async () => {
    const directory = await fixture();
    const path = join(directory, 'session.llxj');
    const handle = await open(path, 'r');
    const size = (await handle.stat()).size;
    await handle.close();
    await truncate(path, size - 1);
    await expect(validateSessionMediaPackage(directory)).rejects.toThrow(
      /journal|Journal/,
    );
  });

  it('rejects body corruption even when the last trailer is intact', async () => {
    const directory = await fixture();
    const path = join(directory, 'session.llxj');
    const reader = await openJournalReadOnly(path);
    let bodyOffset: number | undefined;
    try {
      let offset = JOURNAL_HEADER_BYTES;
      while (offset < reader.fileSize) {
        const head = await reader.readRecordHead(offset);
        if (head.kind === RECORD_KIND.ROW) {
          bodyOffset = head.bodyOffset;
          break;
        }
        offset = head.endOffset;
      }
    } finally {
      await reader.close();
    }
    if (bodyOffset === undefined) throw new Error('Fixture has no ROW record');
    const handle = await open(path, 'r+');
    try {
      await handle.write(new Uint8Array([255]), 0, 1, bodyOffset);
    } finally {
      await handle.close();
    }
    await expect(validateSessionMediaPackage(directory)).rejects.toThrow(
      /journal|Journal/,
    );
  });

  it('detects recording replacement after validation and cleans staged media and recording', async () => {
    const directory = await fixture();
    const validated = await validateSessionMediaPackage(directory);
    const handle = await open(join(directory, 'session.llxj'), 'r+');
    try {
      await handle.write(new Uint8Array([255]), 0, 1, 100);
    } finally {
      await handle.close();
    }
    const media = destination();
    await expect(
      importSessionMediaPackage(
        validated,
        join(root, 'destination-chats'),
        PROJECT,
        media,
      ),
    ).rejects.toThrow('changed after validation');
    expect(await media.getStoredByteLength()).toBe(0);
    await expect(
      readdir(join(root, 'destination-chats')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rolls back native publication and new blobs when activation fails', async () => {
    const directory = await fixture();
    const media = destination();
    await expect(
      importSessionMediaPackage(
        directory,
        join(root, 'destination-chats'),
        PROJECT,
        media,
        async () => {
          throw new Error('activation failed');
        },
      ),
    ).rejects.toThrow('activation failed');
    expect(await media.getStoredByteLength()).toBe(0);
    await expect(
      readdir(join(root, 'destination-chats')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a native package on the old backend rather than converting it', async () => {
    const directory = await fixture();
    backend('old');
    await expect(
      importSessionMediaPackage(
        directory,
        join(root, 'destination-chats'),
        PROJECT,
        destination(),
      ),
    ).rejects.toThrow(/backend/);
  });
  it('rejects undeclared media in any stored journal row', async () => {
    const directory = await fixture();
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        version: 2,
        recording: 'session.llxj',
        references: [],
        objects: [],
        persistedStates: [],
      }),
    );
    await expect(validateSessionMediaPackage(directory)).rejects.toThrow(
      'undeclared media',
    );
  });

  it('rejects a damaged blob before publishing a native recording', async () => {
    const directory = await fixture();
    const validated = await validateSessionMediaPackage(directory);
    await writeFile(validated.blobs[0].sourcePath, new Uint8Array([2, 4, 9]));
    const media = destination();
    await expect(
      importSessionMediaPackage(
        directory,
        join(root, 'destination-chats'),
        PROJECT,
        media,
      ),
    ).rejects.toThrow('corrupt');
    expect(await media.getStoredByteLength()).toBe(0);
    await expect(
      readdir(join(root, 'destination-chats')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses manifest traversal rather than opening an outside recording', async () => {
    const directory = await fixture();
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify({
        version: 2,
        recording: '../session.llxj',
        references: [],
        objects: [],
        persistedStates: [],
      }),
    );
    await expect(validateSessionMediaPackage(directory)).rejects.toThrow(
      'Invalid session media package manifest',
    );
  });
});
