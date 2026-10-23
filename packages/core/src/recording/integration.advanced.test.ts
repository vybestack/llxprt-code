/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { describe, expect, it } from 'bun:test';
import * as fc from 'fast-check';
import { access, mkdtemp, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { useTempDir } from '../journal/__tests__/support/useTempDir.js';
import { openJournalReadOnly } from '../journal/journalReader.js';
import { readVersionAt } from '../journal/trailerAccess.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import { readJournalSnapshot } from './__tests__/support/journalSnapshot.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { resumeSession } from './resumeSession.js';
import { deleteSession } from './sessionManagement.js';

const PROJECT_HASH = 'integration-test-project';

function content(
  text: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

function generatedRows(prefix: string, count: number): IContent[] {
  return Array.from(
    { length: count },
    (_, index): IContent =>
      content(`${prefix}-${index}`, index % 2 === 0 ? 'human' : 'ai'),
  );
}

function config(
  chatsDir: string,
  sessionId = crypto.randomUUID(),
): Parameters<typeof JournalRecordingService.create>[0] {
  return {
    sessionId,
    projectHash: PROJECT_HASH,
    chatsDir,
    workspaceDirs: ['/test/workspace'],
    provider: 'anthropic',
    model: 'claude-4',
  };
}

function fileOf(recording: JournalRecordingService): string {
  const file = recording.getFilePath();
  if (file === null) throw new Error('Missing journal recording');
  return file;
}

async function record(
  chatsDir: string,
  rows: readonly IContent[],
  sessionId?: string,
): Promise<JournalRecordingService> {
  const recording = JournalRecordingService.create(config(chatsDir, sessionId));
  try {
    await recordRowsForTest(recording, rows);
    await recording.flush();
    return recording;
  } finally {
    await recording.dispose();
  }
}

async function assertMonotonic(file: string): Promise<void> {
  const reader = await openJournalReadOnly(file);
  try {
    let current = reader.trailer;
    if (current === undefined) throw new Error('Missing committed trailer');
    while (current.parent !== 0) {
      const parent = await readVersionAt(reader, current.parent);
      expect(current.commitSeq).toBeGreaterThan(parent.commitSeq);
      current = parent;
    }
  } finally {
    await reader.close();
  }
}

describe('integration: journal recording lifecycle properties', () => {
  const directory = useTempDir('integration-properties-');

  it('roundtrips arbitrary content sequences', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            speaker: fc.constantFrom('human', 'ai'),
            text: fc.string({ minLength: 1, maxLength: 100 }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        async (items) => {
          const rows = items.map((item) =>
            content(item.text, item.speaker === 'human' ? 'human' : 'ai'),
          );
          const recording = await record(directory(), rows);
          const saved = await readJournalSnapshot(
            fileOf(recording),
            PROJECT_HASH,
          );
          expect(saved.history).toHaveLength(rows.length);
          for (let index = 0; index < rows.length; index++) {
            expect(saved.history[index].speaker).toBe(rows[index].speaker);
            expect(saved.history[index].blocks).toStrictEqual(
              rows[index].blocks,
            );
          }
          expect(saved.history).toStrictEqual(rows);
        },
      ),
      { numRuns: 15 },
    );
  });

  it('preserves the original rows and length when resuming arbitrary turn counts', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 15 }), async (turnCount) => {
        const rows = generatedRows('turn', turnCount * 2);
        const recording = await record(directory(), rows);
        const result = await resumeSession({
          continueRef: recording.getSessionId(),
          projectHash: PROJECT_HASH,
          chatsDir: directory(),
          currentProvider: 'anthropic',
          currentModel: 'claude-4',
          workspaceDirs: ['/test/workspace'],
        });
        if (!result.ok) throw new Error(result.error);
        try {
          const restored = await Array.fromAsync(result.boot.streamRows());
          expect(restored).toHaveLength(turnCount * 2);
          expect(restored).toStrictEqual(rows);
        } finally {
          await result.recording.dispose();
        }
      }),
      { numRuns: 10 },
    );
  });

  it('keeps commit sequences monotonic through repeated resumes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), async (resumeCount) => {
        const recording = await record(directory(), [
          content('initial-h'),
          content('initial-a', 'ai'),
        ]);
        const file = fileOf(recording);
        let sequence = (await readJournalSnapshot(file, PROJECT_HASH))
          .commitSeq;
        for (let index = 0; index < resumeCount; index++) {
          const reopened = await JournalRecordingService.open(
            config(directory(), recording.getSessionId()),
            file,
          );
          try {
            await recordRowsForTest(reopened, [
              content(`resume-${index}-h`),
              content(`resume-${index}-a`, 'ai'),
            ]);
            await reopened.flush();
          } finally {
            await reopened.dispose();
          }
          const saved = await readJournalSnapshot(file, PROJECT_HASH);
          expect(saved.commitSeq).toBeGreaterThan(sequence);
          sequence = saved.commitSeq;
        }
        await assertMonotonic(file);
      }),
      { numRuns: 8 },
    );
  });

  it('discovers arbitrary recording counts in newest-first order', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 6 }), async (sessionCount) => {
        const chats = await mkdtemp(join(directory(), 'discovery-'));
        try {
          for (let index = 0; index < sessionCount; index++) {
            const recording = await record(chats, [content(`s${index}`)]);
            const when = new Date(Date.UTC(2026, 9, 1 + index));
            await utimes(fileOf(recording), when, when);
          }
          const sessions = await SessionDiscovery.listSessions(
            chats,
            PROJECT_HASH,
          );
          expect(sessions).toHaveLength(sessionCount);
          for (let index = 1; index < sessions.length; index++)
            expect(
              sessions[index - 1].lastModified.getTime(),
            ).toBeGreaterThanOrEqual(sessions[index].lastModified.getTime());
        } finally {
          await rm(chats, { recursive: true, force: true });
        }
      }),
      { numRuns: 5 },
    );
  });

  it('persists compression as one summary plus every post-compression row', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        async (preCount, postCount) => {
          const recording = JournalRecordingService.create(config(directory()));
          const history = new HistoryService({ recording });
          const summary = content('compressed-summary', 'ai');
          const post = generatedRows('post', postCount);
          try {
            await history.addBatch(generatedRows('pre', preCount));
            history.startCompression();
            await history.replaceAll([summary]);
            history.endCompression(summary, preCount);
            if (post.length > 0) await history.addBatch(post);
            await history.waitForCommit();
          } finally {
            await history.dispose();
            await recording.dispose();
          }
          const saved = await readJournalSnapshot(
            fileOf(recording),
            PROJECT_HASH,
          );
          expect(saved.history).toHaveLength(1 + postCount);
          expect(saved.history.map((row) => row.blocks)).toStrictEqual(
            [summary, ...post].map((row) => row.blocks),
          );
        },
      ),
      { numRuns: 15 },
    );
  });

  it('persists each provider switch and exposes the last provider and model', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 8 }), async (switchCount) => {
        const recording = JournalRecordingService.create(config(directory()));
        try {
          await recordRowsForTest(recording, [content('start')]);
          const before = (
            await readJournalSnapshot(fileOf(recording), PROJECT_HASH)
          ).commitSeq;
          for (let index = 0; index < switchCount; index++) {
            recording.recordProviderSwitch(
              `provider-${index}`,
              `model-${index}`,
            );
            await recording.flush();
            const saved = await readJournalSnapshot(
              fileOf(recording),
              PROJECT_HASH,
            );
            expect(saved.commitSeq).toBe(before + index + 1);
            expect(saved.metadata.provider).toBe(`provider-${index}`);
            expect(saved.metadata.model).toBe(`model-${index}`);
          }
          const saved = await readJournalSnapshot(
            fileOf(recording),
            PROJECT_HASH,
          );
          expect(saved.metadata.provider).toBe(`provider-${switchCount - 1}`);
          expect(saved.metadata.model).toBe(`model-${switchCount - 1}`);
        } finally {
          await recording.dispose();
        }
      }),
      { numRuns: 10 },
    );
  });

  it('defers materialization for arbitrary operational-event counts until content arrives', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 15 }), async (eventCount) => {
        const recording = JournalRecordingService.create(config(directory()));
        try {
          for (let index = 0; index < eventCount; index++)
            recording.recordSessionEvent('info', `event-${index}`);
          await recording.flush();
          expect(recording.getFilePath()).toBeNull();
          await recordRowsForTest(recording, [content('trigger')]);
          await recording.flush();
          expect(recording.getFilePath()).not.toBeNull();
          expect(
            (await readJournalSnapshot(fileOf(recording), PROJECT_HASH))
              .history,
          ).toHaveLength(1);
        } finally {
          await recording.dispose();
        }
      }),
      { numRuns: 10 },
    );
  });

  it('rewinds arbitrary counts leaving exactly the surviving prefix', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 10 }),
        async (totalItems, rewindCount) => {
          const recording = JournalRecordingService.create(config(directory()));
          const history = new HistoryService({ recording });
          const rows = generatedRows('item', totalItems);
          try {
            await history.addBatch(rows);
            for (let index = 0; index < rewindCount; index++)
              await history.pop();
            await history.waitForCommit();
          } finally {
            await history.dispose();
            await recording.dispose();
          }
          const saved = await readJournalSnapshot(
            fileOf(recording),
            PROJECT_HASH,
          );
          const expected = Math.max(0, totalItems - rewindCount);
          expect(saved.history).toHaveLength(expected);
          expect(saved.history.map((row) => row.blocks)).toStrictEqual(
            rows.slice(0, expected).map((row) => row.blocks),
          );
        },
      ),
      { numRuns: 12 },
    );
  });

  it('preserves initial and appended rows for arbitrary counts across resume', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 1, max: 8 }),
        async (initialCount, additionalCount) => {
          const initial = generatedRows('init', initialCount);
          const added = generatedRows('add', additionalCount);
          const recording = await record(directory(), initial);
          const file = fileOf(recording);
          const reopened = await JournalRecordingService.open(
            config(directory(), recording.getSessionId()),
            file,
          );
          try {
            await recordRowsForTest(reopened, added);
            await reopened.flush();
          } finally {
            await reopened.dispose();
          }
          const saved = await readJournalSnapshot(file, PROJECT_HASH);
          expect(saved.history).toHaveLength(initialCount + additionalCount);
          expect(saved.history).toStrictEqual([...initial, ...added]);
        },
      ),
      { numRuns: 10 },
    );
  });

  it('deletes the session file for arbitrary content counts', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (contentCount) => {
        const chats = await mkdtemp(join(directory(), 'delete-'));
        try {
          const recording = await record(
            chats,
            generatedRows('del', contentCount),
          );
          const file = fileOf(recording);
          await expect(access(file)).resolves.toBeFalsy();
          expect(
            (await deleteSession(recording.getSessionId(), chats, PROJECT_HASH))
              .ok,
          ).toBe(true);
          await expect(access(file)).rejects.toThrow(/ENOENT/);
        } finally {
          await rm(chats, { recursive: true, force: true });
        }
      }),
      { numRuns: 8 },
    );
  });

  it('preserves arbitrary session IDs through recording and reopening', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uuid(), async (sessionId) => {
        const recording = await record(
          directory(),
          [content('hello')],
          sessionId,
        );
        expect(
          (await readJournalSnapshot(fileOf(recording), PROJECT_HASH)).metadata
            .sessionId,
        ).toBe(sessionId);
      }),
      { numRuns: 10 },
    );
  });
});
