/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';
import {
  expectedRange,
  withRollbackFixture,
} from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { buildCompressionSystemInstruction } from '../compressionSystemPrompt.js';
import { oneshotRow, oneshotSetup } from './oneshot-disk-helpers.js';
import { collectRows } from './truncation-stream-helpers.js';

const { gcAndSweep }: { gcAndSweep: () => void } = createRequire(
  import.meta.url,
)('bun:jsc');

async function rollback(size: number): Promise<number> {
  await buildCompressionSystemInstruction('test-model', {
    provider: 'summary-transport',
    interactionMode: 'non-interactive',
  });
  return withRollbackFixture(async (history, recorder) => {
    const { handler, transport } = oneshotSetup(history, undefined, undefined, {
      contextLimit: 100,
      compressionThreshold: 0.5,
    });
    transport.empty = true;
    const makeRow = (index: number): IContent => {
      const row = oneshotRow(index, 64);
      return row.blocks.length === 0
        ? {
            ...row,
            blocks: [{ type: 'text', text: `fallback-source-${index}` }],
          }
        : row;
    };
    const callers = Array.from({ length: size }, (_, index) => makeRow(index));
    const markers = callers.map((row) => row.metadata?.chronology);
    for (const row of callers) history.add(row);
    await history.waitForTokenUpdates();
    await recorder.flush();
    history.setCacheAnchorSeq(1);
    history.syncTotalTokens(size);
    await history.waitForTokenUpdates();
    history.once('tokensUpdated', () => {
      throw new Error('injected journal publication failure');
    });
    expect(await handler.performCompression('fallback-fault')).toBe(
      PerformCompressionResult.FAILED,
    );
    expect(await collectRows(history)).toStrictEqual(
      Array.from({ length: size }, (_, index) => makeRow(index)),
    );
    expect(history.getContextRange()).toStrictEqual(expectedRange(size));
    expect(history.getCacheAnchorSeq()).toBe(1);
    expect(handler.wasRecentlyCompressed()).toBe(false);
    gcAndSweep();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(
      callers.every(
        (row, index) => row.metadata?.chronology === markers[index],
      ),
    ).toBe(true);
    expect(await handler.performCompression('fallback-retry')).toBe(
      PerformCompressionResult.COMPRESSED,
    );
    expect(history.getCacheAnchorSeq()).toBe(0);
    expect(handler.wasRecentlyCompressed()).toBe(true);
    expect(JSON.parse(transport.requests[0])).toStrictEqual(
      JSON.parse(transport.requests[1]),
    );
    return transport.requests.length;
  });
}
describe('one-shot disk eligible fallback compensation', () => {
  it.each([512, 8192])(
    'restores %i rows and caller marker identity after fallback publication rejection before successful retry',
    async (size) => {
      expect(await rollback(size)).toBe(2);
    },
    180_000,
  );
});
