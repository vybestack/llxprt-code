/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readFile, writeFile, stat, readdir, chmod } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { describe, expect, it, spyOn } from 'bun:test';
import * as positionalFile from '../journal/positionalFile.js';
import { openJournalReadOnly } from '../journal/journalReader.js';
import { JOURNAL_HEADER_BYTES } from '../journal/fileHeader.js';
import { encodeFrameStart } from '../journal/frame.js';
import { iterateRowEntries, rowTreeRootOf } from '../journal/rowTreeReader.js';
import { JournalCorruptionError } from '../journal/errors.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { readJournalFileFacts } from './journalSessionListing.js';
import {
  resumeSession,
  CONTINUE_LATEST,
  type ResumeRequest,
} from './resumeSession.js';
import { SessionLockManager } from './SessionLockManager.js';
import {
  matchUnreadableRecordings,
  noReadableSessionsError,
} from './unreadableRecordings.js';
import { resumeSessionNotFoundMessage } from './resumeNotFoundMessages.js';
import { discoveryDirectory } from './__tests__/support/native-discovery-fixture.js';
import { useBackendEnv } from './__tests__/support/backendEnv.js';
import {
  PROJECT,
  chatsDirIn,
  journalSeams,
  recordJournal,
  userRow,
} from './__tests__/support/recordedJournals.js';

function request(chats: string, continueRef: string): ResumeRequest {
  return {
    chatsDir: chats,
    projectHash: PROJECT,
    continueRef,
    currentProvider: 'anthropic',
    currentModel: 'model-1',
    workspaceDirs: ['/fallback'],
    journal: journalSeams(),
  };
}

function retiredMessage(filePath: string): string {
  return `Session file ${filePath} was recorded in the retired JSONL journal format (versions 1 and 2) and cannot be resumed. Start a new session.`;
}

async function bootRows(boot: {
  streamRows(): AsyncIterable<unknown>;
}): Promise<unknown[]> {
  const rows: unknown[] = [];
  for await (const row of boot.streamRows()) rows.push(row);
  return rows;
}

describe('native discovery and resume fault boundaries', () => {
  const setBackend = useBackendEnv();

  it('resumes and continues the healthy native file beside unreadable native and retired JSONL siblings', async () => {
    setBackend('journal');
    const chats = chatsDirIn(await discoveryDirectory('siblings'));
    const healthy = await recordJournal(chats, 'healthy', {
      rows: [userRow('kept')],
      name: 'chosen',
      checkpoints: ['point'],
    });
    const damaged = join(chats, 'session-damaged.llxj');
    const retired = join(chats, 'session-retired.jsonl');
    await writeFile(damaged, 'broken');
    await writeFile(retired, '{ invalid JSONL');
    await chmod(retired, 0);
    const expectedSkipped = [
      { filePath: damaged, reason: retiredMessage(damaged) },
      { filePath: retired, reason: retiredMessage(retired) },
    ];
    for (const ref of [CONTINUE_LATEST, 'healthy']) {
      const result = await resumeSession(request(chats, ref));
      if (!result.ok) throw new Error(result.error);
      try {
        expect(result.skippedRecordings).toStrictEqual(expectedSkipped);
        expect(result.recording.getFilePath()).toBe(healthy.filePath);
        expect(await result.lockHandle.ownsLock()).toBe(true);
        expect(await bootRows(result.boot)).toStrictEqual([userRow('kept')]);
      } finally {
        await result.boot.close();
        await result.recording.dispose();
      }
    }
    const refused = await resumeSession(request(chats, basename(retired)));
    expect(refused).toMatchObject({
      ok: false,
      error: retiredMessage(retired),
      skippedRecordings: expectedSkipped,
    });
    const targets = await SessionDiscovery.listContinueTargets(chats, PROJECT);
    expect(targets.map((target) => target.kind)).toStrictEqual([
      'session',
      'checkpoint',
    ]);
    expect(
      (await readdir(chats)).filter((name) => name.endsWith('.llxj')),
    ).toHaveLength(2);
    expect(
      (await readdir(chats)).filter((name) => name.endsWith('.lock')),
    ).toStrictEqual([]);
  });

  for (const length of [8, 12, JOURNAL_HEADER_BYTES - 1]) {
    it(`rejects a current-format header truncated at ${length} bytes without blocking a native sibling`, async () => {
      setBackend('journal');
      const chats = chatsDirIn(await discoveryDirectory('header-cut'));
      const broken = await recordJournal(chats, 'broken', {
        rows: [userRow('bad')],
      });
      const bytes = await readFile(broken.filePath);
      await writeFile(broken.filePath, bytes.subarray(0, length));
      await recordJournal(chats, 'healthy', { rows: [userRow('good')] });
      const found = await SessionDiscovery.listContinueTargetsDetailed(
        chats,
        PROJECT,
      );
      expect(
        found.targets.map((target) =>
          target.kind === 'session'
            ? target.session.sessionId
            : target.checkpointId,
        ),
      ).toStrictEqual(['healthy']);
      expect(found.unreadableRecordings).toHaveLength(1);
      expect(found.unreadableRecordings[0].filePath).toBe(broken.filePath);
      expect(found.unreadableRecordings[0].reason).toMatch(
        /header|bytes|truncat/i,
      );
      expect(
        await SessionDiscovery.readSessionHeader(broken.filePath),
      ).toBeNull();
      expect(await SessionDiscovery.hasContentEvents(broken.filePath)).toBe(
        false,
      );
      expect(
        await SessionDiscovery.readFirstUserMessage(broken.filePath),
      ).toBeNull();
      expect(
        await SessionDiscovery.readSessionMetadataTitle(broken.filePath),
      ).toBeUndefined();
      expect((await stat(broken.filePath)).size).toBe(length);
    });
  }

  const damageCases = (['rowRoot', 'stateRoot'] as const).flatMap((rootName) =>
    (['frame', 'body', 'truncated-body'] as const).map((region) => ({
      rootName,
      region,
    })),
  );
  for (const { rootName, region } of damageCases) {
    it(`refuses an intact latest trailer with damaged ${rootName} ${region}, never an older committed version`, async () => {
      setBackend('journal');
      const chats = chatsDirIn(await discoveryDirectory('root-corrupt'));
      const broken = await recordJournal(chats, 'broken', {
        rows: [userRow('older')],
        checkpoints: ['older-version'],
        rowsAfterCheckpoints: [userRow('newer')],
      });
      const reader = await openJournalReadOnly(broken.filePath);
      let offset: number;
      let trailerOffset: number;
      let damageAt: number;
      let truncatedHead: Uint8Array | undefined;
      try {
        if (reader.trailer === undefined)
          throw new Error('Missing committed trailer');
        offset = reader.trailer[rootName];
        trailerOffset = reader.trailer.selfOffset;
        const head = await reader.readRecordHead(offset);
        damageAt = region === 'frame' ? offset + 1 : head.bodyOffset;
        if (region === 'truncated-body') {
          truncatedHead = encodeFrameStart(
            head.kind,
            head.kindHeader,
            reader.fileSize,
          );
        }
      } finally {
        await reader.close();
      }
      const bytes = await readFile(broken.filePath);
      const damaged = Buffer.from(bytes);
      if (truncatedHead === undefined) damaged[damageAt] ^= 1;
      else damaged.set(truncatedHead, offset);
      await writeFile(broken.filePath, damaged);
      await recordJournal(chats, 'healthy', { rows: [userRow('healthy')] });
      await expect(readJournalFileFacts(broken.filePath)).rejects.toMatchObject(
        { what: rootName, offset, trailerOffset },
      );
      const found = await SessionDiscovery.listContinueTargetsDetailed(
        chats,
        PROJECT,
      );
      expect(
        found.targets.map((target) =>
          target.kind === 'session'
            ? target.session.sessionId
            : target.checkpointId,
        ),
      ).toStrictEqual(['healthy']);
      expect(found.unreadableRecordings).toMatchObject([
        {
          filePath: broken.filePath,
          reason: expect.stringContaining(rootName),
        },
      ]);
      const refused = await resumeSession(
        request(chats, basename(broken.filePath)),
      );
      expect(refused).toMatchObject({
        ok: false,
        error: expect.stringContaining(rootName),
      });
      expect(await SessionLockManager.isLocked(chats, 'broken')).toBe(false);
      expect(await readFile(broken.filePath)).toStrictEqual(damaged);
    });
  }

  it('matches unreadable references without treating indices, ambiguity or unrelated identifiers as failed files', async () => {
    const filePath = join(
      await discoveryDirectory('unreadable-references'),
      'session-damaged.llxj',
    );
    const identified = {
      filePath,
      sessionId: 'unreadable-session',
      reason: 'damaged state',
    };
    const unknown = {
      filePath: filePath + '.other',
      reason: 'unreadable header',
    };
    const records = [identified, unknown];
    for (const ref of [filePath, basename(filePath), 'unreadable-']) {
      expect(
        matchUnreadableRecordings(
          ref,
          resumeSessionNotFoundMessage(ref),
          records,
        ),
      ).toStrictEqual([identified]);
    }
    for (const ref of ['', '1', 'unrelated']) {
      expect(
        matchUnreadableRecordings(
          ref,
          resumeSessionNotFoundMessage(ref),
          records,
        ),
      ).toStrictEqual([]);
    }
    expect(
      matchUnreadableRecordings(
        'unreadable-',
        'Ambiguous session prefix',
        records,
      ),
    ).toStrictEqual([]);
    expect(
      matchUnreadableRecordings(
        basename(unknown.filePath),
        resumeSessionNotFoundMessage(basename(unknown.filePath)),
        records,
      ),
    ).toStrictEqual([unknown]);
    expect(noReadableSessionsError([])).toBe(
      'No sessions found for this project',
    );
    expect(noReadableSessionsError(records)).toBe(
      `No sessions found for this project; skipped unreadable recordings: ${filePath}: damaged state; ${unknown.filePath}: unreadable header`,
    );
  });

  it('keeps healthy continue targets when the checkpoint metadata read fails after a successful summary read', async () => {
    setBackend('journal');
    const chats = chatsDirIn(
      await discoveryDirectory('checkpoint-read-failure'),
    );
    await recordJournal(chats, 'healthy', {
      rows: [userRow('healthy')],
      modifiedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const failing = await recordJournal(chats, 'failing', {
      rows: [userRow('failing')],
      checkpoints: ['saved'],
      modifiedAt: new Date('2026-02-01T00:00:00Z'),
    });
    const originalReader = positionalFile.createFileHandleReader;
    let views = 0;
    const fault = spyOn(
      positionalFile,
      'createFileHandleReader',
    ).mockImplementation((handle) => {
      views += 1;
      if (views === 3)
        return {
          readAt: async () => {
            throw new Error('checkpoint metadata disk read failed');
          },
        };
      return originalReader(handle);
    });
    try {
      const found = await SessionDiscovery.listContinueTargetsDetailed(
        chats,
        PROJECT,
      );
      expect(
        found.targets.map((target) =>
          target.kind === 'session'
            ? target.session.sessionId
            : target.checkpointId,
        ),
      ).toStrictEqual(['healthy']);
      expect(found.unreadableRecordings).toStrictEqual([
        {
          sessionId: 'failing',
          filePath: failing.filePath,
          reason: 'checkpoint metadata disk read failed',
        },
      ]);
      expect(found.recordingErrors).toStrictEqual([
        `${failing.filePath}: checkpoint metadata disk read failed`,
      ]);
      expect(found.skippedCount).toBe(1);
    } finally {
      fault.mockRestore();
    }
  });

  it('lists metadata without decoding row bodies, but streaming resume rejects a corrupt committed body instead of returning an older history', async () => {
    setBackend('journal');
    const chats = chatsDirIn(await discoveryDirectory('body-corrupt'));
    const recorded = await recordJournal(chats, 'body', {
      rows: [userRow('older')],
      checkpoints: ['older-version'],
      rowsAfterCheckpoints: [userRow('newer')],
    });
    const reader = await openJournalReadOnly(recorded.filePath);
    let damageAt = 0;
    try {
      const root = rowTreeRootOf(reader.trailer);
      if (root === undefined) throw new Error('Missing rows');
      for await (const entry of iterateRowEntries(reader, root)) {
        const head = await reader.readRecordHead(entry.recordOffset);
        damageAt = head.bodyOffset;
      }
    } finally {
      await reader.close();
    }
    const bytes = await readFile(recorded.filePath);
    const damaged = Buffer.from(bytes);
    damaged[damageAt] ^= 1;
    await writeFile(recorded.filePath, damaged);
    expect(
      (await SessionDiscovery.listSessions(chats, PROJECT)).map((session) => [
        session.sessionId,
        session.messageCount,
      ]),
    ).toStrictEqual([['body', 2]]);
    const resumed = await resumeSession(request(chats, 'body'));
    if (!resumed.ok) throw new Error(resumed.error);
    try {
      await expect(bootRows(resumed.boot)).rejects.toBeInstanceOf(
        JournalCorruptionError,
      );
    } finally {
      await resumed.boot.close();
      await resumed.recording.dispose();
    }
  });
});
