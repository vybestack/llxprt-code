/** Copyright 2026 Vybestack LLC. SPDX-License-Identifier: Apache-2.0 */
import { afterEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { readJournalFileFacts } from './journalSessionListing.js';
import { SessionDiscovery } from './SessionDiscovery.js';

const PROJECT_HASH = 'session-metadata-project';

describe('journal session metadata (issue #1611)', () => {
  const directory = useTempDir('session-metadata-');
  const recordings: JournalRecordingService[] = [];

  afterEach(async () => {
    for (const recording of recordings.splice(0)) await recording.dispose();
  });

  function create(): JournalRecordingService {
    const recording = JournalRecordingService.create({
      sessionId: crypto.randomUUID(),
      projectHash: PROJECT_HASH,
      chatsDir: directory(),
      workspaceDirs: ['/test'],
      provider: 'test',
      model: 'test-model',
    });
    recordings.push(recording);
    return recording;
  }

  function fileOf(recording: JournalRecordingService): string {
    const filePath = recording.getFilePath();
    if (filePath === null) throw new Error('No session file');
    return filePath;
  }

  async function recordTitles(
    titles: ReadonlyArray<string | null>,
  ): Promise<string> {
    const recording = create();
    for (const title of titles) recording.recordSessionMetadata(title);
    await recording.session();
    await recording.flush();
    return fileOf(recording);
  }

  it('persists a concrete title in session state', async () => {
    const filePath = await recordTitles(['My session title']);
    expect((await readJournalFileFacts(filePath))?.facts.title).toBe(
      'My session title',
    );
  });

  it('records a null title for explicit untitled', async () => {
    const filePath = await recordTitles([null]);
    expect((await readJournalFileFacts(filePath))?.facts.title).toBeNull();
  });

  it('materializes metadata without a content row for slash and failure sessions', async () => {
    const recording = create();
    recording.recordSessionMetadata('Slash command title');
    await recording.flush();
    const facts = await readJournalFileFacts(fileOf(recording));
    expect(facts?.facts.title).toBe('Slash command title');
    expect(facts?.facts.sessionId).toBe(recording.getSessionId());
    expect(facts?.rows).toBe(0);
  });

  it('commits metadata before a subsequent content append', async () => {
    const recording = create();
    recording.recordSessionMetadata('Ordered title');
    const session = await recording.session();
    const before = await readJournalFileFacts(fileOf(recording));
    expect(before?.facts.title).toBe('Ordered title');
    expect(before?.rows).toBe(0);
    await session.append([
      { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
    ]);
    const after = await readJournalFileFacts(fileOf(recording));
    expect(after?.facts.title).toBe('Ordered title');
    expect(after?.rows).toBe(1);
  });

  describe('SessionDiscovery.readSessionMetadataTitle', () => {
    it('reads a string title', async () => {
      const filePath = await recordTitles(['Discovery title']);
      expect(await SessionDiscovery.readSessionMetadataTitle(filePath)).toBe(
        'Discovery title',
      );
    });

    it('reads null for explicit untitled', async () => {
      const filePath = await recordTitles([null]);
      expect(
        await SessionDiscovery.readSessionMetadataTitle(filePath),
      ).toBeNull();
    });

    it('returns undefined when no title has been set', async () => {
      const filePath = await recordTitles([]);
      expect(
        await SessionDiscovery.readSessionMetadataTitle(filePath),
      ).toBeUndefined();
    });

    it('returns undefined when the source cannot be opened', async () => {
      expect(
        await SessionDiscovery.readSessionMetadataTitle(
          path.join(directory(), 'missing-session.llxj'),
        ),
      ).toBeUndefined();
    });

    it('reads the last committed title when multiple titles were recorded', async () => {
      const filePath = await recordTitles([
        'First metadata',
        'Second metadata',
      ]);
      expect(await SessionDiscovery.readSessionMetadataTitle(filePath)).toBe(
        'Second metadata',
      );
    });
  });

  it('keeps createdAt unchanged when the session title and modification time change', async () => {
    const filePath = await recordTitles(['Original']);
    const [before] = await SessionDiscovery.listSessions(
      directory(),
      PROJECT_HASH,
    );
    expect(before.createdAt).toBeDefined();
    expect(typeof before.createdAt).toBe('string');
    expect(Number.isNaN(Date.parse(before.createdAt ?? ''))).toBe(false);
    const recording = recordings[0];
    recording.recordSessionMetadata('Updated');
    await recording.flush();
    const later = new Date(Date.now() + 1000);
    await fs.utimes(filePath, later, later);
    const [after] = await SessionDiscovery.listSessions(
      directory(),
      PROJECT_HASH,
    );
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.title).toBe('Updated');
  });
});
