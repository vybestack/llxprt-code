import { withCuratedHistoryForTest } from '../../../test-utils/curated-history-fixture.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectRawHistory } from '../../../test-utils/collect-raw-history.js';
import { expect } from 'bun:test';
import * as fc from 'fast-check';
import { HistoryService } from '../HistoryService.js';
import {
  withSuffixFixture,
  suffixRow,
} from '../history-suffix-test-helpers.js';
import type { IContent } from '../IContent.js';
import type {
  DensityResult,
  DensityResultMetadata,
} from '../../../core/compression/types.js';
import { CompressionStrategyError } from '../../../core/compression/types.js';
export function makeEntry(
  speaker: IContent['speaker'],
  text: string,
): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

export function makeEmptyAiEntry(): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text: '' }] };
}

export function makeMetadata(
  overrides: Partial<DensityResultMetadata> = {},
): DensityResultMetadata {
  return {
    readWritePairsPruned: 0,
    fileDeduplicationsPruned: 0,
    recencyPruned: 0,
    ...overrides,
  };
}

export function makeDensityResult(
  removals: number[],
  replacements: Map<number, IContent>,
  metadata?: Partial<DensityResultMetadata>,
): DensityResult {
  return {
    removals,
    replacements,
    metadata: makeMetadata(metadata),
  };
}

export function seedHistory(
  service: HistoryService,
  count: number,
): IContent[] {
  const entries: IContent[] = [];
  for (let i = 0; i < count; i++) {
    const label = String.fromCharCode(65 + i); // A, B, C, …
    const entry = makeEntry('human', label);
    entries.push(entry);
    service.add(entry);
  }
  return entries;
}

export function validReplacementMap(
  rawIndices: readonly number[],
  historySize: number,
  excludedIndices: ReadonlySet<number> = new Set<number>(),
  prefix = 'R',
): Map<number, IContent> {
  const replacements = new Map<number, IContent>();
  for (const index of rawIndices) {
    if (index >= 0 && index < historySize && !excludedIndices.has(index)) {
      replacements.set(index, makeEntry('human', `${prefix}${index}`));
    }
  }
  return replacements;
}

export function unchangedReferenceObservations(
  raw: readonly IContent[],
  entries: readonly IContent[],
  historySize: number,
  removals: readonly number[],
  touched: ReadonlySet<number>,
): boolean[] {
  const observations: boolean[] = [];
  let rawIndex = 0;
  for (let originalIndex = 0; originalIndex < historySize; originalIndex++) {
    if (!removals.includes(originalIndex)) {
      observations.push(
        touched.has(originalIndex) || raw[rawIndex] === entries[originalIndex],
      );
      rawIndex++;
    }
  }
  return observations;
}

export async function observeReplacementCase(
  historySize: number,
  rawReplacements: readonly number[],
): Promise<readonly ReplacementObservation[]> {
  const service = new HistoryService();
  seedHistory(service, historySize);
  await service.waitForTokenUpdates();
  const replacements = validReplacementMap(
    rawReplacements,
    historySize,
    new Set<number>(),
    'REPLACED_',
  );
  if (replacements.size === 0) return [];

  await service.applyDensityResult(makeDensityResult([], replacements));
  const raw = await collectRawHistory(service);
  return [...replacements].map(([index, expected]) => ({
    actual: raw[index],
    expected,
  }));
}

export async function conflictApplications(
  historySize: number,
  conflictIndex: number,
): Promise<ReadonlyArray<Promise<void>>> {
  if (conflictIndex >= historySize) return [];
  const service = new HistoryService();
  seedHistory(service, historySize);
  await service.waitForTokenUpdates();
  const result = makeDensityResult(
    [conflictIndex],
    new Map([[conflictIndex, makeEntry('human', 'X')]]),
  );
  return [service.applyDensityResult(result)];
}

export let densityFixture1_service: HistoryService;

export function densityFixture2_inRangeIndices(
  indices: number[],
  size: number,
): number[] {
  return indices.filter((i) => i >= 0 && i < size);
}

function durableDensityRow(index: number): IContent {
  return {
    ...makeEntry('human', String.fromCharCode(65 + index)),
    metadata: suffixRow(index).metadata,
  };
}

async function observeDurableDensity(
  size: number,
  removals: number[],
  retained: readonly number[],
  replace = false,
): Promise<{ actual: IContent; expected0: IContent }> {
  return withSuffixFixture(
    size,
    async (service, ownership) => {
      const marker = { seq: 999, userTurn: 99, step: 9, recordedAt: 9 };
      const replacement: IContent = {
        ...makeEntry('human', "B'"),
        metadata: { chronology: marker },
      };
      const expected = retained.map((index) =>
        replace && index === 1
          ? { ...replacement, metadata: durableDensityRow(index).metadata }
          : durableDensityRow(index),
      );
      await service.applyDensityResult(
        makeDensityResult(
          removals,
          replace ? new Map([[1, replacement]]) : new Map(),
        ),
      );
      await service.waitForCommit();
      await service.waitForTokenUpdates();
      const raw = await collectRawHistory(service);
      expect(raw).toHaveLength(retained.length);
      expect(raw).toStrictEqual(expected);
      for (let index = 0; index < expected.length; index++)
        expect(raw[index]).toStrictEqual(expected[index]);
      expect(replacement.metadata?.chronology).toBe(marker);
      expect(marker).toStrictEqual({
        seq: 999,
        userTurn: 99,
        step: 9,
        recordedAt: 9,
      });
      expect(service.getTotalTokens()).toBe(
        await service.estimateTokensForContents(expected),
      );
      const snapshot = await service.openDumpSnapshot();
      try {
        const durable: IContent[] = [];
        for await (const row of snapshot.rows()) durable.push(row);
        expect(durable).toStrictEqual(expected);
      } finally {
        await snapshot.close();
      }
      expect(ownership.snapshot().liveRows).toBe(0);
      return {
        actual: raw[raw.length - 1],
        expected0: expected[expected.length - 1],
      };
    },
    0,
    durableDensityRow,
  );
}

export function observeDensityCase3(): Promise<ReplacementObservationResult> {
  return observeDurableDensity(5, [3], [0, 1, 2, 4], true);
}

export function observeDensityCase4(): Promise<ReplacementObservationResult> {
  return observeDurableDensity(5, [1, 3], [0, 2, 4]);
}

export function observeDensityCase5(): Promise<ReplacementObservationResult> {
  return observeDurableDensity(3, [0, 2], [1]);
}

export function observeDensityCase6(): Promise<ReplacementObservationResult> {
  return observeDurableDensity(3, [], [0, 1, 2], true);
}

export function observeDensityCase7(): Promise<ReplacementObservationResult> {
  return observeDurableDensity(3, [], [0, 1, 2]);
}

interface ReplacementObservationResult {
  readonly actual: IContent;
  readonly expected0: IContent;
}

export async function observeDensityCase8() {
  seedHistory(densityFixture1_service, 5);
  await densityFixture1_service.waitForTokenUpdates();

  const result = makeDensityResult(
    [2],
    new Map([[2, makeEntry('human', 'X')]]),
  );

  const err = await densityFixture1_service
    .applyDensityResult(result)
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(CompressionStrategyError);

  return { actual: err, expected0: { code: 'DENSITY_CONFLICT' } };
}

export async function observeDensityCase9() {
  seedHistory(densityFixture1_service, 3);
  await densityFixture1_service.waitForTokenUpdates();

  const result = makeDensityResult([5], new Map());

  const err = await densityFixture1_service
    .applyDensityResult(result)
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(CompressionStrategyError);

  return { actual: err, expected0: { code: 'DENSITY_INDEX_OUT_OF_BOUNDS' } };
}

export async function observeDensityCase10() {
  seedHistory(densityFixture1_service, 3);
  await densityFixture1_service.waitForTokenUpdates();

  const result = makeDensityResult(
    [],
    new Map([[10, makeEntry('human', 'X')]]),
  );

  const err = await densityFixture1_service
    .applyDensityResult(result)
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(CompressionStrategyError);

  return { actual: err, expected0: { code: 'DENSITY_INDEX_OUT_OF_BOUNDS' } };
}

export async function observeDensityCase11() {
  seedHistory(densityFixture1_service, 3);
  await densityFixture1_service.waitForTokenUpdates();

  const result = makeDensityResult([-1], new Map());

  const err = await densityFixture1_service
    .applyDensityResult(result)
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(CompressionStrategyError);

  return { actual: err, expected0: { code: 'DENSITY_INDEX_OUT_OF_BOUNDS' } };
}

export async function observeDensityCase12() {
  seedHistory(densityFixture1_service, 5);
  await densityFixture1_service.waitForTokenUpdates();

  const result = makeDensityResult([2, 2], new Map());

  return {
    actual: densityFixture1_service.applyDensityResult(result),
    expected0: CompressionStrategyError,
  };
}

export async function observeDensityCase13() {
  // GIVEN: add entries and let token estimation settle
  seedHistory(densityFixture1_service, 5);
  await densityFixture1_service.waitForTokenUpdates();
  const tokensBefore = densityFixture1_service.getTotalTokens();
  expect(tokensBefore).toBeGreaterThan(0);

  // WHEN: remove two entries
  const result = makeDensityResult([1, 3], new Map());
  await densityFixture1_service.applyDensityResult(result);
  await densityFixture1_service.waitForTokenUpdates();

  // THEN: totalTokens should reflect only the 3 remaining entries
  const tokensAfter = densityFixture1_service.getTotalTokens();
  expect(tokensAfter).toBeLessThan(tokensBefore);

  return tokensAfter;
}

export async function observeDensityCase14() {
  const entries = seedHistory(densityFixture1_service, 3);

  const raw = await collectRawHistory(densityFixture1_service);
  expect(raw).toHaveLength(3);
  expect(raw[0]).toBe(entries[0]);
  expect(raw[1]).toBe(entries[1]);

  return { actual: raw[2], expected0: entries[2] };
}

export async function observeDensityCase15() {
  // GIVEN: a human message, an empty AI message, and another human message
  const human1 = makeEntry('human', 'Hello');
  const emptyAi = makeEmptyAiEntry();
  const human2 = makeEntry('human', 'World');

  densityFixture1_service.add(human1);
  densityFixture1_service.add(emptyAi);
  densityFixture1_service.add(human2);

  // THEN: raw includes the empty AI message
  const raw = await collectRawHistory(densityFixture1_service);
  expect(raw).toHaveLength(3);
  expect(raw[1]).toBe(emptyAi);

  // AND: getCurated does NOT include the empty AI message
  let includesEmptyAi = false;
  await withCuratedHistoryForTest(densityFixture1_service, (curated) => {
    expect(curated).toHaveLength(2);
    includesEmptyAi = curated.some((c) => c === emptyAi);
  });
  return includesEmptyAi;
}

export async function observeDensityCase16() {
  // GIVEN: entries added, tokens settled
  seedHistory(densityFixture1_service, 3);
  await densityFixture1_service.waitForTokenUpdates();
  const expected = densityFixture1_service.getTotalTokens();
  expect(expected).toBeGreaterThan(0);

  // WHEN: recalculate
  await densityFixture1_service.recalculateTotalTokens();
  await densityFixture1_service.waitForTokenUpdates();

  // THEN: totalTokens reflects current entries

  return {
    actual: densityFixture1_service.getTotalTokens(),
    expected0: expected,
  };
}

export async function observeDensityCase17() {
  // GIVEN: entries with pending token estimation
  seedHistory(densityFixture1_service, 4);

  // WHEN: call recalculateTotalTokens while token updates may still be pending
  await densityFixture1_service.recalculateTotalTokens();
  await densityFixture1_service.waitForTokenUpdates();

  // THEN: no error, tokens are non-negative (serialization succeeded)

  return densityFixture1_service.getTotalTokens();
}

export async function observeDensityCase18() {
  return {
    property0: fc.asyncProperty(
      fc.integer({ min: 1, max: 8 }),
      fc.array(fc.integer({ min: 0, max: 7 }), {
        minLength: 0,
        maxLength: 5,
      }),
      async (histSize, rawRemovals) => {
        const svc = new HistoryService();
        seedHistory(svc, histSize);
        await svc.waitForTokenUpdates();

        const removals = densityFixture2_inRangeIndices(
          [...new Set(rawRemovals)],
          histSize,
        );

        const result = makeDensityResult(removals, new Map());
        await svc.applyDensityResult(result);

        expect(await collectRawHistory(svc)).toHaveLength(
          histSize - removals.length,
        );
      },
    ),
    property1: { numRuns: 5 },
  };
}

export async function observeDensityCase19() {
  return {
    property0: fc.asyncProperty(
      fc.integer({ min: 2, max: 8 }),
      fc.array(fc.integer({ min: 0, max: 7 }), {
        minLength: 0,
        maxLength: 4,
      }),
      fc.array(fc.integer({ min: 0, max: 7 }), {
        minLength: 0,
        maxLength: 3,
      }),
      async (histSize, rawRemovals, rawReplacements) => {
        const svc = new HistoryService();
        const entries = seedHistory(svc, histSize);
        await svc.waitForTokenUpdates();

        const removalSet = new Set(
          densityFixture2_inRangeIndices(rawRemovals, histSize),
        );
        const replacements = validReplacementMap(
          rawReplacements,
          histSize,
          removalSet,
        );
        const removals = [...removalSet].filter((i) => !replacements.has(i));

        const touched = new Set([...removals, ...replacements.keys()]);

        const result = makeDensityResult(removals, replacements);
        await svc.applyDensityResult(result);

        const observations = unchangedReferenceObservations(
          await collectRawHistory(svc),
          entries,
          histSize,
          removals,
          touched,
        );
        for (const unchanged of observations) {
          expect(unchanged).toBe(true);
        }
      },
    ),
    property1: { numRuns: 5 },
  };
}

export async function observeDensityCase20() {
  return {
    property0: fc.asyncProperty(
      fc.integer({ min: 2, max: 8 }),
      fc.array(fc.integer({ min: 0, max: 7 }), {
        minLength: 1,
        maxLength: 4,
      }),
      async (histSize, rawReplacements) => {
        const observations = await observeReplacementCase(
          histSize,
          rawReplacements,
        );
        for (const { actual, expected } of observations) {
          expect(actual).toBe(expected);
        }
      },
    ),
    property1: { numRuns: 5 },
  };
}

export async function observeDensityCase21() {
  return {
    property0: fc.asyncProperty(
      fc.integer({ min: 1, max: 8 }),
      fc.integer({ min: 0, max: 7 }),
      async (histSize, conflictIdx) => {
        const applications = await conflictApplications(histSize, conflictIdx);
        for (const application of applications) {
          await expect(application).rejects.toThrow(CompressionStrategyError);
        }
      },
    ),
    property1: { numRuns: 5 },
  };
}

export async function observeDensityCase22() {
  return {
    property0: fc.asyncProperty(fc.integer({ min: 0, max: 10 }), async (n) => {
      const svc = new HistoryService();
      for (let i = 0; i < n; i++) {
        svc.add(makeEntry('human', `msg-${i}`));
      }
      expect(await collectRawHistory(svc)).toHaveLength(n);
    }),
    property1: { numRuns: 5 },
  };
}

export async function observeDensityCase23() {
  return {
    property0: fc.asyncProperty(
      fc.integer({ min: 1, max: 8 }),
      fc.integer({ min: 0, max: 4 }),
      async (histSize, offset) => {
        const svc = new HistoryService();
        seedHistory(svc, histSize);
        await svc.waitForTokenUpdates();

        const oobIndex = histSize + offset;
        const result = makeDensityResult([oobIndex], new Map());

        await expect(svc.applyDensityResult(result)).rejects.toThrow(
          CompressionStrategyError,
        );
      },
    ),
    property1: { numRuns: 5 },
  };
}

export async function observeDensityCase24() {
  return {
    property0: fc.asyncProperty(
      fc.integer({ min: 1, max: 8 }),
      fc.array(fc.integer({ min: 0, max: 7 }), {
        minLength: 0,
        maxLength: 4,
      }),
      async (histSize, rawRemovals) => {
        const svc = new HistoryService();
        seedHistory(svc, histSize);
        await svc.waitForTokenUpdates();

        const removals = densityFixture2_inRangeIndices(
          [...new Set(rawRemovals)],
          histSize,
        );
        const result = makeDensityResult(removals, new Map());
        await svc.applyDensityResult(result);
        await svc.waitForTokenUpdates();

        expect(svc.getTotalTokens()).toBeGreaterThanOrEqual(0);
      },
    ),
    property1: { numRuns: 5 },
  };
}
export function initializeDensityService(): void {
  densityFixture1_service = new HistoryService();
}

interface ReplacementObservation {
  readonly actual: IContent | undefined;
  readonly expected: IContent;
}
