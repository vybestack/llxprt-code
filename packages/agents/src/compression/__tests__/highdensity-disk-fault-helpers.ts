/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { withCompressionValueRecorder } from './support/compression-value-recorder-fixture.js';
import { compressionValueDigest } from './compression-value-fixture.js';
import type { CompressionValueRecorderFixture } from './support/compression-value-recorder-fixture.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HighdensityDiskHistory } from './highdensity-disk-helpers.js';

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => {
    throw new Error('Gate not initialized');
  };
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve: () => resolve() };
}

export class HighdensityFaultHistory extends HighdensityDiskHistory {
  get compressionLocked(): boolean {
    return this.isCompressing;
  }
  beforeEstimate?: () => Promise<void>;
  estimateFault?: () => Error | undefined;
  attempts = 0;
  override async estimateTokensForContents(
    contents: Iterable<IContent> | AsyncIterable<IContent>,
  ): Promise<number> {
    this.attempts++;
    await this.beforeEstimate?.();
    const error = this.estimateFault?.();
    if (error !== undefined) throw error;
    return super.estimateTokensForContents(contents);
  }
}

export async function withFaultRollback<T>(
  action: (
    history: HighdensityFaultHistory,
    recorder: Pick<
      CompressionValueRecorderFixture,
      'failure' | 'failAdmissionAfter' | 'durable'
    > & {
      flush(): Promise<void>;
    },
  ) => Promise<T>,
): Promise<T> {
  return withCompressionValueRecorder(
    0,
    async (fixture) => {
      if (!(fixture.history instanceof HighdensityFaultHistory))
        throw new Error('Missing high-density fault history');
      const result = await action(fixture.history, {
        failure: fixture.failure,
        failAdmissionAfter: fixture.failAdmissionAfter,
        durable: fixture.durable,
        flush: () => fixture.recorder.flush(),
      });
      expect(await fixture.durable()).toStrictEqual(
        await compressionValueDigest(fixture.history.streamRawHistory()),
      );
      return result;
    },
    undefined,
    (options) => new HighdensityFaultHistory(options),
  );
}
