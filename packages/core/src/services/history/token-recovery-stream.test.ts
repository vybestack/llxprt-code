/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { atomicRig, atomicRow } from './__tests__/support/service-atomicity.js';
import { exactTokenizer } from './chronology-rollback-test-helpers.js';

describe('sealed token recovery', () => {
  it('restores token accounting after rejected clear without streaming hydrated rows', async () => {
    const history = new HistoryService();
    try {
      const retained = [atomicRow('A'), atomicRow('B')];
      await history.addBatch(retained);
      const before = await history.estimateTokensForContents(retained);
      const failure = new Error('clear observer failed');
      const trap = spyOn(
        history.detachedValues.host().journal,
        'streamRows',
      ).mockImplementation(() => {
        throw new Error('count hydrated rows');
      });
      try {
        history.once('tokensUpdated', () => {
          throw failure;
        });
        await expect(history.clear()).rejects.toBe(failure);
        expect(history.length()).toBe(2);
        expect(history.getTotalTokens()).toBe(before);
      } finally {
        trap.mockRestore();
      }
    } finally {
      await history.dispose();
    }
  });

  it('counts the acknowledged replacement after failed compensation without hydrated rows', async () => {
    const rig = await atomicRig('token-recovery-stream');
    const { history, primary } = rig;
    try {
      history.setTokenizerFactory(exactTokenizer());
      await history.addBatch([atomicRow('A'), atomicRow('B')]);
      await rig.flush();
      const expected = await history.estimateTokensForContents([
        atomicRow('C'),
      ]);
      const failure = new Error('replacement observer failed');
      const trap = spyOn(
        history.detachedValues.host().journal,
        'streamRows',
      ).mockImplementation(() => {
        throw new Error('count hydrated rows');
      });
      try {
        history.once('tokensUpdated', () => {
          primary.failures.failFlushAt = primary.seams.events.filter(
            (event) => event.type === 'flush',
          ).length;
          throw failure;
        });
        const result: unknown = await history
          .replaceAll([atomicRow('C')])
          .catch((error: unknown) => error);
        expect(result).toBeInstanceOf(AggregateError);
        if (!(result instanceof AggregateError))
          throw new Error('Expected compensation failure');
        expect(result.errors).toHaveLength(2);
        expect(result.errors[0]).toBe(failure);
        expect(history.getTotalTokens()).toBe(expected);
      } finally {
        trap.mockRestore();
      }
    } finally {
      await expect(rig.close()).rejects.toThrow('injected flush failure');
    }
  });
});
