/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import {
  expectedHistoryDigest,
  sendHistoryTurn,
} from './orchestrator-history-test-helpers.js';
import {
  withReinitializeHistory,
  historyDigest,
  reinitializeBounds,
  recordReinitializeOwners,
} from './reinitialize-history-test-helpers.js';

function registerConfigTransfer(size: number): void {
  describe('replacement and provider send', () => {
    it('streams the real active caller through replacement, paused startup, and a provider send', async () => {
      await withReinitializeHistory(
        size,
        async (_old, _source, owners, config) => {
          const counters = createRowCounters();
          await config.initializeContentGeneratorConfig({
            ownership: owners,
            counters: { ...counters.counters, ownership: owners },
          });
          const client = config.getAgentClient();
          const stream = client.streamHistory();
          const next = await stream.next();
          if (next.done === true) throw new Error('Missing replacement row');
          owners.retain(next.value);
          try {
            const paused = counters.snapshot().rowsDecoded;
            await Promise.resolve();
            expect(counters.snapshot().rowsDecoded - paused).toBe(0);
            await client.startChat([]);
            expect(owners.snapshot().liveRows).toBe(1);
            recordReinitializeOwners(size, 'config-paused-output', owners);
          } finally {
            await stream.return();
            owners.release(next.value);
          }
          expect(await historyDigest(client.streamHistory())).toStrictEqual({
            count: size,
            digest: expectedHistoryDigest(size),
          });
          recordReinitializeOwners(size, 'config-after-digest', owners);
          expect(await sendHistoryTurn(client)).toBe('a plain text reply');
          recordReinitializeOwners(size, 'config-after-send', owners);
          expect((await historyDigest(client.streamHistory())).count).toBe(
            size + 2,
          );
          expect(owners.snapshot().liveRows).toBe(0);
          expect(owners.within(reinitializeBounds)).toBe(true);
          recordReinitializeOwners(size, 'config-settled', owners);
        },
      );
    }, 180000);
  });
}

function registerConfigFailure(size: number): void {
  for (const mode of ['fault', 'abort']) {
    describe(`replacement source ${mode}`, () => {
      it('keeps the original client and rows while the source is paused and after rejection', async () => {
        await withReinitializeHistory(
          size,
          async (old, source, owners, config) => {
            source.pauseAfter = 31;
            const fault = new Error(`config source ${mode}`);
            const abort = new AbortController();
            if (mode === 'fault') source.fault = fault;
            const result = config
              .initializeContentGeneratorConfig({
                signal: abort.signal,
                ownership: owners,
              })
              .then(
                () => undefined,
                (error: unknown) => error,
              );
            await Promise.race([
              source.paused.promise,
              result.then(() => {
                throw new Error('Config transfer ended before pause');
              }),
            ]);
            try {
              expect(config.getAgentClient()).toBe(old);
              expect(owners.snapshot().liveRows).toBe(1);
              expect(owners.within(reinitializeBounds)).toBe(true);
              expect(source.scanned).toBe(31);
              recordReinitializeOwners(size, `config-paused-${mode}`, owners);
              if (mode === 'abort') abort.abort(fault);
            } finally {
              source.release.resolve();
            }
            expect(await result).toBe(fault);
            expect(
              await historyDigest(config.getAgentClient().streamHistory()),
            ).toStrictEqual({
              count: size,
              digest: expectedHistoryDigest(size),
            });
            expect(owners.snapshot().liveRows).toBe(0);
          },
        );
      }, 180000);
    });
  }
}

for (const size of [512, 8192]) {
  describe(`invoked Config rebuild at ${size}`, () => {
    registerConfigTransfer(size);
    registerConfigFailure(size);
  });
}

describe('large Config replacement source', () => {
  it('preserves a nine-MiB row through the actual rebuild and startup', async () => {
    await withReinitializeHistory(
      1,
      async (_old, _source, owners, config) => {
        await config.initializeContentGeneratorConfig({ ownership: owners });
        const client = config.getAgentClient();
        await client.startChat([]);
        expect(await historyDigest(client.streamHistory())).toStrictEqual({
          count: 1,
          digest: expectedHistoryDigest(1, 9 * 1024 * 1024),
        });
        expect(owners.snapshot().liveRows).toBe(0);
      },
      9 * 1024 * 1024,
    );
  }, 180000);
});
