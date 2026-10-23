/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordingService } from './SessionRecordingService.js';
import type { IContent } from '../services/history/IContent.js';

function gate(): { promise: Promise<void>; release(): void } {
  let release = (): void => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
function content(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

describe('accepted recording batch completion', () => {
  let directory: string;
  let recording: SessionRecordingService;
  beforeEach(async () => {
    directory = await fs.mkdtemp(join(tmpdir(), 'recording-batch-completion-'));
    recording = new SessionRecordingService({
      sessionId: crypto.randomUUID(),
      projectHash: 'completion-project',
      chatsDir: directory,
      workspaceDirs: [directory],
      provider: 'fake',
      model: 'fake-model',
    });
    recording.recordContent(content('seed'));
    await recording.flush();
  });
  afterEach(async () => {
    try {
      await recording.dispose();
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('joins its accepted append without waiting for a later unrelated append', async () => {
    const path = recording.getFilePath();
    if (path === null) throw new Error('Missing recording path');
    const firstEntered = gate();
    const firstHeld = gate();
    const tailEntered = gate();
    const tailHeld = gate();
    const append = fs.appendFile;
    const boundary = spyOn(fs, 'appendFile').mockImplementation(
      async (...args) => {
        if (String(args[1]).includes('accepted-prefix')) {
          firstEntered.release();
          await firstHeld.promise;
        }
        if (String(args[1]).includes('unrelated-tail')) {
          tailEntered.release();
          await tailHeld.promise;
        }
        return append(...args);
      },
    );
    const batch = recording.prepareContentBatch(
      [content('accepted-prefix')],
      'appended',
    );
    batch.publish();
    const completion = Promise.resolve(batch.finalize());
    try {
      await firstEntered.promise;
      const before = await Promise.race([
        completion.then(() => 'completed'),
        fs.readFile(path, 'utf8').then(() => 'held'),
      ]);
      expect(before).toBe('held');
      recording.recordContent(content('unrelated-tail'));
      firstHeld.release();
      await tailEntered.promise;
      const after = await Promise.race([
        completion.then(() => 'completed'),
        fs.readFile(path, 'utf8').then(() => 'tail-held'),
      ]);
      expect(after).toBe('completed');
      const transcript = await fs.readFile(path, 'utf8');
      expect(transcript).toContain('accepted-prefix');
      expect(transcript).not.toContain('unrelated-tail');
      await batch.finalize();
    } finally {
      firstHeld.release();
      tailHeld.release();
      try {
        await recording.flush();
      } finally {
        boundary.mockRestore();
      }
    }
    expect(await fs.readFile(path, 'utf8')).toContain('unrelated-tail');
  });

  it('rejects accepted append completion with the original I/O failure and retains independent drain reporting', async () => {
    const failure = new Error('accepted append rejected');
    const boundary = spyOn(fs, 'appendFile').mockImplementationOnce(
      async () => {
        throw failure;
      },
    );
    const batch = recording.prepareContentBatch(
      [content('failed-exchange')],
      'appended',
    );
    batch.publish();
    try {
      await expect(Promise.resolve(batch.finalize())).rejects.toBe(failure);
      await expect(recording.flush()).rejects.toBe(failure);
      const path = recording.getFilePath();
      if (path === null) throw new Error('Missing recording path');
      expect(await fs.readFile(path, 'utf8')).not.toContain('failed-exchange');
    } finally {
      boundary.mockRestore();
    }
  });

  it('settles empty batches and repeated completion without introducing a write', async () => {
    const path = recording.getFilePath();
    if (path === null) throw new Error('Missing recording path');
    const batch = recording.prepareContentBatch([], 'appended');
    batch.publish();
    await batch.finalize();
    await batch.finalize();
    expect(
      (await fs.readFile(path, 'utf8')).trim().split(String.fromCharCode(10)),
    ).toHaveLength(2);
  });
});
