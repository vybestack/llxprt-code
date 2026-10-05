/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { accountingTexts } from '@vybestack/llxprt-code-core/services/history/token-accounting-stream-test-helpers.js';
import {
  expectedHistoryDigest,
  sendHistoryTurn,
} from './orchestrator-history-test-helpers.js';
import {
  historyDigest,
  recordReinitializeOwners,
  reinitializeBounds,
  reinitializeConfig,
  withReinitializeHistory,
} from './reinitialize-history-test-helpers.js';

function expectedTokens(size: number): number {
  let total = 0;
  for (let index = 0; index < size; index++)
    for (const text of accountingTexts(index)) total += text.length;
  return total;
}

function registerTransfer(size: number): void {
  describe('registerTransfer', () => {
    it('transfers the invoked raw caller to disk, pins a paused consumer, and sends after startup', async () => {
      await withReinitializeHistory(
        size,
        async (client, _source, owners, config) => {
          const counters = createRowCounters();
          await client.initialize(reinitializeConfig(config), {
            ownership: owners,
            counters: { ...counters.counters, ownership: owners },
          });
          expect(client.hasChatInitialized()).toBe(false);
          expect(owners.snapshot().liveRows).toBe(0);
          expect(owners.within(reinitializeBounds)).toBe(true);
          const service = client.getHistoryService();
          if (service === null) throw new Error('Missing deferred journal');
          const admittedTokenCount =
            service.getTotalTokens() - service.getBaseTokenOffset();
          const stream = client.streamHistory();
          const first = await stream.next();
          if (first.done === true)
            throw new Error('Missing transferred history');
          owners.retain(first.value);
          try {
            const paused = counters.snapshot();
            await Promise.resolve();
            expect(counters.snapshot().rowsDecoded).toBe(paused.rowsDecoded);
            await client.startChat([]);
            expect(owners.snapshot().liveRows).toBe(1);
            recordReinitializeOwners(size, 'paused-output', owners);
          } finally {
            await stream.return();
            owners.release(first.value);
          }
          expect(await historyDigest(client.streamHistory())).toStrictEqual({
            count: size,
            digest: expectedHistoryDigest(size),
          });
          expect({
            admitted: admittedTokenCount,
            started: service.getTotalTokens() - service.getBaseTokenOffset(),
          }).toStrictEqual({
            admitted: expectedTokens(size),
            started: expectedTokens(size),
          });
          expect(await sendHistoryTurn(client)).toBe('a plain text reply');
          expect((await historyDigest(client.streamHistory())).count).toBe(
            size + 2,
          );
          expect(owners.snapshot().liveRows).toBe(0);
          expect(owners.within(reinitializeBounds)).toBe(true);
          recordReinitializeOwners(size, 'settled', owners);
        },
      );
    }, 180000);
  });
}

function registerSourceFailure(size: number): void {
  describe('registerSourceFailure', () => {
    it('does not advance a paused source and preserves active membership on source failure', async () => {
      await withReinitializeHistory(
        size,
        async (client, source, owners, config) => {
          source.pauseAfter = 31;
          const fault = new Error('active disk source failed');
          source.fault = fault;
          const operation = client.initialize(reinitializeConfig(config));
          const result = operation.then(
            () => undefined,
            (error: unknown) => error,
          );
          await Promise.race([
            source.paused.promise,
            result.then(() => {
              throw new Error('Transfer ended before pause');
            }),
          ]);
          try {
            expect(source.scanned).toBe(31);
            expect(owners.snapshot().liveRows).toBe(1);
            expect(owners.within(reinitializeBounds)).toBe(true);
            await Promise.resolve();
            expect(source.scanned).toBe(31);
            expect(client.hasChatInitialized()).toBe(true);
            recordReinitializeOwners(size, 'paused-source', owners);
          } finally {
            source.release.resolve();
          }
          expect(await result).toBe(fault);
          expect(client.hasChatInitialized()).toBe(true);
          expect(await historyDigest(client.streamHistory())).toStrictEqual({
            count: size,
            digest: expectedHistoryDigest(size),
          });
          expect(owners.snapshot().liveRows).toBe(0);
        },
      );
    }, 180000);
  });
}

function registerCancellation(size: number): void {
  describe('registerCancellation', () => {
    it('propagates cancellation without replacing the active chat', async () => {
      await withReinitializeHistory(
        size,
        async (client, source, owners, config) => {
          const abort = new AbortController();
          source.pauseAfter = 31;
          const operation = client.initialize(reinitializeConfig(config), {
            signal: abort.signal,
            ownership: owners,
          });
          const result = operation.then(
            () => undefined,
            (error: unknown) => error,
          );
          await Promise.race([
            source.paused.promise,
            result.then(() => {
              throw new Error('Transfer ended before pause');
            }),
          ]);
          const fault = new Error('active transfer cancelled');
          abort.abort(fault);
          source.release.resolve();
          expect(await result).toBe(fault);
          expect(client.hasChatInitialized()).toBe(true);
          expect(await historyDigest(client.streamHistory())).toStrictEqual({
            count: size,
            digest: expectedHistoryDigest(size),
          });
          expect(owners.snapshot().liveRows).toBe(0);
        },
      );
    }, 180000);
  });
}

function registerControls(size: number): void {
  describe('registerControls', () => {
    for (const retaining of ['borrowed', 'copy'] as const) {
      it(`charges ${retaining} consumer identities instead of excusing retention`, async () => {
        await withReinitializeHistory(
          size,
          async (client, source, _owners, config) => {
            source.retaining = retaining;
            await client.initialize(reinitializeConfig(config));
            expect(source.consumer.snapshot().liveRows).toBe(size);
            recordReinitializeOwners(size, retaining, source.consumer);
            expect(source.consumer.within(reinitializeBounds)).toBe(
              process.env.REINITIALIZE_HISTORY_RETAINING_TRAP === '1',
            );
            source.releaseConsumer();
            expect(source.consumer.snapshot().liveRows).toBe(0);
          },
        );
      }, 180000);
    }
  });
}

for (const size of [512, 8192]) {
  describe(`active history reinitialization at ${size}`, () => {
    registerTransfer(size);
    registerSourceFailure(size);
    registerCancellation(size);
    registerControls(size);
  });
}

describe('large active journal row', () => {
  it('preserves a valid nine-MiB row without a byte admission cap', async () => {
    await withReinitializeHistory(
      1,
      async (client, _source, _reader, config) => {
        const owners = new RowOwnership();
        await client.initialize(reinitializeConfig(config), {
          ownership: owners,
        });
        await client.startChat([]);
        expect(await historyDigest(client.streamHistory())).toStrictEqual({
          count: 1,
          digest: expectedHistoryDigest(1, 9 * 1024 * 1024),
        });
        expect(owners.snapshot().liveRows).toBe(0);
        expect(owners.snapshot().peakSerializedBytes).toBeGreaterThan(
          8 * 1024 * 1024,
        );
      },
      9 * 1024 * 1024,
    );
  }, 180000);
});
