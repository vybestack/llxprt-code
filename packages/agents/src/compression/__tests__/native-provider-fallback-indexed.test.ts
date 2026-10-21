/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { JournalDumpSnapshot } from '@vybestack/llxprt-code-core/services/history/journalDumpSnapshot.js';
import { withNativeValueFixture } from './support/native-value-fixture.js';
import {
  fallbackRow,
  nativeFallback,
} from './native-provider-fallback-helpers.js';
import { publishProviderFallbackCandidate } from '../providerFallbackCandidate.js';

async function forbidPayload<T>(action: () => Promise<T>): Promise<T> {
  const read = VersionSnapshot.prototype.readRow;
  VersionSnapshot.prototype.readRow = async () => {
    throw new Error('Indexed selection decoded a full ROW');
  };
  try {
    return await action();
  } finally {
    VersionSnapshot.prototype.readRow = read;
  }
}

describe('native fallback indexed selection and no-op', () => {
  it.each([40, 4000])(
    'does not read payload or scan the checkpoint for no-op/count/source-rank at %i rows',
    async (size) => {
      await withNativeValueFixture(async ({ history }) => {
        await history.detachedValues.replace(
          (function* () {
            for (let index = 0; index < size; index++) yield fallbackRow(index);
          })(),
        );
        await history.waitForCommit();
        const noop = await forbidPayload(() => nativeFallback(history, size));
        expect(noop).toStrictEqual({ outcome: 'noop' });
        let selected = 0;
        const read = JournalDumpSnapshot.prototype.readRow;
        JournalDumpSnapshot.prototype.readRow = function (
          index,
        ): ReturnType<JournalDumpSnapshot['readRow']> {
          selected++;
          return read.call(this, index);
        };
        try {
          await nativeFallback(history, size - 1, async (candidate) => {
            await forbidPayload(async () => {
              expect(candidate.rows.length).toBe(size);
              expect(candidate.start).toBe(1);
              expect(await candidate.sourceOrdinalAt?.(0)).toBe(0);
              expect(await candidate.sourceOrdinalAt?.(size - 1)).toBe(
                size - 1,
              );
            });
            expect(selected).toBe(size * 2 + 2);
            await publishProviderFallbackCandidate(
              history,
              candidate,
              'test-model',
            );
          });
        } finally {
          JournalDumpSnapshot.prototype.readRow = read;
        }
        process.stdout.write(
          `FALLBACK_INDEXED ${JSON.stringify({ size, selected, notes: 'total includes linear token, summary and retained-row passes; indexed queries deny payload' })}\n`,
        );
      });
    },
    180_000,
  );
});
