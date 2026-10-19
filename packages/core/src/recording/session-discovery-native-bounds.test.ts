/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, spyOn } from 'bun:test';
import * as positionalFile from '../journal/positionalFile.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { SessionDiscovery } from './SessionDiscovery.js';
import { discoveryDirectory } from './__tests__/support/native-discovery-fixture.js';
import { useBackendEnv } from './__tests__/support/backendEnv.js';
import {
  PROJECT,
  chatsDirIn,
  journalSeams,
  userRow,
} from './__tests__/support/recordedJournals.js';

const METADATA_READ_BUDGET = 512 * 1024;

describe('native discovery reads bounded metadata instead of history', () => {
  const setBackend = useBackendEnv();

  for (const count of [40, 4000]) {
    it(`lists and counts ${count} rows with a multi-MiB body under the metadata byte budget`, async () => {
      setBackend('journal');
      const directory = await discoveryDirectory(`bounded-${count}`);
      const chats = chatsDirIn(directory);
      const recorder = JournalRecordingService.create({
        sessionId: 'bounded',
        projectHash: PROJECT,
        chatsDir: chats,
        workspaceDirs: ['/work/雪'],
        provider: 'anthropic',
        model: 'model-1',
        journal: journalSeams(),
      });
      let filePath: string;
      try {
        const session = await recorder.session();
        await session.append([
          userRow('z'.repeat(8 * 1024 * 1024)),
          ...Array.from({ length: count - 1 }, (_, index) =>
            userRow(`row-${index}`),
          ),
        ]);
        recorder.recordFirstUserPreview('bounded preview');
        await recorder.setSessionName('bounded name');
        await recorder.createCheckpoint('saved');
        await recorder.flush();
        const file = recorder.getFilePath();
        if (file === null) throw new Error('Expected recording');
        filePath = file;
      } finally {
        await recorder.dispose();
      }
      const originalReader = positionalFile.createFileHandleReader;
      const stats = { calls: 0, bytes: 0, largest: 0 };
      const observations: Array<{
        operation: string;
        calls: number;
        bytes: number;
        largest: number;
      }> = [];
      const instrumentation = spyOn(
        positionalFile,
        'createFileHandleReader',
      ).mockImplementation((handle) =>
        originalReader({
          read: async (buffer, offset, length, position) => {
            const result = await handle.read(buffer, offset, length, position);
            stats.calls += 1;
            stats.bytes += result.bytesRead;
            stats.largest = Math.max(stats.largest, result.bytesRead);
            return result;
          },
        }),
      );
      try {
        const result = await SessionDiscovery.listContinueTargetsDetailed(
          chats,
          PROJECT,
        );
        expect(result.targets).toMatchObject([
          {
            kind: 'session',
            session: {
              sessionId: 'bounded',
              messageCount: count,
              preview: 'bounded preview',
              name: 'bounded name',
            },
          },
          { kind: 'checkpoint', checkpointName: 'saved' },
        ]);
        expect(result.unreadableRecordings).toStrictEqual([]);
        observations.push({ operation: 'continue-targets', ...stats });
        const operations: Array<{
          operation: string;
          read: () => Promise<unknown>;
          expected: unknown;
        }> = [
          {
            operation: 'header',
            read: async () =>
              (await SessionDiscovery.readSessionHeader(filePath))?.sessionId,
            expected: 'bounded',
          },
          {
            operation: 'has-content',
            read: () => SessionDiscovery.hasContentEvents(filePath),
            expected: true,
          },
          {
            operation: 'preview',
            read: () => SessionDiscovery.readFirstUserMessage(filePath),
            expected: 'bounded preview',
          },
          {
            operation: 'title',
            read: () => SessionDiscovery.readSessionMetadataTitle(filePath),
            expected: undefined,
          },
        ];
        for (const { operation, read, expected } of operations) {
          stats.calls = 0;
          stats.bytes = 0;
          stats.largest = 0;
          expect(await read()).toStrictEqual(expected);
          observations.push({ operation, ...stats });
        }
      } finally {
        instrumentation.mockRestore();
      }
      const fileSize = (await stat(filePath)).size;
      await writeFile(
        join(directory, 'read-stats.json'),
        JSON.stringify(
          { count, fileSize, budget: METADATA_READ_BUDGET, observations },
          null,
          2,
        ),
      );
      expect(fileSize).toBeGreaterThan(8 * 1024 * 1024);
      expect(observations).toHaveLength(5);
      for (const observation of observations) {
        expect(observation.calls).toBeGreaterThan(0);
        expect(observation.bytes).toBeGreaterThan(0);
        expect(observation.bytes).toBeLessThan(METADATA_READ_BUDGET);
        expect(observation.largest).toBeLessThanOrEqual(64 * 1024);
      }
    });
  }
});
