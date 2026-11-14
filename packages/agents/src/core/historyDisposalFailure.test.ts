/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { failureAfterDisposal } from './historyDisposalFailure.js';

describe('failureAfterDisposal', () => {
  it('returns the original failure when the disposal succeeds', async () => {
    const failure = new Error('admission failed');
    let disposed = false;

    const result = await failureAfterDisposal(
      {
        dispose: async () => {
          disposed = true;
        },
      },
      failure,
    );

    expect(disposed).toBe(true);
    expect(result).toBe(failure);
  });

  it('returns both errors when the disposal also fails', async () => {
    const failure = new Error('admission failed');
    const disposalFailure = new Error('scratch removal failed');

    const result = await failureAfterDisposal(
      {
        dispose: () => Promise.reject(disposalFailure),
      },
      failure,
    );

    expect(result).toBeInstanceOf(AggregateError);
    expect((result as AggregateError).errors).toStrictEqual([
      failure,
      disposalFailure,
    ]);
  });
});
