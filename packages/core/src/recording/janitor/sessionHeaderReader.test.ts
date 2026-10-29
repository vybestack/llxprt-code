/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalSession } from '../../services/history/journalSession.js';
import { journalSeams } from '../__tests__/support/recordedJournals.js';
import { SessionDiscovery } from '../SessionDiscovery.js';
import {
  JournalRecordingService,
  type JournalRecordingConfig,
} from '../journalRecordingService.js';
import { sessionFactEdit } from '../sessionEdits.js';
import { SESSION_KEYS } from '../sessionMetaKeys.js';
import { readSessionHeaderInfo } from './sessionHeaderReader.js';

describe('native session header reader', () => {
  const tempDir = useTempDir('janitor-header-');

  function makeConfig(): JournalRecordingConfig {
    return {
      sessionId: 'test-session-' + crypto.randomUUID(),
      projectHash: crypto.randomUUID().replace(/-/g, '').repeat(2),
      chatsDir: tempDir(),
      workspaceDirs: [tempDir()],
      provider: 'test-provider',
      model: 'test-model',
      journal: journalSeams(),
    };
  }

  async function record(config: JournalRecordingConfig): Promise<string> {
    const recording = JournalRecordingService.create(config);
    try {
      const session = await recording.session();
      await session.append([
        { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
      ]);
      await recording.flush();
      const filePath = recording.getFilePath();
      expect(filePath).not.toBeNull();
      if (filePath === null) throw new Error('Expected a session file');
      return filePath;
    } finally {
      await recording.dispose();
    }
  }

  it('reads the header from a real native recorder file', async () => {
    const config = makeConfig();
    const filePath = await record(config);
    const header = await readSessionHeaderInfo(filePath);
    expect(header).not.toBeNull();
    expect(header?.sessionId).toBe(config.sessionId);
    expect(typeof header?.startTime).toBe('string');
    expect(header?.startTime.length).toBeGreaterThan(0);
    expect(new Date(header?.startTime ?? '').getTime()).not.toBeNaN();
    expect(header?.projectHash).toBe(config.projectHash);
  });

  it('returns null for an empty file', async () => {
    const filePath = path.join(tempDir(), 'session-empty.llxj');
    await fs.writeFile(filePath, '');
    expect(await readSessionHeaderInfo(filePath)).toBeNull();
  });

  it('returns null for a journal with no session facts', async () => {
    const filePath = path.join(tempDir(), 'session-noheader.llxj');
    const session = await JournalSession.create(filePath, journalSeams());
    await session.close();
    expect(await readSessionHeaderInfo(filePath)).toBeNull();
  });

  it('returns null for a non-existent file', async () => {
    expect(
      await readSessionHeaderInfo(path.join(tempDir(), 'nonexistent.llxj')),
    ).toBeNull();
  });

  it('reads session facts larger than 4096 bytes', async () => {
    const config = { ...makeConfig(), workspaceDirs: ['x'.repeat(5000)] };
    expect(JSON.stringify(config.workspaceDirs).length).toBeGreaterThan(4096);
    const filePath = await record(config);
    const discovered = await SessionDiscovery.readSessionHeader(filePath);
    const header = await readSessionHeaderInfo(filePath);
    expect(header).not.toBeNull();
    expect(header?.sessionId).toBe(config.sessionId);
    expect(header?.startTime).toBe(discovered?.startTime);
    expect(discovered?.workspaceDirs).toStrictEqual(config.workspaceDirs);
  });

  it('returns null for corrupted session bytes', async () => {
    const filePath = path.join(tempDir(), 'session-bad.llxj');
    await fs.writeFile(filePath, 'this is not a journal\n');
    expect(await readSessionHeaderInfo(filePath)).toBeNull();
  });

  it('returns null for native session facts with an unsafe/path-like sessionId', async () => {
    const filePath = await record(makeConfig());
    const session = await JournalSession.open(filePath, journalSeams());
    try {
      await session.store.commit([
        sessionFactEdit(SESSION_KEYS.id, '../../etc/passwd'),
      ]);
    } finally {
      await session.close();
    }
    expect(await readSessionHeaderInfo(filePath)).toBeNull();
  });

  it('does not read a retired JSONL header as a usable session', async () => {
    const filePath = path.join(tempDir(), 'session-retired.jsonl');
    await fs.writeFile(
      filePath,
      JSON.stringify({
        type: 'session_start',
        payload: {
          sessionId: 'retired-session',
          startTime: new Date().toISOString(),
          projectHash: 'project',
        },
      }) + '\n',
    );
    expect(await readSessionHeaderInfo(filePath)).toBeNull();
  });
});
