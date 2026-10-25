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
 * after disposal never reaches the retired recording.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
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

interface ControlledSave {
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

/** Holds every save until the test settles it. */
class ControlledPersistenceService extends SessionPersistenceService {
  readonly saves: ControlledSave[] = [];

  override save(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.saves.push({ resolve, reject });
    });
  }
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
  let persistence: ControlledPersistenceService;
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
    persistence = new ControlledPersistenceService(
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

      history.add(humanText('accepted-history-before-finalizer'));
      expect(persistence.saves).toHaveLength(1);

      const failure = new Error('Accepted recording persistence save failed');
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

      if (failWrite) persistence.saves[0].reject(failure);
      else persistence.saves[0].resolve();
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

      history.add(humanText('late-history-after-integration-disposal'));
      await setImmediate();
      expect(await readJournal()).toBe(transcript);
      expect(persistence.saves).toHaveLength(1);
      expect(listenerCounts(history)).toStrictEqual(baseline);
    });
  }
});
