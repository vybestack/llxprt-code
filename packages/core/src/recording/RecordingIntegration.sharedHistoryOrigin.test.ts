/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { recordedRows } from './__tests__/support/native-integration-fixture.js';

/**
 * Domain-level batch publication behavior of two RecordingIntegration
 * subscribers over one HistoryService the test builds: a rejected
 * `afterPublication` rolls back the prepared recording effect of every
 * subscriber the batch reaches, an unbound batch (no origin) reaches both
 * subscribers, and an owned batch reaches only its owner.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { HistoryService } from '../services/history/HistoryService.js';
import { type IContent } from '../services/history/IContent.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { JournalRecordingService } from './journalRecordingService.js';

interface Subscriber {
  readonly owner: object;
  readonly recording: JournalRecordingService;
  readonly integration: RecordingIntegration;
}

function humanText(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

describe('RecordingIntegration shared history batch origin', () => {
  let tempDir: string;
  let history: HistoryService;
  let first: Subscriber;
  let second: Subscriber;

  async function openSubscriber(name: string): Promise<Subscriber> {
    const chatsDir = path.join(tempDir, name);
    await fs.mkdir(chatsDir, { recursive: true });
    const recording = JournalRecordingService.create({
      sessionId: `recording-origin-${name}-0001`,
      projectHash: 'project-hash-recording-origin',
      chatsDir,
      workspaceDirs: ['/workspace/project-a'],
      provider: 'anthropic',
      model: 'claude-4',
    });
    const integration = new RecordingIntegration(recording);
    const owner = {};
    await integration.subscribeToJournal(history, owner);
    return { owner, recording, integration };
  }

  async function readJournal(subscriber: Subscriber): Promise<string> {
    await subscriber.recording.flush();
    await history.waitForCommit();
    return JSON.stringify(await recordedRows(subscriber.recording));
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-origin-'));
    history = new HistoryService();
    first = await openSubscriber('first');
    second = await openSubscriber('second');
    // Content added with no origin reaches both subscribers and materializes
    // both journals.
    history.add(humanText('seed'));
  });

  afterEach(async () => {
    try {
      await Promise.all(
        [first, second].map((subscriber) => subscriber.integration.dispose()),
      );
    } finally {
      await history.dispose();
      await Promise.all(
        [first, second].map((subscriber) => subscriber.recording.dispose()),
      );
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rolls back both prepared recording effects when afterPublication rejects an unbound or owned batch', async () => {
    await expect(
      history.addBatch([humanText('rolled-back-marker')], undefined, {
        afterPublication: () => {
          throw new Error('reject publication');
        },
      }),
    ).rejects.toThrow('reject publication');
    await expect(
      history.addBatch([humanText('owned-rollback-marker')], undefined, {
        origin: first.owner,
        afterPublication: () => {
          throw new Error('reject owned publication');
        },
      }),
    ).rejects.toThrow('reject owned publication');

    for (const subscriber of [first, second]) {
      const journal = await readJournal(subscriber);
      expect(journal).toContain('seed');
      expect(journal).not.toContain('rolled-back-marker');
      expect(journal).not.toContain('owned-rollback-marker');
    }
  });

  it('delivers an unbound batch, which has no origin, to both subscribers', async () => {
    await history.addBatch([humanText('unbound-batch-marker')]);

    expect(await readJournal(first)).toContain('unbound-batch-marker');
    expect(await readJournal(second)).toContain('unbound-batch-marker');
  });

  it('delivers an owned batch only to its owner', async () => {
    await history.addBatch([humanText('owned-batch-marker')], undefined, {
      origin: first.owner,
    });

    expect(await readJournal(first)).toContain('owned-batch-marker');
    expect(await readJournal(second)).not.toContain('owned-batch-marker');
  });
});
