/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import {
  HISTORY_BACKEND_ENV,
  type HistoryBackend,
} from '@vybestack/llxprt-code-core/services/history/historyBackendSelect.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { collectRawHistory } from './collect-raw-history.js';
import { collectJournalRowsForAssertions } from './collect-rows-for-assertions.js';
import { forbidHistoryMaterializationForTest } from './history-materialization-test-guard.js';
import { suffixRow, withSuffixFixture } from './history-suffix-test-helpers.js';
import { createRecorderForTest } from './recorder-for-test.js';
import { observeHistorySynchronouslyForTest } from './synchronous-history-test-observation.js';

const BACKENDS: readonly HistoryBackend[] = ['old', 'journal'];

describe('test infrastructure on both history backends', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[HISTORY_BACKEND_ENV];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[HISTORY_BACKEND_ENV];
    else process.env[HISTORY_BACKEND_ENV] = saved;
  });

  for (const backend of BACKENDS) {
    describe(`${backend} backend`, () => {
      beforeEach(() => {
        process.env[HISTORY_BACKEND_ENV] = backend;
      });

      it('creates the recorder of the backend with test defaults', async () => {
        const chatsDir = mkdtempSync(join(tmpdir(), 'recorder-for-test-'));
        const recorder = createRecorderForTest({ chatsDir });
        try {
          expect(recorder).toBeInstanceOf(
            backend === 'journal'
              ? JournalRecordingService
              : SessionRecordingService,
          );
          expect(recorder.getSessionId()).toBe('test-session');
          expect(recorder.getProjectHash()).toBe('test-project');
          expect(recorder.getChatsDir()).toBe(chatsDir);
        } finally {
          await recorder.dispose();
          rmSync(chatsDir, { recursive: true, force: true });
        }
      });

      it('lets the caller override a default of the recorder config', async () => {
        const chatsDir = mkdtempSync(join(tmpdir(), 'recorder-for-test-'));
        const recorder = createRecorderForTest({
          chatsDir,
          sessionId: 'chosen',
        });
        try {
          expect(recorder.getSessionId()).toBe('chosen');
        } finally {
          await recorder.dispose();
          rmSync(chatsDir, { recursive: true, force: true });
        }
      });

      it('reads the rows of the recorder file apart from the service', async () => {
        await withSuffixFixture(40, async (history) => {
          let seen = 0;
          await collectJournalRowsForAssertions(history, (rows) => {
            seen = rows.length;
            expect(rows).toStrictEqual(
              Array.from({ length: 40 }, (_, index) => suffixRow(index)),
            );
          });
          expect(seen).toBe(40);
        });
      });

      it('reads rows added after the fixture was seeded once they are durable', async () => {
        await withSuffixFixture(3, async (history) => {
          history.add(suffixRow(3));
          await collectJournalRowsForAssertions(history, (rows) => {
            expect(rows).toStrictEqual(
              Array.from({ length: 4 }, (_, index) => suffixRow(index)),
            );
          });
        });
      });

      it('guards the eager read of the service journal and restores it', async () => {
        await withSuffixFixture(2, async (history) => {
          const journal: object = Object(Reflect.get(history, 'journal'));
          const eagerRead = (): unknown =>
            backend === 'journal'
              ? Reflect.get(journal, 'materialize').call(journal)
              : observeHistorySynchronouslyForTest(history);
          const restore = forbidHistoryMaterializationForTest(
            history,
            'eager read forbidden',
          );
          await expect(Promise.resolve().then(eagerRead)).rejects.toThrow(
            'eager read forbidden',
          );
          expect(await collectRawHistory(history)).toHaveLength(2);
          restore();
          expect(await Promise.resolve(eagerRead())).toHaveLength(2);
        });
      });
    });
  }

  it('samples the old backend in the same turn', () => {
    process.env[HISTORY_BACKEND_ENV] = 'old';
    const service = new HistoryService();
    service.add(suffixRow(0));
    expect(observeHistorySynchronouslyForTest(service)).toHaveLength(1);
    return service.dispose();
  });

  it('refuses a same-turn sample of the journal backend and names the replacement', async () => {
    process.env[HISTORY_BACKEND_ENV] = 'journal';
    const service = new HistoryService();
    try {
      service.add(suffixRow(0));
      expect(() => observeHistorySynchronouslyForTest(service)).toThrow(
        'Await waitForCommit() and read collectRawHistory() instead',
      );
      await service.waitForCommit();
      expect(await collectRawHistory(service)).toHaveLength(1);
    } finally {
      await service.dispose();
    }
  });
});
