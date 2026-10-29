/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  exactTokenizer,
  rejectedValue,
} from '@vybestack/llxprt-code-core/services/history/chronology-rollback-test-helpers.js';
import { withNativeFallbackFixture } from './support/native-fallback-fixture.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import {
  fallbackRow,
  nativeFallback,
} from './native-provider-fallback-helpers.js';
import { publishProviderFallbackCandidate } from '../providerFallbackCandidate.js';
import { executeFallbackTransaction } from '../providerFallbackTransaction.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { CompressionIndexedRows } from '@vybestack/llxprt-code-core/services/history/compressionInput.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

async function seed(
  size: number,
  fixture: Parameters<Parameters<typeof withNativeFallbackFixture>[0]>[0],
): Promise<void> {
  await fixture.history.detachedValues.replace(
    Array.from({ length: size }, (_, index) => fallbackRow(index)),
  );
  await fixture.history.waitForCommit();
  fixture.history.setCacheAnchorSeq(1);
}

describe('native indexed provider fallback failures', () => {
  it('preserves the original row-65 admission error and old mirror, then continues on the same writer', async () => {
    await withNativeFallbackFixture(async (fixture) => {
      const { history, durable, owners } = fixture;
      await seed(130, fixture);
      const before = await compressionValueDigest(history.streamRawHistory());
      const tokens = history.getTotalTokens();
      let primary: Error | undefined;
      const error = await rejectedValue(
        nativeFallback(history, 129, async (candidate) => {
          primary = fixture.failAdmissionAfter(64);
          await publishProviderFallbackCandidate(
            history,
            candidate,
            'test-model',
          );
        }).then(() => {}),
      );
      expect(error).toBe(primary);
      history.setTokenizerFactory(exactTokenizer());
      expect(await durable()).toStrictEqual(before);
      expect(
        await compressionValueDigest(history.streamRawHistory()),
      ).toStrictEqual(before);
      expect(history.getTotalTokens()).toBe(tokens);
      expect(history.getCacheAnchorSeq()).toBe(1);
      expect(owners.snapshot().liveRows).toBe(0);
      expect((await nativeFallback(history, 129)).outcome).toBe('applied');
      expect(await durable()).toStrictEqual(
        await compressionValueDigest(history.streamRawHistory()),
      );
    });
  });

  it('restores the held version and baseline after provider result rejection following installation', async () => {
    await withNativeFallbackFixture(async (fixture) => {
      const { history, durable } = fixture;
      await seed(130, fixture);
      const before = await compressionValueDigest(history.streamRawHistory());
      const primary = new Error('provider result rejected after installation');
      let baseline: number | null = 123;
      const result = await executeFallbackTransaction(
        {
          historyService: history,
          logger: new DebugLogger('fallback-fault'),
          model: 'test-model',
          getPromptTokenBaseline: () => baseline,
          resetPromptTokenBaseline: () => {
            baseline = null;
          },
          restorePromptTokenBaseline: (value) => {
            baseline = value;
          },
          performFallbackCompression: async (_prompt, apply) => {
            await nativeFallback(history, 129, apply);
            throw primary;
          },
        },
        'provider-reject',
        129,
      );
      expect(result).toStrictEqual({
        truncationApplied: false,
        truncationFailure: primary,
      });
      expect(await durable()).toStrictEqual(before);
      expect(
        await compressionValueDigest(history.streamRawHistory()),
      ).toStrictEqual(before);
      expect(history.getTotalTokens()).toBe(130);
      expect(history.getCacheAnchorSeq()).toBe(1);
      expect(baseline).toBe(123);
    });
  });

  it('retires admitted input iterators before releasing the checkpoint after callback abort', async () => {
    await withNativeFallbackFixture(async (fixture) => {
      await seed(8, fixture);
      const primary = new Error('aborted provider fallback callback');
      let borrowed: CompressionIndexedRows | undefined;
      let reader: AsyncIterator<IContent> | undefined;
      const error = await rejectedValue(
        nativeFallback(fixture.history, 7, async (candidate) => {
          borrowed = candidate.rows;
          if (!(Symbol.asyncIterator in candidate.rows))
            throw new Error('Expected async native input');
          reader = candidate.rows[Symbol.asyncIterator]();
          const first = await reader.next();
          expect(first.done).toBe(false);
          expect(fixture.owners.snapshot().liveRows).toBe(1);
          throw primary;
        }).then(() => {}),
      );
      expect(error).toBe(primary);
      expect(fixture.owners.snapshot().liveRows).toBe(0);
      expect(borrowed).toBeDefined();
      expect(reader).toBeDefined();
      if (borrowed === undefined || reader === undefined)
        throw new Error('Missing admitted reader');
      await expect(borrowed.readRow(0)).rejects.toThrow('closed');
      await expect(reader.next()).rejects.toThrow('closed');
      expect(await fixture.durable()).toStrictEqual(
        await compressionValueDigest(fixture.history.streamRawHistory()),
      );
    });
  });
});
