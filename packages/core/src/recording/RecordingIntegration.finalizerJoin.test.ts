/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { HistoryService } from '../services/history/HistoryService.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { JournalRecordingService } from './journalRecordingService.js';
import {
  nativeText,
  recordedRows,
} from './__tests__/support/native-integration-fixture.js';

function gate(): { promise: Promise<void>; release(): void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('RecordingIntegration finalizer join', () => {
  let directory: string;
  let history: HistoryService;
  let recording: JournalRecordingService;
  let integration: RecordingIntegration;
  let intercept: () => Promise<void>;
  let releaseWrite: () => void;

  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), 'recording-finalizer-'));
    intercept = async () => {};
    releaseWrite = () => {};
    recording = JournalRecordingService.create({
      sessionId: 'recording-finalizer-session-0001',
      projectHash: 'project-hash-recording-finalizer',
      chatsDir: directory,
      workspaceDirs: ['/workspace/project-a'],
      provider: 'anthropic',
      model: 'claude-4',
      journal: {
        journal: {
          open: async (path, flags) => {
            const file = await fs.open(path, flags);
            return {
              fd: file.fd,
              read: (buffer, offset, length, position) =>
                file.read(buffer, offset, length, position),
              write: async (buffer, offset, length, position) => {
                await intercept();
                return file.write(buffer, offset, length, position);
              },
              writev: async (buffers, position) => {
                await intercept();
                return file.writev(buffers, position);
              },
              stat: () => file.stat(),
              truncate: (length) => file.truncate(length),
              close: () => file.close(),
            };
          },
        },
      },
    });
    integration = new RecordingIntegration(recording);
    history = new HistoryService();
    history.add(nativeText('baseline'));
    await history.waitForCommit();
    await integration.subscribeToJournal(history);
    await integration.flushAtTurnBoundary();
  });

  afterEach(async () => {
    releaseWrite();
    await integration.dispose();
    await history.dispose();
    await recording.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  });

  for (const failWrite of [false, true]) {
    it(`joins accepted journal I/O${failWrite ? ' and retains its original failure' : ''}, then ignores later additions`, async () => {
      const entered = gate();
      const release = gate();
      releaseWrite = release.release;
      const failure = new Error('Accepted recording journal write failed');
      let disposed = false;
      let lateWrites = 0;
      intercept = async () => {
        if (disposed) lateWrites++;
        entered.release();
        await release.promise;
        if (failWrite) throw failure;
      };
      history.add(nativeText('accepted-history-before-finalizer'));
      await entered.promise;
      let settled = false;
      const terminal = integration.dispose();
      expect(integration.dispose()).toBe(terminal);
      const disposal = terminal.then(
        () => {
          settled = true;
          return undefined;
        },
        (error: unknown) => {
          settled = true;
          return error;
        },
      );
      await setImmediate();
      expect(settled).toBe(false);
      release.release();
      const result = await disposal;
      expect(result).toBe(failWrite ? failure : undefined);
      await expect(integration.dispose()).resolves.toBeUndefined();
      const expectedRows = [
        nativeText('baseline'),
        ...(failWrite ? [] : [nativeText('accepted-history-before-finalizer')]),
      ];
      expect(await recordedRows(recording)).toStrictEqual(expectedRows);
      disposed = true;
      history.add(nativeText('late-history-after-integration-disposal'));
      await history.waitForCommit();
      expect(await recordedRows(recording)).toStrictEqual(expectedRows);
      expect(lateWrites).toBe(0);
      expect(
        (await fs.readdir(directory)).some((entry) => entry.endsWith('.tmp')),
      ).toBe(false);
    });
  }
});
