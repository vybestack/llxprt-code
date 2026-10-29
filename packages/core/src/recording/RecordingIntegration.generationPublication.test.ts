/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Generated exchange publication is atomic across live history and native
 * recordings. Disposal joins an accepted publication and cancellation restores
 * both views before the recorder is released.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { HistoryService } from '../services/history/HistoryService.js';
import { type IContent } from '../services/history/IContent.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { recordedRows } from './__tests__/support/native-integration-fixture.js';
import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';

function text(speaker: 'human' | 'ai', value: string): IContent {
  return { speaker, blocks: [{ type: 'text', text: value }] };
}

function textHistory(history: readonly IContent[]): object[] {
  return history.map(({ speaker, blocks }) => ({ speaker, blocks }));
}

const seed: IContent[] = [text('human', 'seed-human'), text('ai', 'seed-ai')];

function gate(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe('RecordingIntegration generated exchange publication', () => {
  let tempDir: string;
  let history: HistoryService;
  let recording: JournalRecordingService;
  let integration: RecordingIntegration;

  async function readJournal(): Promise<string> {
    await recording.flush();
    await history.waitForCommit();
    return JSON.stringify(await recordedRows(recording));
  }

  function publishExchange(
    marker: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<void> {
    return history.addBatch(
      [text('human', marker), text('ai', `${marker} reply`)],
      'written-model',
      {
        afterPublication: () => signal.throwIfAborted(),
      },
    );
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-generation-'));
    history = new HistoryService();
    recording = JournalRecordingService.create({
      sessionId: 'recording-generation-0001',
      projectHash: 'project-hash-recording-generation',
      chatsDir: tempDir,
      workspaceDirs: ['/workspace/project-a'],
      provider: 'anthropic',
      model: 'claude-4',
    });
    integration = new RecordingIntegration(recording);
    await integration.subscribeToJournal(history, {});
    // Content added before the batch materializes the journal.
    for (const content of seed) history.add(structuredClone(content));
  });

  afterEach(async () => {
    try {
      await integration.dispose();
    } finally {
      await history.dispose();
      await recording.dispose();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('propagates a failing history batch participant without a partial exchange in history or journal and stays usable', async () => {
    const failure = new Error('history publication rejected');
    const reject = (): never => {
      throw failure;
    };
    history.on('contentBatchAdded', reject);
    try {
      await expect(publishExchange('must roll back')).rejects.toBe(failure);
      await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
        expect(textHistory(rows)).toStrictEqual(seed);
      });
      expect(await readJournal()).not.toContain('must roll back');
    } finally {
      history.off('contentBatchAdded', reject);
    }

    await publishExchange('owner still usable');
    await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
      expect(textHistory(rows).slice(seed.length)).toStrictEqual([
        text('human', 'owner still usable'),
        text('ai', 'owner still usable reply'),
      ]);
    });
    expect(await readJournal()).toContain('owner still usable reply');
  });

  it('joins a held history batch participant in integration disposal before the recording is released and rolls back a cancelled exchange', async () => {
    const entered = gate();
    const held = gate();
    let consumption: Promise<void> = Promise.resolve();
    const hold = (
      batch: import('../services/history/history-batch-values.js').HistoryBatchEvent,
    ): void => {
      const rows = batch.rows();
      consumption = (async () => {
        try {
          await rows.next();
          entered.release();
          await held.promise;
        } finally {
          await rows.return();
        }
      })();
    };
    history.on('contentBatchAdded', hold);
    const cancellation = new AbortController();
    try {
      const outcome = publishExchange(
        'cancelled publication',
        cancellation.signal,
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
      await entered.promise;

      cancellation.abort();
      const disposing = integration.dispose().then(() => 'disposed');
      expect(await Promise.race([disposing, Promise.resolve('held')])).toBe(
        'held',
      );
      expect(recording.isActive()).toBe(true);

      held.release();
      expect(await outcome).toMatchObject({ name: 'AbortError' });
      expect(await disposing).toBe('disposed');
      await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
        expect(textHistory(rows)).toStrictEqual(seed);
      });
      expect(await readJournal()).not.toContain('cancelled publication');
    } finally {
      held.release();
      await consumption;
      history.off('contentBatchAdded', hold);
    }
  });
});
