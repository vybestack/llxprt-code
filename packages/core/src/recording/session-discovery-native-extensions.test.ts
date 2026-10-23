/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import { discoveryDirectory } from './__tests__/support/native-discovery-fixture.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { SessionDiscovery } from './SessionDiscovery.js';

import {
  PROJECT,
  journalSeams,
  userRow,
} from './__tests__/support/recordedJournals.js';

async function recordedHistory(
  chats: string,
  rows: readonly IContent[],
): Promise<string> {
  const history = new HistoryService({});
  const recording = JournalRecordingService.create({
    sessionId: 'extension',
    projectHash: PROJECT,
    chatsDir: chats,
    workspaceDirs: ['/work'],
    provider: 'unknown',
    model: '',
    journal: journalSeams(),
  });
  const integration = new RecordingIntegration(recording);
  try {
    await integration.subscribeToJournal(history);
    for (const row of rows) history.add(row);
    await integration.flushAtTurnBoundary();
    const file = recording.getFilePath();
    if (file === null) throw new Error('No recording');
    return file;
  } finally {
    await integration.dispose();
    await history.dispose();
    await recording.dispose();
  }
}

describe('native discovery extension behavior through real recording', () => {
  it('selects the first nonempty human text and concatenates its text blocks without media or assistant text', async () => {
    const chats = join(await discoveryDirectory('preview-parts'), 'chats');
    const file = await recordedHistory(chats, [
      { speaker: 'ai', blocks: [{ type: 'text', text: 'not the preview' }] },
      userRow(''),
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'first ' },
          {
            type: 'media',
            mimeType: 'image/png',
            encoding: 'base64',
            data: 'AQID',
          },
          { type: 'text', text: 'question 雪' },
        ],
      },
      userRow('later question'),
    ]);
    expect(await SessionDiscovery.readFirstUserMessage(file)).toBe(
      'first question 雪',
    );
    expect(await SessionDiscovery.readFirstUserMessage(file, 5)).toBe('first');
    expect(await SessionDiscovery.hasContentEvents(file)).toBe(true);
    const result = await SessionDiscovery.listSessionsDetailed(chats, PROJECT);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({
      provider: 'unknown',
      model: '',
      messageCount: 4,
      preview: 'first question 雪',
    });
  });

  it.each([119, 120, 121, 500])(
    'preserves the 120-character preview boundary for a %i-character user message',
    async (length) => {
      const file = await recordedHistory(
        join(await discoveryDirectory(`preview-${length}`), 'chats'),
        [userRow('雪'.repeat(length))],
      );
      expect(await SessionDiscovery.readFirstUserMessage(file, 120)).toBe(
        '雪'.repeat(Math.min(length, 120)),
      );
      expect(await SessionDiscovery.readFirstUserMessage(file, 0)).toBe('');
    },
  );

  it('has content but no user preview for assistant-only history', async () => {
    const file = await recordedHistory(
      join(await discoveryDirectory('assistant-only'), 'chats'),
      [{ speaker: 'ai', blocks: [{ type: 'text', text: 'answer' }] }],
    );
    expect(await SessionDiscovery.hasContentEvents(file)).toBe(true);
    expect(await SessionDiscovery.readFirstUserMessage(file)).toBeNull();
  });

  it('returns empty or unreadable results for absent, empty and malformed external native files while propagating directory I/O failures', async () => {
    const directory = await discoveryDirectory('external-files');
    const missing = join(directory, 'missing');
    expect(
      await SessionDiscovery.listSessionsDetailed(missing, PROJECT),
    ).toStrictEqual({
      sessions: [],
      skippedCount: 0,
      unreadableRecordings: [],
    });
    expect(
      await SessionDiscovery.listContinueTargets(missing, PROJECT),
    ).toStrictEqual([]);
    const obstructed = join(directory, 'not-directory');
    await writeFile(obstructed, 'x');
    await expect(
      SessionDiscovery.listSessionsDetailed(obstructed, PROJECT),
    ).rejects.toMatchObject({ code: 'ENOTDIR' });
    const chats = join(directory, 'chats');
    await mkdir(chats);
    const empty = join(chats, 'session-empty.llxj');
    const malformed = join(chats, 'session-malformed.llxj');
    await writeFile(empty, '');
    await writeFile(malformed, 'not a journal');
    for (const file of [join(chats, 'missing.llxj'), empty, malformed]) {
      expect(await SessionDiscovery.hasContentEvents(file)).toBe(false);
      expect(await SessionDiscovery.readFirstUserMessage(file)).toBeNull();
      expect(
        await SessionDiscovery.readSessionMetadataTitle(file),
      ).toBeUndefined();
      expect(await SessionDiscovery.readSessionHeader(file)).toBeNull();
    }
    const detailed = await SessionDiscovery.listSessionsDetailed(
      chats,
      PROJECT,
    );
    expect(detailed.sessions).toStrictEqual([]);
    expect(detailed.skippedCount).toBe(2);
    expect(
      detailed.unreadableRecordings.map((entry) => entry.filePath),
    ).toStrictEqual([empty, malformed]);
  });
});
