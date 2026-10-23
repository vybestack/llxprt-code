/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, describe, expect, it } from 'bun:test';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { HistoryService } from '../services/history/HistoryService.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { SessionTransitionService } from './SessionTransitionService.js';
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

describe('forkFromCheckpoint with replacement versions', () => {
  const sourceDir = useTempDir('fork-replace-source-');
  const childDir = useTempDir('fork-replace-child-');
  const recordings: JournalRecordingService[] = [];
  const histories: HistoryService[] = [];
  afterEach(async () => {
    for (const history of histories.splice(0)) await history.dispose();
    for (const recording of recordings.splice(0)) await recording.dispose();
  });

  for (const placement of ['before', 'after'] satisfies Array<
    'before' | 'after'
  >) {
    it(`forks the saved version ${placement} replacement and persists an independent child replacement`, async () => {
      const seed = await seedRecording(sourceDir(), 1, {
        checkpointAfter: placement === 'before' ? 1 : undefined,
      });
      const parent = await JournalRecordingService.open(
        recordingConfig(sourceDir(), {
          sessionId: seed.recording.getSessionId(),
        }),
        seed.filePath,
      );
      recordings.push(parent);
      const session = await parent.session();
      await session.store.commit([
        {
          kind: 'replace',
          rows: [encodeContentRow(textRow('parent replacement'), { owner: 0 })],
        },
      ]);
      const cp =
        placement === 'after'
          ? await parent.createCheckpoint('after')
          : undefined;
      const target =
        cp === undefined
          ? seed.target
          : ({
              kind: 'checkpoint',
              source: {
                sessionId: parent.getSessionId(),
                projectHash: PROJECT_HASH,
                filePath: seed.filePath,
                startTime: new Date().toISOString(),
                lastModified: new Date(),
                fileSize: 0,
                provider: 'test',
                model: 'model',
              },
              checkpointId: cp.checkpointId,
              checkpointName: cp.name,
              sequence: cp.sequence,
            } satisfies Parameters<
              SessionTransitionService['forkFromCheckpoint']
            >[0]);
      if (target === undefined) throw new Error('Missing checkpoint');
      await parent.dispose();
      const result = await new SessionTransitionService().forkFromCheckpoint(
        target,
        childDir(),
        PROJECT_HASH,
        'test',
        'model',
        [],
      );
      const boot = requireBoot(result);
      if (!result.ok || !(result.recording instanceof JournalRecordingService))
        throw new Error('Expected journal fork');
      const child = result.recording;
      recordings.push(child);
      expect(rowTexts(await Array.fromAsync(boot.streamRows()))).toStrictEqual([
        placement === 'before' ? 'row-0' : 'parent replacement',
      ]);
      const history = new HistoryService();
      histories.push(history);
      await history.adoptResumeBoot(child, boot);
      await history.replaceAll([textRow('child replacement')]);
      await history.waitForCommit();
      const file = child.getFilePath();
      if (file === null) throw new Error('Missing child');
      expect(
        rowTexts((await readJournalSnapshot(file, PROJECT_HASH)).history),
      ).toStrictEqual(['child replacement']);
      expect(
        rowTexts(
          (await readJournalSnapshot(seed.filePath, PROJECT_HASH)).history,
        ),
      ).toStrictEqual(['parent replacement']);
      await history.dispose();
      await child.dispose();
      const resumed = await resumeSession({
        continueRef: result.metadata.sessionId,
        projectHash: PROJECT_HASH,
        chatsDir: childDir(),
        currentProvider: 'test',
        currentModel: 'model',
        workspaceDirs: [],
      });
      const resumedBoot = requireBoot(resumed);
      if (!resumed.ok) throw new Error(resumed.error);
      try {
        expect(
          rowTexts(await Array.fromAsync(resumedBoot.streamRows())),
        ).toStrictEqual(['child replacement']);
      } finally {
        await resumed.recording.dispose();
      }
    });
  }
});
