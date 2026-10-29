/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { JournalRecordingService } from '../../recording/journalRecordingService.js';
import { KeyedMapReader } from '../../journal/keyedMap.js';
import { BoundedIdNodeCache } from '../../journal/idTrieCache.js';
import { sha256KeyHash } from '../../journal/idKeys.js';
import { openJournalReadOnly } from '../../journal/journalReader.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import type { IContent } from './IContent.js';

const prompt: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'submitted' }],
};

describe('prompt submission mirrors', () => {
  const directory = useTempDir('submission-mirrors-');
  it('reuses the committed prompt after closing and resuming its owner', async () => {
    const config = {
      sessionId: 'resume',
      projectHash: 'resume',
      chatsDir: directory(),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
    };
    const first = JournalRecordingService.create(config);
    const history = new HistoryService({ recording: first });
    await history.submitPrompt('resume-id', [prompt]);
    const session = await first.session();
    const version = session.store.published;
    const path = first.getFilePath();
    if (version === undefined || path === null)
      throw new Error('Missing submitted version');
    const boot = {
      commitSeq: version.commitSeq,
      rows: version.rows,
      nextLabel: version.nextLabel,
    };
    await history.dispose();
    await first.dispose();
    const recording = await JournalRecordingService.open(config, path);
    const resumed = new HistoryService();
    try {
      await resumed.adoptResumeBoot(recording, boot);
      await resumed.submitPrompt('resume-id', [prompt]);
      expect(await resumed.countCuratedRows()).toBe(1);
      expect(await resumed.hasPromptSubmission('resume-id')).toBe(true);
    } finally {
      await resumed.dispose();
      await recording.dispose();
    }
  });
  it.each([false, true])(
    'preserves the prompt receipt in a mirror (late attach: %s)',
    async (late) => {
      const history = new HistoryService();
      const recording = JournalRecordingService.create({
        sessionId: 'mirror',
        projectHash: 'mirror',
        chatsDir: directory(),
        workspaceDirs: [],
        provider: 'test',
        model: 'test',
      });
      try {
        await history.addBatch([
          { speaker: 'ai', blocks: [{ type: 'text', text: 'existing' }] },
        ]);
        if (!late) await history.attachJournal(recording);
        await history.submitPrompt('persisted', [prompt]);
        if (late) await history.attachJournal(recording);
        await history.waitForCommit();
        const path = recording.getFilePath();
        if (path === null) throw new Error('Missing mirror file');
        const file = await openJournalReadOnly(path);
        try {
          const meta = new KeyedMapReader(
            file,
            new BoundedIdNodeCache(),
            'meta',
            sha256KeyHash,
          );
          expect(
            await meta.get(file.trailer?.metaRoot ?? 0, 'submission:persisted'),
          ).toStrictEqual(new Uint8Array([1]));
        } finally {
          await file.close();
        }
      } finally {
        await history.dispose();
        await recording.dispose();
      }
    },
  );
});
