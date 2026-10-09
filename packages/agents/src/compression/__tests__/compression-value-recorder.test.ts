/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { createRowCounters } from '@vybestack/llxprt-code-core/recording/journalCounters.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { AdmissionFailureRecorder } from '../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import {
  compressionValueDigest,
  compressionDurableValueDigest,
} from './compression-value-fixture.js';
import { middleoutSetup } from './middleout-disk-helpers.js';
import {
  ValueCompressionHistory,
  StreamingSummaryTransport,
  valueGate,
} from './compression-value-fixture.js';

async function withRecorder<T>(
  size: number,
  action: (
    history: ValueCompressionHistory,
    recorder: AdmissionFailureRecorder,
    owners: RowOwnership,
    arm: () => void,
    ready: ReturnType<typeof valueGate>,
    release: () => void,
  ) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'compression-value-recorder-'));
  const owners = new RowOwnership();
  const ready = valueGate();
  const gate = valueGate();
  const state = { armed: false };
  const recorder = new AdmissionFailureRecorder({
    sessionId: 'compression-value',
    projectHash: 'compression-value',
    chatsDir: root,
    workspaceDirs: [root],
    provider: 'test',
    model: 'test',
    io: {
      appendFile: async (file, data, encoding): Promise<void> => {
        if (state.armed && String(data).includes('"type":"content"')) {
          state.armed = false;
          ready.resolve();
          await gate.promise;
        }
        await appendFile(file, data, encoding);
      },
    },
  });
  const history = new ValueCompressionHistory({
    recording: recorder,
    mutationOwnership: owners,
    attachmentCounters: { ...createRowCounters().counters, ownership: owners },
  });
  try {
    for (let index = 0; index < size; index++)
      await recorder.commit('content', { content: suffixRow(index, 2048) });
    return await action(
      history,
      recorder,
      owners,
      () => {
        state.armed = true;
      },
      ready,
      gate.resolve,
    );
  } finally {
    gate.resolve();
    history.dispose();
    await recorder.dispose();
    rmSync(root, { recursive: true, force: true });
  }
}

describe('production compression value recorder admissions', () => {
  it.each([512, 8192])(
    'charges complete rows before actual %i-row publication acknowledgment and releases them only when its blocked writer commits',
    async (size) => {
      await withRecorder(
        size,
        async (history, recorder, owners, arm, ready, release) => {
          const { handler } = middleoutSetup(
            history,
            new StreamingSummaryTransport(),
          );
          history.setCacheAnchorSeq(1);
          arm();
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
          expect(await compressionDurableValueDigest(recorder)).toStrictEqual(
            await compressionValueDigest(history.streamRawHistory()),
          );
          expect(owners.snapshot().liveRows).toBe(0);
          expect(history.compressionLocked).toBe(false);
        },
      );
    },
    180_000,
  );
});

describe('production compression value recorder compensation', () => {
  it.each([512, 8192])(
    'restores durable %i-row values after partial admission failure and retries without old publication',
    async (size) => {
      await withRecorder(size, async (history, recorder, owners) => {
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
        recorder.failAdmissionAfter(2);
        const failed = handler.performCompression('value-admission-fault').then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(await failed).toBe(recorder.failure);
        await recorder.flush();
        expect(await compressionDurableValueDigest(recorder)).toStrictEqual(
          baseline,
        );
        expect(history.getCacheAnchorSeq()).toBe(1);
        expect(history.compressionLocked).toBe(false);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(await handler.performCompression('value-admission-retry')).toBe(
          PerformCompressionResult.COMPRESSED,
        );
        await recorder.flush();
        expect(await compressionDurableValueDigest(recorder)).toStrictEqual(
          await compressionValueDigest(history.streamRawHistory()),
        );
        expect(
          owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
      });
    },
    180_000,
  );
});
