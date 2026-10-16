/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withSuffixFixture } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  withRollbackFixture,
  expectedRange,
} from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  middleoutSetup,
  middleoutRow,
  middleoutOracle,
  SummaryTransport,
  MiddleoutDiskHistory,
} from './middleout-disk-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';
import { buildCompressionSystemInstruction } from '../compressionSystemPrompt.js';

async function failures(size: number): Promise<number> {
  await buildCompressionSystemInstruction('test-model', {
    provider: 'summary-transport',
    interactionMode: 'non-interactive',
  });
  return withSuffixFixture(
    size,
    async (history) => {
      const transport = new SummaryTransport();
      const { handler } = middleoutSetup(history, transport);
      const raw = Array.from({ length: size }, (_, index) =>
        middleoutRow(index, 64),
      );
      for (const error of [
        new Error('model denied request'),
        new DOMException('cancelled summary', 'AbortError'),
      ]) {
        transport.failure = error;
        await expect(handler.performCompression('failure')).rejects.toThrow(
          error.message,
        );
        expect(await collectRows(history)).toStrictEqual(raw);
      }
      transport.failure = undefined;
      expect(await handler.performCompression('retry')).toBe(
        PerformCompressionResult.COMPRESSED,
      );
      expect(transport.requests[0]).toBe(transport.requests[2]);
      expect(handler.wasRecentlyCompressed()).toBe(true);
      return transport.requests.length;
    },
    64,
    middleoutRow,
    undefined,
    (options) => new MiddleoutDiskHistory(options),
  );
}

async function rollback(size: number): Promise<number> {
  return withRollbackFixture(async (history, recorder) => {
    const { handler, transport } = middleoutSetup(history);
    const makeRow = (index: number): IContent => {
      const row = middleoutRow(index, 64);
      return row.blocks.length === 0
        ? { ...row, blocks: [{ type: 'text', text: `empty-ai-${index}` }] }
        : row;
    };
    const callers = Array.from({ length: size }, (_, index) => makeRow(index));
    const markers = callers.map((row) => row.metadata?.chronology);
    for (const row of callers) history.add(row);
    await history.waitForTokenUpdates();
    await recorder.flush();
    history.setCacheAnchorSeq(1);
    const expected = Array.from({ length: size }, (_, index) => makeRow(index));
    recorder.failAdmissionAfter(2);
    await expect(handler.performCompression('rollback')).rejects.toThrow(
      'injected journal admission failure',
    );
    expect(await collectRows(history)).toStrictEqual(expected);
    expect(history.getContextRange()).toStrictEqual(expectedRange(size));
    expect(history.getCacheAnchorSeq()).toBe(1);
    expect(
      callers.every(
        (row, index) => row.metadata?.chronology === markers[index],
      ),
    ).toBe(true);
    const result = await handler.performCompression('retry');
    expect(result).toBe(PerformCompressionResult.COMPRESSED);
    return transport.requests.length;
  });
}

async function pinned(size: number): Promise<number> {
  return withSuffixFixture(
    size,
    async (history) => {
      const transport = new SummaryTransport();
      const { handler } = middleoutSetup(history, transport, async () => {
        throw new Error('hook fail-open');
      });
      let release: () => void = () => {};
      let entered: () => void = () => {};
      const pause = new Promise<void>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      transport.beforeSend = async () => {
        entered();
        await pause;
      };
      const attempt = handler.performCompression('pinned');
      await started;
      const queued: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'queued while summary paused' }],
      };
      history.add(queued);
      expect(transport.requests[0]).not.toContain(
        'queued while summary paused',
      );
      release();
      expect(await attempt).toBe(PerformCompressionResult.COMPRESSED);
      const rows = await collectRows(history);
      expect(rows[rows.length - 1].blocks).toStrictEqual(queued.blocks);
      expect(
        rows.filter((row) =>
          row.blocks.some(
            (block) =>
              block.type === 'text' &&
              block.text === 'queued while summary paused',
          ),
        ),
      ).toHaveLength(1);
      return rows.length;
    },
    64,
    middleoutRow,
    undefined,
    (options) => new MiddleoutDiskHistory(options),
  );
}

describe('disk middle-out summary and publication lifetimes', () => {
  it.each([512, 8192])(
    'preserves %i rows through model error and cancellation before successful retry',
    async (size) => {
      expect(await failures(size)).toBe(3);
    },
    180_000,
  );
  it.each([512, 8192])(
    'restores all %i rows, chronology and caller markers after partial admission',
    async (size) => {
      expect(await rollback(size)).toBe(2);
    },
    180_000,
  );
  it.each([512, 8192])(
    'pins %i rows during summary and flushes a queued append after hook failure',
    async (size) => {
      expect(await pinned(size)).toBeGreaterThan(0);
    },
    180_000,
  );
  it('routes a structural middle-out no-op into disk one-shot without eager preparation', async () => {
    const makeRow = (index: number): IContent => ({
      ...middleoutRow(index, 64),
      speaker: 'human',
      blocks: [{ type: 'text', text: `source-${index}` }],
    });
    await withSuffixFixture(
      6,
      async (history) => {
        const expected = await middleoutOracle(history, 6, 64, makeRow);
        const { handler, transport } = middleoutSetup(history);
        expect(await handler.performCompression('one-shot')).toBe(
          PerformCompressionResult.COMPRESSED,
        );
        const rows = await collectRows(history);
        expect(rows[0].metadata?.reason).toBe('compression-state-snapshot');
        expect(transport.requests[0]).toContain('source-0');
        expect(transport.requests).toStrictEqual(expected.requests);
        expect(history.getCacheAnchorSeq()).toBe(0);
      },
      64,
      makeRow,
      undefined,
      (options) => new MiddleoutDiskHistory(options),
    );
  });
  it('accepts a preserved nine-MiB row without truncating it', async () => {
    const huge = 'L'.repeat(9 * 1024 * 1024);
    await withSuffixFixture(
      512,
      async (history) => {
        const { handler } = middleoutSetup(history);
        expect(await handler.performCompression('huge')).toBe(
          PerformCompressionResult.COMPRESSED,
        );
        const rows = await collectRows(history);
        expect(rows[rows.length - 1].blocks).toStrictEqual([
          { type: 'text', text: huge },
        ]);
      },
      64,
      (index, bytes) =>
        index === 511
          ? {
              ...middleoutRow(index, bytes),
              speaker: 'human',
              blocks: [{ type: 'text', text: huge }],
            }
          : middleoutRow(index, bytes),
      undefined,
      (options) => new MiddleoutDiskHistory(options),
    );
  }, 180_000);
});
