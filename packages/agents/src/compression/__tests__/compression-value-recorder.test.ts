/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  compressionValueDigest,
  StreamingSummaryTransport,
} from './compression-value-fixture.js';
import { middleoutSetup } from './middleout-disk-helpers.js';
import { withCompressionValueRecorder } from './support/compression-value-recorder-fixture.js';

describe('production compression value recorder admissions', () => {
  it.each([65])(
    'charges complete rows before actual %i-row publication acknowledgment and releases them only when its blocked writer commits',
    async (size) => {
      await withCompressionValueRecorder(
        size,
        async ({ history, recorder, owners, arm, ready, release, durable }) => {
          const { handler } = middleoutSetup(
            history,
            new StreamingSummaryTransport(),
          );
          history.setCacheAnchorSeq(1);
          arm(() => owners.snapshot().liveRows > 0);
          const operation = handler.performCompression('blocked-value-writer');
          await Promise.race([
            ready.promise,
            operation.then(() => {
              throw new Error('No blocked content write');
            }),
          ]);
          try {
            const preAck = owners.snapshot();
            expect(history.compressionLocked).toBe(true);
            expect(history.getCacheAnchorSeq()).toBe(1);
            expect(preAck.liveRows).toBeGreaterThan(0);
            expect(preAck.liveSerializedBytes).toBeGreaterThan(2048);
            expect(preAck.peakRows).toBeLessThanOrEqual(440);
            expect(preAck.peakSerializedBytes).toBeLessThanOrEqual(
              8 * 1024 * 1024,
            );
          } finally {
            release();
          }
          expect(await operation).toBe(PerformCompressionResult.COMPRESSED);
          await recorder.flush();
          expect(await durable()).toStrictEqual(
            await compressionValueDigest(history.streamRawHistory()),
          );
          expect(owners.snapshot().liveRows).toBe(0);
          expect(history.compressionLocked).toBe(false);
        },
        (index) => suffixRow(index, 32 * 1024),
      );
    },
    180_000,
  );
});

describe('production compression value recorder compensation', () => {
  it.each([65])(
    'restores durable %i-row values after partial admission failure and retries without old publication',
    async (size) => {
      await withCompressionValueRecorder(
        size,
        async ({
          history,
          recorder,
          owners,
          failAdmissionAfter,
          failure,
          durable,
        }) => {
          async function* originalRows(): AsyncGenerator<
            ReturnType<typeof suffixRow>,
            void,
            unknown
          > {
            for (let index = 0; index < size; index++)
              yield suffixRow(index, 2048);
          }
          const baseline = await compressionValueDigest(originalRows());
          const { handler } = middleoutSetup(
            history,
            new StreamingSummaryTransport(),
          );
          history.setCacheAnchorSeq(1);
          failAdmissionAfter(2);
          const failed = handler
            .performCompression('value-admission-fault')
            .then(
              () => undefined,
              (error: unknown) => error,
            );
          expect(await failed).toBe(failure);
          await recorder.flush();
          expect(await durable()).toStrictEqual(baseline);
          expect(history.getCacheAnchorSeq()).toBe(1);
          expect(history.compressionLocked).toBe(false);
          expect(owners.snapshot().liveRows).toBe(0);
          expect(
            await handler.performCompression('value-admission-retry'),
          ).toBe(PerformCompressionResult.COMPRESSED);
          await recorder.flush();
          expect(await durable()).toStrictEqual(
            await compressionValueDigest(history.streamRawHistory()),
          );
          expect(
            owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
        },
      );
    },
    180_000,
  );
});
