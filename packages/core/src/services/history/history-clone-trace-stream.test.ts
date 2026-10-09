/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import { buildChronologyTrace } from './historyChronology.js';
import { sanitizeProviderHistoryForSerialization } from './historyCloneUtils.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { withCoreSuffixFixture } from './core-suffix-fixture-test-helpers.js';
import {
  exitMeasurement,
  mixedRow,
  queryStream,
  scratchDirectories,
  traversalMeasurement,
  type Exit,
} from './history-clone-trace-test-helpers.js';

describe('clone sanitization and independent objects', () => {
  it('preserves the eager sanitization transform, media and tool shape, and independent objects', async () => {
    const service = new HistoryService();
    try {
      const input = mixedRow();
      service.add(input);
      const raw = await Array.fromAsync(service.getRecent(0));
      const expected = sanitizeProviderHistoryForSerialization(raw);
      const cloned = await Array.fromAsync(service.clone());
      expect(cloned).toStrictEqual(expected);
      expect(cloned[0]).not.toBe(raw[0]);
      expect(cloned[0].blocks).not.toBe(raw[0].blocks);
      expect(cloned[0].metadata).not.toBe(raw[0].metadata);
      for (let index = 0; index < raw[0].blocks.length; index++) {
        expect(cloned[0].blocks[index]).not.toBe(raw[0].blocks[index]);
      }
      const call = cloned[0].blocks[1];
      const media = cloned[0].blocks[3];
      if (call.type !== 'tool_call' || media.type !== 'media')
        throw new Error('Missing tool/media shape');
      expect(call.parameters).toStrictEqual({
        first: { nested: ['input'] },
        second: { _circular: true },
      });
      expect(media.data).toBe('aGVsbG8=');
      expect(media.providerMetadata?.['observedAt']).toBe(
        '2026-09-29T00:00:00.000Z',
      );
      const first = cloned[0].blocks[0];
      if (first.type !== 'text') throw new Error('Missing text');
      first.text = 'changed clone';
      expect(await Array.fromAsync(service.clone())).toStrictEqual(expected);
      expect(input.blocks[0]).toStrictEqual({
        type: 'text',
        text: 'private text',
      });
    } finally {
      service.dispose();
    }
  });
});

describe('chronology projection parity', () => {
  it('matches the eager chronology projection without leaking private payloads', async () => {
    const service = new HistoryService();
    try {
      service.add(mixedRow());
      service.add(suffixRow(9));
      const raw = await Array.fromAsync(service.getRecent(0));
      const trace = await Array.fromAsync(service.getChronologyTrace());
      expect(trace).toStrictEqual(buildChronologyTrace(raw));
      expect(trace[0].blockTypes).toStrictEqual([
        'text',
        'tool_call',
        'tool_response',
        'media',
      ]);
      expect(trace[0].toolCallIds).toStrictEqual(['call']);
      expect(trace[0].toolResponseIds).toStrictEqual(['call']);
      expect(trace[0].replaced).toStrictEqual({
        fromSeq: 1,
        toSeq: 4,
        itemCount: 4,
      });
      expect(JSON.stringify(trace)).not.toContain('private');
    } finally {
      service.dispose();
    }
  });
});

describe('chronology marker filtering over a real journal', () => {
  it('skips unmarked rows and keeps the marked rows in journal order', async () => {
    await withCoreSuffixFixture(
      512,
      async (service, ownership) => {
        let count = 0;
        for await (const entry of service.getChronologyTrace()) {
          count++;
          expect(entry.seq).toBe(count * 2);
        }
        expect(count).toBe(256);
        expect(ownership.snapshot().liveRows).toBe(0);
      },
      0,
      (index, bytes) => {
        const content = suffixRow(index, bytes);
        return index % 2 === 0 ? { ...content, metadata: undefined } : content;
      },
    );
  });
});

for (const query of ['clone', 'trace'] as const) {
  describe(`${query} cold pinned membership`, () => {
    it('captures membership on first next and excludes later mutations', async () => {
      await withCoreSuffixFixture(0, async (service, ownership) => {
        for (let index = 0; index < 3; index++) service.add(suffixRow(index));
        const before = scratchDirectories();
        const admitted = ownership.snapshot().acquisitions;
        const unused = queryStream(service, query);
        await unused.return();
        expect(ownership.snapshot().acquisitions).toBe(admitted);
        expect(
          scratchDirectories().filter(
            (directory) => !before.includes(directory),
          ),
        ).toHaveLength(0);
        const stream = queryStream(service, query);
        service.add(suffixRow(3));
        const raw = await Array.fromAsync(service.getRecent(0));
        const expected =
          query === 'clone'
            ? sanitizeProviderHistoryForSerialization(raw)
            : buildChronologyTrace(raw);
        const first = await stream.next();
        expect(first.done).toBe(false);
        service.add(suffixRow(4));
        await service.pop();
        await service.pop();
        const tail = await Array.fromAsync(stream);
        expect([first.value, ...tail]).toStrictEqual(expected);
        const current = await Array.fromAsync(queryStream(service, query));
        expect(current).toHaveLength(3);
        expect(ownership.snapshot().liveRows).toBe(0);
      });
    });
  });

  describe(`${query} cursor lifecycle`, () => {
    const failures: Record<Exit, string | undefined> = {
      return: undefined,
      throw: 'iterator failed',
      break: undefined,
      'consumer-throw': 'consumer failed',
    };
    for (const exit of [
      'return',
      'throw',
      'break',
      'consumer-throw',
    ] as const) {
      it(`releases row owners and disk scratch after ${exit}`, async () => {
        expect(await exitMeasurement(query, exit)).toStrictEqual({
          done: false,
          heldRows: 1,
          scratchOpened: true,
          liveRows: 0,
          scratchClosed: true,
          failure: failures[exit],
        });
      });
    }
  });

  describe(`${query} bounded traversal`, () => {
    it('rejects the bounded-input owner fixture when a consumer retains every output', async () => {
      const result = await traversalMeasurement(512, query, true);
      expect(result.count).toBe(512);
      expect(result.within).toBe(false);
      expect(result.ownerPeak).toBeGreaterThan(440);
      expect(result.liveRows).toBe(0);
    });
    for (const size of [512, 8192]) {
      it(`consumes ${size} real journal rows with bounded decoded and output owners`, async () => {
        expect(await traversalMeasurement(size, query, false)).toStrictEqual({
          count: size,
          decodedPeak: 1,
          ownerPeak: 2,
          liveRows: 0,
          within: true,
          parity: true,
        });
      }, 120_000);
    }
  });
}
