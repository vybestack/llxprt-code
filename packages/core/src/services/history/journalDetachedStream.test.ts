/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from './IContent.js';
import { pulledRows } from './journalDetachedStream.js';

function row(seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `r${seq}` }],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  };
}

function seqOf(content: IContent): number {
  return content.metadata?.chronology?.seq ?? -1;
}

describe('pulledRows', () => {
  it('yields the rows a producer pushes, in order, and ends when it returns', async () => {
    const taken: number[] = [];
    for await (const content of pulledRows<IContent>(async (put) => {
      for (let seq = 1; seq <= 4; seq++) await put(row(seq));
    }))
      taken.push(seqOf(content));
    expect(taken).toStrictEqual([1, 2, 3, 4]);
  });

  it('never lets the producer start a row before the consumer has finished the one before', async () => {
    let pushed = 0;
    let finished = 0;
    const leads: number[] = [];
    const slowConsumer = pulledRows<IContent>(async (put) => {
      for (let seq = 1; seq <= 6; seq++) {
        leads.push(pushed - finished);
        pushed++;
        await put(row(seq));
      }
    });
    for await (const content of slowConsumer) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(seqOf(content)).toBe(finished + 1);
      finished++;
    }
    expect(finished).toBe(6);
    expect(Math.max(...leads)).toBe(0);
  });

  it('throws the failure of the producer after the rows it had handed over', async () => {
    const boom = new Error('producer failed');
    const taken: number[] = [];
    const run = async (): Promise<void> => {
      for await (const content of pulledRows<IContent>(async (put) => {
        await put(row(1));
        await put(row(2));
        throw boom;
      }))
        taken.push(seqOf(content));
    };
    await expect(run()).rejects.toBe(boom);
    expect(taken).toStrictEqual([1, 2]);
  });

  it('rejects the pending push of the producer when the consumer stops early', async () => {
    let pushFailure: unknown;
    const rows = pulledRows<IContent>(async (put) => {
      try {
        await put(row(1));
        await put(row(2));
      } catch (error) {
        pushFailure = error;
        throw error;
      }
    });
    const first = await rows.next();
    expect(first.done).toBe(false);
    await rows.return(undefined);
    expect(pushFailure).toBeInstanceOf(Error);
  });
});
