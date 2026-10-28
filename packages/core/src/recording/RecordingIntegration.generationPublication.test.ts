/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Domain-level publication of a generated exchange through a HistoryService
 * with a RecordingIntegration subscriber, using the options the agent's
 * generation append passes (`recordingCompletion: 'appended'` and an
 * `afterPublication` that rethrows a cancelled signal): a failing history batch
 * participant leaves no partial exchange in history or journal, and a held
 * participant is joined by the integration's disposal before the recording is
 * released while a cancelled exchange is rolled back.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { HistoryService } from '../services/history/HistoryService.js';
import { type IContent } from '../services/history/IContent.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import { SessionRecordingService } from './SessionRecordingService.js';

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
  let recording: SessionRecordingService;
  let integration: RecordingIntegration;

  async function readJournal(): Promise<string> {
    await recording.flush();
    const journal = recording.getFilePath();
    if (journal === null) throw new Error('Recording journal missing');
    return fs.readFile(journal, 'utf8');
  }

  function publishExchange(
    marker: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<void> {
    return history.addBatch(
      [text('human', marker), text('ai', `${marker} reply`)],
      'written-model',
      {
        recordingCompletion: 'appended',
        afterPublication: () => signal.throwIfAborted(),
      },
    );
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'recording-generation-'));
    history = new HistoryService();
    recording = new SessionRecordingService({
      sessionId: 'recording-generation-0001',
      projectHash: 'project-hash-recording-generation',
      chatsDir: tempDir,
      workspaceDirs: ['/workspace/project-a'],
      provider: 'anthropic',
      model: 'claude-4',
    });
    integration = new RecordingIntegration(recording);
    integration.subscribeToHistory(history, {});
    // Content added before the batch materializes the journal.
    for (const content of seed) history.add(structuredClone(content));
  });

  afterEach(async () => {
    try {
      await integration.dispose();
    } finally {
      await recording.dispose();
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('propagates a failing history batch participant without a partial exchange in history or journal and stays usable', async () => {
    const failure = new Error('history publication rejected');
    const release = history.registerBatchParticipant(async () => {
      throw failure;
    });
    try {
      await expect(publishExchange('must roll back')).rejects.toBe(failure);
      expect(textHistory(history.getAll())).toStrictEqual(seed);
      expect(await readJournal()).not.toContain('must roll back');
    } finally {
      release();
    }

    await publishExchange('owner still usable');
    expect(textHistory(history.getAll()).slice(seed.length)).toStrictEqual([
      text('human', 'owner still usable'),
      text('ai', 'owner still usable reply'),
    ]);
    expect(await readJournal()).toContain('owner still usable reply');
  });

  it('joins a held history batch participant in integration disposal before the recording is released and rolls back a cancelled exchange', async () => {
    const entered = gate();
    const held = gate();
    const release = history.registerBatchParticipant(async () => {
      entered.release();
      await held.promise;
      return { publish: () => {}, rollback: () => {} };
    });
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
      expect(textHistory(history.getAll())).toStrictEqual(seed);
      expect(await readJournal()).not.toContain('cancelled publication');
    } finally {
      held.release();
      release();
    }
  });
});
