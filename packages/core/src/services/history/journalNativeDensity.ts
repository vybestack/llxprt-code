/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { DensityFileFacts } from '../../journal/density-file-facts.js';
import type { RecencyFacts } from '../../journal/recencyFacts.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { DetachedHistoryTransform } from './detachedHistoryAPI.js';
import type { HistoryDensityRequest } from './historyStorePort.js';
import type { JournalHistoryStore } from './journalHistoryStore.js';
import type { NativeDensityPolicy } from './nativeDensityPolicy.js';
import { decodeStoredRow } from './journalRowCodec.js';
import { invalidateResponsesStatefulChain } from './IContent.js';
import { historyMutationFailure } from './historyMutationEffects.js';
import { retryWithBackoff } from '../../utils/retry.js';
import { shouldRetryCompressionError } from '../../core/compression/types.js';

function recencyTransform(
  snapshot: VersionSnapshot,
  policy: NativeDensityPolicy,
  facts: RecencyFacts,
  resumeBoundary: bigint | undefined,
  fileFacts: DensityFileFacts | undefined,
): DetachedHistoryTransform {
  return async (_source, sink) => {
    let ordinal = 0;
    for await (const entry of snapshot.entries()) {
      const row = decodeStoredRow(
        await snapshot.readRow(entry),
        resumeBoundary,
      );
      const deduplicated =
        fileFacts === undefined
          ? undefined
          : await policy.files?.replace(row, ordinal, fileFacts);
      const recency = await policy.replace(
        deduplicated ?? row,
        async (block, bucket) =>
          (await facts.count(bucket)) -
            (await facts.ordinal(entry.label, block)) +
            1 >
          policy.retention,
      );
      const replacement = recency ?? deduplicated;
      const [clean] = invalidateResponsesStatefulChain([replacement ?? row]);
      if (replacement === undefined) await sink.appendDerived(ordinal, clean);
      else await sink.appendReplacement(ordinal, clean);
      ordinal++;
    }
  };
}

async function publishRecency(
  store: JournalHistoryStore,
  request: HistoryDensityRequest,
  snapshot: VersionSnapshot,
  policy: NativeDensityPolicy,
): Promise<void> {
  if (snapshot.rows === 0) return;
  const facts = await snapshot.recencyFacts(policy.factRevision);
  const fileFacts =
    policy.files === undefined
      ? undefined
      : await snapshot.densityFiles(policy.files.facts.revision);
  const duplicates =
    fileFacts === undefined ? 0 : (await fileFacts.header())[3];
  if (!((await facts.maximum()) > policy.retention) && duplicates === 0) return;
  await store.publishDetached(
    {
      transform: recencyTransform(
        snapshot,
        policy,
        facts,
        store.resumeBoundary,
        fileFacts,
      ),
    },
    {
      ...request.host,
      estimate: (rows, model, signal) =>
        retryWithBackoff(() => request.host.estimate(rows, model, signal), {
          maxAttempts: 3,
          initialDelayMs: 2000,
          maxDelayMs: 10000,
          shouldRetryOnError: shouldRetryCompressionError,
          signal,
        }),
    },
    undefined,
    { publishTokens: true, densityShape: true },
  );
}

export async function optimizeNativeDensity(
  store: JournalHistoryStore,
  request: HistoryDensityRequest,
): Promise<void> {
  const policy = request.nativePolicy?.();
  if (policy === undefined)
    throw new Error('Native density policy is required');
  if (policy.files !== undefined)
    await (await store.openDensityFiles(policy.files.facts)).close();
  const snapshot = await store.settledSnapshot(() =>
    request.host.waitForTokenUpdates(),
  );
  let failure: { error: unknown } | undefined;
  try {
    await publishRecency(store, request, snapshot, policy);
  } catch (error) {
    failure = { error };
  }
  const failures: unknown[] = [];
  try {
    await snapshot.close();
  } catch (error) {
    failures.push(error);
  }
  if (failure !== undefined)
    throw historyMutationFailure(failure.error, failures);
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      'Native density snapshot cleanup failed',
    );
}
