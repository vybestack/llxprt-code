/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Domain-level disposal behavior of RecordingIntegration over a HistoryService
 * the test builds: the recording subscribers are retired when disposal starts
 * (before accepted persistence settles), disposal joins the accepted
 * persistence and keeps its original failure, and a producer that still adds
 * after disposal never reaches the retired recording. The persistence write is
 * held or rejected at the filesystem boundary (the rename that publishes the
 * session file), so the real persistence service runs.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { Storage } from '@vybestack/llxprt-code-settings';

import { HistoryService } from '../services/history/HistoryService.js';
import { type IContent } from '../services/history/IContent.js';
import { SessionPersistenceService } from '../storage/SessionPersistenceService.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { SessionRecordingService } from './SessionRecordingService.js';

const recordingEvents = [
  'contentAdded',
  'compressionStarted',
  'compressionLockReleased',
  'compressionEnded',
];

interface Gate {
  readonly promise: Promise<void>;
  readonly release: () => void;
}

function gate(): Gate {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function humanText(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function listenerCounts(history: HistoryService): number[] {
  return recordingEvents.map((event) => history.listenerCount(event));
}

describe('RecordingIntegration finalizer join', () => {
  let tempDir: string;
  let recordingService: SessionRecordingService;
  let persistence: SessionPersistenceService;
  let integration: RecordingIntegration;
  let expectedDisposalFailure: unknown;

  beforeEach(async () => {
    expectedDisposalFailure = undefined;
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-finalizer-'));
    const chatsDir = path.join(tempDir, 'chats');
    await fs.mkdir(chatsDir, { recursive: true });
    const storage = new Storage(tempDir);
    recordingService = new SessionRecordingService({
      sessionId: 'recording-finalizer-session-0001',
      projectHash: 'project-hash-recording-finalizer',
      chatsDir,
      workspaceDirs: ['/workspace/project-a'],
      provider: 'anthropic',
      model: 'claude-4',
    });
    persistence = new SessionPersistenceService(
      {
        projectRoot: storage.getProjectRoot(),
        chatsDir: storage.getProjectChatsDir(),
      },
      'recording-finalizer-session-0001',
    );
    integration = new RecordingIntegration(recordingService, persistence);
  });

  afterEach(async () => {
    try {
      await integration.dispose();
    } catch (error: unknown) {
      if (error !== expectedDisposalFailure) throw error;
    } finally {
      await recordingService.dispose();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  async function readJournal(): Promise<string> {
    await recordingService.flush();
    const journal = recordingService.getFilePath();
    if (journal === null) throw new Error('Recording journal missing');
    return fs.readFile(journal, 'utf8');
  }

  for (const failWrite of [false, true]) {
    it(`retires its history listeners when disposal starts, joins accepted persistence${failWrite ? ' and retains its original failure' : ''}, and ignores later additions`, async () => {
      const history = new HistoryService();
      const baseline = listenerCounts(history);
      integration.subscribeToHistory(history);
      expect(listenerCounts(history)).toStrictEqual(
        baseline.map((count) => count + 1),
      );

      const entered = gate();
      const release = gate();
      const failure = new Error('Accepted recording persistence save failed');
      const persistedPath = persistence.getSessionFilePath();
      const rename = fs.rename;
      let renames = 0;
      const boundary = spyOn(fs, 'rename').mockImplementation(
        async (from, to) => {
          if (to !== persistedPath) return rename(from, to);
          renames += 1;
          entered.release();
          await release.promise;
          if (failWrite) throw failure;
          return rename(from, to);
        },
      );
      try {
        history.add(humanText('accepted-history-before-finalizer'));
        await entered.promise;
        expect(renames).toBe(1);

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

        expect(listenerCounts(history)).toStrictEqual(baseline);
        await setImmediate();
        expect(settled).toBe(false);

        release.release();
        const result = await disposal;
        expectedDisposalFailure = result;
        expect(result === undefined).toBe(!failWrite);
        expect(result instanceof Error ? result.cause : result).toBe(
          failWrite ? failure : undefined,
        );
        const repeated = await integration.dispose().then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(repeated).toBe(result);

        const transcript = await readJournal();
        expect(transcript).toContain('accepted-history-before-finalizer');
        const persisted = await fs
          .readFile(persistedPath, 'utf8')
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return undefined;
            throw error;
          });
        expect(persisted === undefined).toBe(failWrite);
        expect(
          persisted?.includes('accepted-history-before-finalizer') ?? false,
        ).toBe(!failWrite);

        history.add(humanText('late-history-after-integration-disposal'));
        await setImmediate();
        expect(await readJournal()).toBe(transcript);
        expect(renames).toBe(1);
        expect(listenerCounts(history)).toStrictEqual(baseline);
        const lateEntries = await fs.readdir(persistence.getChatsDir());
        expect(lateEntries.some((entry) => entry.endsWith('.tmp'))).toBe(false);
      } finally {
        release.release();
        boundary.mockRestore();
      }
    });
  }
});
