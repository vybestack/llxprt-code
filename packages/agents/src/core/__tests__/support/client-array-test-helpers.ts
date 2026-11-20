/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { appendFileSync } from 'node:fs';
import { buildCliStyleConfig } from '../../../api/__tests__/helpers/buildCliStyleConfig.js';
import type { LocalMediaStore } from '../../../../../core/src/storage/local-media-store.js';
import { MediaAdmissionService } from '../../../../../core/src/storage/media-admission-service.js';
import { exactTokenizer } from '../../../../../core/src/services/history/chronology-rollback-test-helpers.js';
import {
  detachedDigest,
  detachedRow,
  detachedRows,
  type DetachedFixture,
} from '../../../../../core/src/services/history/detached-rollback-test-helpers.js';
import { JournalHistoryStore } from '../../../../../core/src/services/history/journalHistoryStore.js';
import type { IContent } from '../../../../../core/src/services/history/IContent.js';
import type { AgentClientContract } from '../../../../../core/src/core/clientContract.js';

export interface ClientArrayFixture {
  readonly client: AgentClientContract;
  readonly store: LocalMediaStore;
}
export async function withArrayClient<T>(
  fixture: DetachedFixture,
  action: (client: ClientArrayFixture) => Promise<T>,
): Promise<T> {
  const { agentClient: client, cleanup } =
    await buildCliStyleConfig('plain-text.jsonl');
  try {
    const store = client.mediaStore;
    if (store === undefined) throw new Error('Missing session media store');
    await client.getHistoryService()?.dispose();
    client.storeHistoryServiceForReuse(fixture.history);
    await client.startChat([]);
    fixture.history.setTokenizerFactory(exactTokenizer());
    return await action({ client, store });
  } finally {
    await cleanup();
  }
}
export async function seedClientArrayHistory(
  fixture: DetachedFixture,
  size: number,
  appendBatchSize?: number,
): Promise<void> {
  const journal = fixture.history.detachedValues.host().journal;
  if (!(journal instanceof JournalHistoryStore))
    throw new Error('Client array fixture requires a journal history store');
  if (appendBatchSize === undefined)
    await journal.replaceFrom(detachedRows(size), size);
  else {
    if (journal.getLength() !== 0 || appendBatchSize < 1)
      throw new Error(
        'Batched seeds require an empty journal and a positive batch size',
      );
    for (let first = 0; first < size; first += appendBatchSize) {
      const end = Math.min(size, first + appendBatchSize);
      for (let index = first; index < end; index++)
        journal.apply({ kind: 'content', content: detachedRow(index) });
      await journal.waitForDurable();
    }
  }
  await fixture.history.recalculateTotalTokens();
  await fixture.history.waitForCommit();
}

export function forbidClientArrayRollback(fixture: DetachedFixture): void {
  const reject = async (): Promise<never> => {
    throw new Error('Client restore entered legacy array rollback');
  };
  fixture.history.replaceAll = reject;
  fixture.history.replaceBatch = reject;
}
export function clientArrayRows(size: number, bytes = 2048): IContent[] {
  return Array.from({ length: size }, (_, index) => detachedRow(index, bytes));
}
export async function expectedClientArrayOutcome(
  size: number,
  stage: string,
  batch: boolean,
): Promise<object> {
  const success = stage === 'success';
  const digest = await detachedDigest(
    (async function* (): AsyncGenerator<IContent, void, unknown> {
      for (let index = 0; index < size; index++) {
        const row = detachedRow(index);
        yield success && index === size - 1
          ? { ...row, blocks: [{ type: 'text', text: `replacement-${index}` }] }
          : row;
      }
    })(),
  );
  const publication = [
    'prepare',
    'publish',
    ...(batch ? ['batch'] : []),
    'tokens',
    'range',
    'finalize',
  ];
  const observed = success
    ? publication
    : publication.slice(0, publication.indexOf(stage) + 1);
  return {
    live: digest,
    durable: digest,
    tokens: size * 4 + 17 - (success ? 3 : 0),
    range: {
      firstSeq: 1,
      lastSeq: size,
      totalEntries: size,
      removedInterior: [],
      approximate: false,
    },
    anchor: batch && success ? 0 : 1,
    order:
      success || stage === 'prepare' ? observed : [...observed, 'rollback'],
  };
}

export async function withClientOracle<T>(
  store: LocalMediaStore,
  rows: readonly IContent[],
  action: (rows: readonly IContent[]) => Promise<T>,
): Promise<T> {
  const admission = new MediaAdmissionService(store);
  const context = {
    turnId: 'client-array-oracle',
    source: 'client-array-oracle',
  };
  const admitted = await admission.admitContents(rows, context);
  try {
    return await action(admitted);
  } finally {
    await admission.releaseContents(admitted, context);
  }
}
export async function* clientRows(
  rows: readonly IContent[],
): AsyncGenerator<IContent, void, unknown> {
  yield* rows;
}
export function recordClientProof(value: object): void {
  const output = process.env.CLIENT_ARRAY_OUTPUT;
  if (output !== undefined)
    appendFileSync(output, JSON.stringify(value) + '\n');
}

/**
 * Media reclamation skips objects created in the current millisecond, so a
 * test that reclaims right after admission must let the clock move first.
 */
export async function waitForNextMillisecond(): Promise<void> {
  const start = Date.now();
  while (Date.now() <= start) await Bun.sleep(1);
}
