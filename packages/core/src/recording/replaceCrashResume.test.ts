/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { truncate } from 'node:fs/promises';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { resumeSession } from './resumeSession.js';
import { readJournalSnapshot } from './__tests__/support/journalSnapshot.js';
import {
  PROJECT_HASH,
  recordingConfig,
  requireBoot,
  rowTexts,
  seedRecording,
  textRow,
} from './__tests__/support/journalRecordingFixture.js';

describe('replacement after resuming an interrupted commit group', () => {
  const directory = useTempDir('replace-crash-journal-');
  const histories: HistoryService[] = [];
  const recordings: JournalRecordingService[] = [];
  afterEach(async () => {
    for (const history of histories.splice(0)) await history.dispose();
    for (const recording of recordings.splice(0)) await recording.dispose();
  });

  async function crashed(
    stage: 'start' | 'rows' | 'committed',
  ): Promise<{ file: string; id: string }> {
    const seed = await seedRecording(directory(), 0);
    const id = seed.recording.getSessionId();
    const recording = await JournalRecordingService.open(
      recordingConfig(directory(), { sessionId: id }),
      seed.filePath,
    );
    const session = await recording.session();
    await session.append([textRow('old')]);
    const baseline = session.store.published;
    if (baseline === undefined) throw new Error('Missing baseline');
    await session.store.commit([
      {
        kind: 'replace',
        rows: ['new-0', 'new-1'].map((text) =>
          encodeContentRow(textRow(text), { owner: 0 }),
        ),
      },
    ]);
    const replacement = session.store.published;
    if (replacement === undefined) throw new Error('Missing replacement');
    await recording.dispose();
    if (stage !== 'committed')
      await truncate(
        seed.filePath,
        stage === 'start' ? baseline.durableEnd + 1 : replacement.selfOffset,
      );
    return { file: seed.filePath, id };
  }

  async function resume(
    id: string,
  ): Promise<{ history: HistoryService; recording: JournalRecordingService }> {
    const result = await resumeSession({
      continueRef: id,
      projectHash: PROJECT_HASH,
      chatsDir: directory(),
      currentProvider: 'test',
      currentModel: 'model',
      workspaceDirs: [],
    });
    const boot = requireBoot(result);
    if (!result.ok || !(result.recording instanceof JournalRecordingService))
      throw new Error('Expected journal resume');
    const history = new HistoryService();
    recordings.push(result.recording);
    histories.push(history);
    await history.adoptResumeBoot(result.recording, boot);
    return { history, recording: result.recording };
  }

  for (const stage of ['start', 'rows'] satisfies Array<'start' | 'rows'>) {
    it(`replaces after a crash at ${stage} without exposing incomplete rows`, async () => {
      const crash = await crashed(stage);
      expect(
        rowTexts((await readJournalSnapshot(crash.file, PROJECT_HASH)).history),
      ).toStrictEqual(['old']);
      const { history } = await resume(crash.id);
      expect(
        rowTexts(await Array.fromAsync(history.streamRawHistory())),
      ).toStrictEqual(['old']);
      await history.replaceBatch([
        textRow('restored'),
        textRow('restored again'),
      ]);
      await history.waitForCommit();
      expect(
        rowTexts((await readJournalSnapshot(crash.file, PROJECT_HASH)).history),
      ).toStrictEqual(['restored', 'restored again']);
    });
  }

  it('keeps the prior history when nothing is replaced after resume', async () => {
    const crash = await crashed('rows');
    const { history, recording } = await resume(crash.id);
    expect(
      rowTexts(await Array.fromAsync(history.streamRawHistory())),
    ).toStrictEqual(['old']);
    await history.dispose();
    await recording.dispose();
    expect(
      rowTexts((await readJournalSnapshot(crash.file, PROJECT_HASH)).history),
    ).toStrictEqual(['old']);
  });

  it('keeps the previous version across repeated restarts and accepts a later replacement', async () => {
    const crash = await crashed('rows');
    for (let restart = 0; restart < 2; restart++) {
      const { history, recording } = await resume(crash.id);
      expect(
        rowTexts(await Array.fromAsync(history.streamRawHistory())),
      ).toStrictEqual(['old']);
      await history.dispose();
      await recording.dispose();
    }
    const { history, recording } = await resume(crash.id);
    await history.replaceBatch([textRow('restored')]);
    await history.waitForCommit();
    await history.dispose();
    await recording.dispose();
    const next = await resume(crash.id);
    expect(
      rowTexts(await Array.fromAsync(next.history.streamRawHistory())),
    ).toStrictEqual(['restored']);
  });

  it('resumes the new version when the replacement trailer completed', async () => {
    const crash = await crashed('committed');
    const { history } = await resume(crash.id);
    expect(
      rowTexts(await Array.fromAsync(history.streamRawHistory())),
    ).toStrictEqual(['new-0', 'new-1']);
    expect(
      rowTexts((await readJournalSnapshot(crash.file, PROJECT_HASH)).history),
    ).toStrictEqual(['new-0', 'new-1']);
  });
});
