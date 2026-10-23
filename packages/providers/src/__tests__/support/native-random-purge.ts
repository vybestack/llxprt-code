/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { withCoreSuffixFixture } from '@vybestack/llxprt-code-core/services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import { EagerSemanticPurgeOracle } from '@vybestack/llxprt-code-core/services/history/__tests__/support/semantic-purge-eager-test-helpers.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { SemanticMediaPurgeStreamCoordinator } from '@vybestack/llxprt-code-core/services/history/semantic-purge-stream.js';
import { expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { captureRequestDump } from './chatSendCapture.js';
import { closeInOrder } from './close-in-order.js';
import {
  FROZEN_FORMATS,
  formatById,
  rawHistoryOf,
  settingsOf,
  type FrozenFormat,
  type FrozenSettings,
} from './frozenWire/frozenCases.js';
import { eagerProviderOracle } from './journal-provider-fixture.js';
import {
  captureSeed,
  guardedSeedHistory,
  seedReceipt,
} from './native-seed-cases.js';
import { referenceSeedOutcome } from './native-seed-reference.js';
import type { HistoryCase } from './wireBodyHistories.js';

type EagerTransaction = NonNullable<
  ReturnType<EagerSemanticPurgeOracle['begin']>
>;
interface PurgeCase {
  seed: number;
  format: FrozenFormat;
  settings: FrozenSettings;
  input: HistoryCase;
  expected: EagerTransaction;
}

function purgeToolRows(seed: number): IContent[] {
  const id = seed % 2 === 0 ? '' : `duplicate-${seed}`;
  return [
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id,
          name: 'oauth_read_file',
          parameters: { seed },
        },
        {
          type: 'tool_call',
          id,
          name: 'run_shell',
          parameters: { chain: true },
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: id,
          toolName: 'oauth_read_file',
          result: { seed },
        },
        {
          type: 'tool_response',
          callId: `orphan-${seed}`,
          toolName: 'orphan',
          result: 'orphan',
        },
      ],
    },
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: `chain-${seed}`,
          name: 'read_file',
          parameters: { seed },
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: `chain-${seed}`,
          toolName: 'read_file',
          result: 'tail',
        },
      ],
    },
    { speaker: 'human', blocks: [{ type: 'text', text: `next-${seed}` }] },
  ];
}

export function randomPurgeRows(seed: number): IContent[] {
  const rows = rawHistoryOf(formatById('anthropic-purge-boundary'), seed).map(
    (row) => ({
      speaker: row.speaker,
      blocks:
        row.blocks.length === 0
          ? [
              {
                type: 'text',
                text: `empty-${seed}`,
              } satisfies IContent['blocks'][number],
            ]
          : row.blocks,
    }),
  );
  const image: IContent = {
    speaker: 'human',
    blocks: [
      { type: 'text', text: `purge-${seed}:雪🧪"\\\n` },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: 'aW1hZ2U=',
        caption: `summary-${seed}`,
      },
    ],
  };
  return [...rows, image, ...purgeToolRows(seed)].map((row, index) => ({
    ...row,
    metadata: {
      chronology: {
        seq: index + 1,
        userTurn: index + 1,
        step: 0,
        recordedAt: 0,
      },
    },
  }));
}

async function rowDigest(rows: AsyncIterable<IContent>): Promise<string> {
  const hash = createHash('sha256');
  for await (const row of rows) hash.update(JSON.stringify(row) + '\n');
  return hash.digest('hex');
}

function arrayDigest(rows: readonly IContent[]): string {
  const hash = createHash('sha256');
  for (const row of rows) hash.update(JSON.stringify(row) + '\n');
  return hash.digest('hex');
}

function reference(
  input: PurgeCase,
  rows: readonly IContent[],
): ReturnType<typeof referenceSeedOutcome> {
  return referenceSeedOutcome(
    input.format,
    input.settings,
    eagerProviderOracle({ ...input.input, rows }).rows,
  );
}

async function checkPurgeDump(
  input: PurgeCase,
  selection: ProviderRequestSnapshot,
): Promise<void> {
  if (input.format.family === 'responses') return;
  const route = {
    ...input.format.route,
    model: input.settings.model,
    providerSettings: {
      ...input.format.route.providerSettings,
      ...input.settings.providerSettings,
    },
  };
  const changed = { ...input.input, rows: input.expected.candidateHistory };
  expect(
    await captureRequestDump(
      route,
      changed,
      'rows',
      undefined,
      'on',
      route.respond,
      input.seed % 2 === 0,
      selection,
    ),
  ).toBe(
    await captureRequestDump(
      route,
      eagerProviderOracle(changed),
      'rows',
      undefined,
      'on',
      route.respond,
      input.seed % 2 === 0,
    ),
  );
}

async function filterAndCheck(
  input: PurgeCase,
  history: HistoryService,
  ownership: RowOwnership,
  after: ProviderRequestSnapshot,
): Promise<void> {
  const filtered = input.expected.candidateHistory.filter(
    (_row, index) => index % 3 !== input.seed % 3,
  );
  await history.detachedValues.transform(async (source, sink) => {
    let index = 0;
    for await (const row of source.streamRows()) {
      const ordinal = index++;
      if (ordinal % 3 !== input.seed % 3)
        await sink.appendDerived(ordinal, row);
      else await sink.removeValue(ordinal);
    }
  });
  await history.waitForCommit();
  expect(await rowDigest(history.streamRawHistory())).toBe(
    arrayDigest(filtered),
  );
  expect(
    await captureSeed(
      input.format,
      input.settings,
      input.input,
      after.openReader(),
      after,
    ),
  ).toStrictEqual(reference(input, input.expected.candidateHistory));
  const final = await history.prepareCuratedForProviderSnapshot([], {
    ownership,
  });
  let failure: { readonly error: unknown } | undefined;
  try {
    expect(
      await captureSeed(
        input.format,
        input.settings,
        input.input,
        final.openReader(),
        final,
      ),
    ).toStrictEqual(reference(input, filtered));
    seedReceipt({
      kind: 'random-purge',
      seed: input.seed,
      format: input.format.id,
      mode: input.seed % 2 === 0 ? 'remove' : 'summary',
      source: arrayDigest(input.input.rows),
      candidate: arrayDigest(input.expected.candidateHistory),
      filtered: arrayDigest(filtered),
      frontier: input.expected.nextFrontier,
    });
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    await closeInOrder(failure, final);
  }
}

async function checkChangedPurge(
  input: PurgeCase,
  history: HistoryService,
  ownership: RowOwnership,
): Promise<void> {
  const after = await history.prepareCuratedForProviderSnapshot([], {
    ownership,
  });
  let failure: { readonly error: unknown } | undefined;
  try {
    expect(
      await captureSeed(
        input.format,
        input.settings,
        input.input,
        after.openReader(),
        after,
      ),
    ).toStrictEqual(reference(input, input.expected.candidateHistory));
    await checkPurgeDump(input, after);
    await filterAndCheck(input, history, ownership, after);
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    await closeInOrder(failure, after);
  }
}

async function checkPinnedPurge(
  input: PurgeCase,
  history: HistoryService,
  ownership: RowOwnership,
  pinned: ProviderRequestSnapshot,
): Promise<void> {
  const selected =
    process.env.W23_NATIVE_SEED_TRAP === 'selected-snapshot'
      ? await history.prepareCuratedForProviderSnapshot([], { ownership })
      : pinned;
  let failure: { readonly error: unknown } | undefined;
  try {
    expect(
      await captureSeed(
        input.format,
        input.settings,
        input.input,
        selected.openReader(),
        selected,
      ),
    ).toStrictEqual(reference(input, input.input.rows));
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    await closeInOrder(failure, selected === pinned ? undefined : selected);
  }
}

function purgeOptions(seed: number): {
  mode: 'remove' | 'summary';
  summaryText?: string;
} {
  if (seed % 2 === 0) return { mode: 'remove' };
  return { mode: 'summary', summaryText: `summary-${seed}:雪"\\\n` };
}

async function checkNativePurge(
  input: PurgeCase,
  history: HistoryService,
  ownership: RowOwnership,
): Promise<void> {
  const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
    enabled: true,
    explicitCacheWriteRequired: false,
    ownership,
  });
  const selectedOptions =
    process.env.W23_NATIVE_SEED_TRAP === 'wrong-purge'
      ? { mode: 'summary' as const, summaryText: 'wrong purge mutation' }
      : purgeOptions(input.seed);
  const transaction = await coordinator.begin(selectedOptions);
  if (transaction === undefined)
    throw new Error(`No native purge candidate seed ${input.seed}`);
  const pinned = await history.prepareCuratedForProviderSnapshot([], {
    ownership,
  });
  let failure: { readonly error: unknown } | undefined;
  try {
    expect(transaction.changedContentIndex).toBe(
      input.expected.changedContentIndex,
    );
    expect(transaction.changedBlockIndex).toBe(
      input.expected.changedBlockIndex,
    );
    expect(transaction.nextFrontier).toStrictEqual(input.expected.nextFrontier);
    expect(await rowDigest(transaction.candidate.streamRows())).toBe(
      arrayDigest(input.expected.candidateHistory),
    );
    expect(
      await coordinator.commit(transaction, {
        status: 'success',
        cachePrefixWritten: true,
      }),
    ).toBe(true);
    await history.waitForCommit();
    expect(await rowDigest(history.streamRawHistory())).toBe(
      arrayDigest(input.expected.candidateHistory),
    );
    await checkPinnedPurge(input, history, ownership, pinned);
    await checkChangedPurge(input, history, ownership);
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    await closeInOrder(failure, pinned, transaction);
    expect(() => pinned.openReader()).toThrow('closed');
    expect(ownership.snapshot().liveRows).toBe(0);
  }
}

export async function checkRandomPurge(seed: number): Promise<void> {
  const rows = randomPurgeRows(seed);
  const format = FROZEN_FORMATS.filter((entry) => !entry.purgeCorpus)[seed % 8];
  const settings = settingsOf(format, seed);
  const input: HistoryCase = {
    id: `random-purge-${seed}`,
    description: 'seeded semantic purge and owner filter projection',
    rows,
    ephemerals: settings.ephemerals,
    ...(settings.systemInstruction === null
      ? {}
      : { systemInstruction: settings.systemInstruction }),
  };
  await withCoreSuffixFixture(
    rows.length,
    async (old) => {
      const oracle = new EagerSemanticPurgeOracle(old, {
        enabled: true,
        explicitCacheWriteRequired: false,
      });
      const expected = oracle.begin(purgeOptions(seed));
      if (expected === undefined)
        throw new Error(`No eager purge candidate seed ${seed}`);
      await withCoreSuffixFixture(
        rows.length,
        async (history, ownership) =>
          checkNativePurge(
            { seed, format, settings, input, expected },
            history,
            ownership,
          ),
        0,
        (index) => structuredClone(rows[index]),
        undefined,
        guardedSeedHistory,
      );
    },
    0,
    (index) => structuredClone(rows[index]),
    undefined,
    undefined,
  );
}
