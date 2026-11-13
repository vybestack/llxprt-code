/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { RecordingBatchCompletions } from './recording-batch-completion.js';

describe('recording batch completions', () => {
  it('resolves a waiter registered after its batch completed', async () => {
    const completions = new RecordingBatchCompletions();
    const records = [{}, {}];

    completions.complete(records);

    await expect(completions.waitFor(records)).resolves.toBeUndefined();
  });

  it('resolves a waiter when its batch completes later', async () => {
    const completions = new RecordingBatchCompletions();
    const records = [{}, {}];
    const waiting = completions.waitFor(records);

    completions.complete(records);

    await expect(waiting).resolves.toBeUndefined();
  });

  it('rejects a pending waiter when recording fails', async () => {
    const completions = new RecordingBatchCompletions();
    const waiting = completions.waitFor([{}]);

    completions.fail(new Error('disk full'));

    await expect(waiting).rejects.toThrow('disk full');
  });
});
