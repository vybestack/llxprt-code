/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { withCoreSuffixFixture } from '@vybestack/llxprt-code-core/services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { callerOwnedRawProviderSource } from '@vybestack/llxprt-code-core/services/history/caller-owned-provider-request.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import {
  SemanticMediaPurgeStreamCoordinator,
  type SemanticPurgeStreamTransaction,
} from '@vybestack/llxprt-code-core/services/history/semantic-purge-stream.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
import { expect } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { closeInOrder } from './close-in-order.js';
import {
  rawHistoryOf,
  settingsOf,
  type FrozenFormat,
  type FrozenSettings,
} from './frozenWire/frozenCases.js';
import {
  describeCaseDifference,
  fixtureCaseOf,
  readFrozenFixture,
} from './frozenWire/frozenFixture.js';
import { recordBody, type CaseOutcome } from './frozenWire/frozenSend.js';
import { normalizedRows } from './frozenWire/normalizedRows.js';
import { eagerProviderOracle } from './journal-provider-fixture.js';
import { referenceSeedOutcome } from './native-seed-reference.js';
import {
  buildRouteCallOptions,
  installFakeTransport,
  recordOf,
  singleModelRequest,
  type CapturedWireRequest,
} from './wireBodyCapture.js';
import type { HistoryCase } from './wireBodyHistories.js';

export function seedInput(format: FrozenFormat, seed: number): HistoryCase {
  const settings = settingsOf(format, seed);
  return {
    id: `seed-${seed}`,
    description: 'native full frozen corpus',
    rows: rawHistoryOf(format, seed),
    ephemerals: settings.ephemerals,
    ...(settings.systemInstruction === null
      ? {}
      : { systemInstruction: settings.systemInstruction }),
  };
}

export async function captureSeed(
  format: FrozenFormat,
  settings: FrozenSettings,
  input: HistoryCase,
  rows: AsyncIterable<IContent>,
  selection?: ProviderRequestSelection,
): Promise<CaseOutcome> {
  const route = {
    ...format.route,
    model: settings.model,
    providerSettings: {
      ...format.route.providerSettings,
      ...settings.providerSettings,
    },
  };
  const requests: CapturedWireRequest[] = [];
  const restore = installFakeTransport(route, requests);
  try {
    const options = buildRouteCallOptions(
      route,
      input,
      rows,
      new SettingsService(),
    );
    for await (const chunk of route.createProvider().generateChatCompletion({
      ...options,
      ...(selection === undefined
        ? {}
        : { requestRows: selection, contentCount: selection.count }),
    }))
      void chunk;
    const request = singleModelRequest(route, requests);
    recordOf(request);
    return recordBody(request.bytes, format.historyMember);
  } catch (error) {
    return { threw: error instanceof Error ? error.message : String(error) };
  } finally {
    restore();
  }
}

export function guardedSeedHistory(
  options?: ConstructorParameters<typeof HistoryService>[0],
): HistoryService {
  const history = new HistoryService(options);
  forbidHistoryMaterializationForTest(
    history,
    'full native seeds eagerly materialized history',
  );
  return history;
}

export function seedReceipt(value: unknown): void {
  const output = process.env.W23_SEED_RECEIPTS;
  if (output !== undefined)
    appendFileSync(output, JSON.stringify(value) + '\n');
}

async function seedReference(
  format: FrozenFormat,
  seed: number,
): Promise<{
  input: HistoryCase;
  settings: FrozenSettings;
  expected: ReturnType<typeof fixtureCaseOf>;
  serviceReference: CaseOutcome;
  excluded: number;
  sameBoundary: boolean;
}> {
  const input = seedInput(format, seed);
  const settings = settingsOf(format, seed);
  const frozen = readFrozenFixture(format.id);
  const expected = frozen.cases[seed];
  expect(frozen.settings[expected[1]]).toStrictEqual(settings);
  const providerRows =
    settings.form === 'raw' ? input.rows : await normalizedRows(input.rows);
  const providerReference = referenceSeedOutcome(
    format,
    settings,
    providerRows,
  );
  expect(
    describeCaseDifference(
      expected,
      fixtureCaseOf(seed, expected[1], providerReference),
    ),
  ).toBeUndefined();
  const serviceRows = eagerProviderOracle(input).rows;
  const serviceReference = referenceSeedOutcome(format, settings, serviceRows);
  const excluded =
    input.rows.length -
    buildCuratedHistory(new DebugLogger('seed-exclusions'), input.rows, false)
      .length;
  const sameBoundary = isDeepStrictEqual(serviceRows, providerRows);
  return {
    input,
    settings,
    expected,
    serviceReference,
    excluded,
    sameBoundary,
  };
}

function recordSeedComparison(
  format: FrozenFormat,
  seed: number,
  settings: FrozenSettings,
  excluded: number,
  sameBoundary: boolean,
  providerActual: CaseOutcome,
  serviceActual: CaseOutcome,
  serviceReference: CaseOutcome,
): void {
  let boundary = 'raw-provider-versus-service-normalization';
  if (excluded > 0) boundary = 'invalid-ai-excluded-before-normalization';
  if (sameBoundary) boundary = 'same-provider-and-service';
  seedReceipt({
    kind: 'native-format',
    format: format.id,
    seed,
    form: settings.form,
    excludedInvalidAi: excluded,
    boundary,
    providerActual,
    serviceActual,
    serviceReference,
  });
}

function assertSameFrozenBoundary(
  seed: number,
  expected: ReturnType<typeof fixtureCaseOf>,
  actual: CaseOutcome,
  sameBoundary: boolean,
): void {
  if (sameBoundary)
    expect(
      describeCaseDifference(
        expected,
        fixtureCaseOf(seed, expected[1], actual),
      ),
    ).toBeUndefined();
}

async function prepareSeedProvider(
  input: HistoryCase,
): Promise<ProviderRequestSelection> {
  return callerOwnedRawProviderSource(
    await normalizedRows(input.rows),
  ).openProviderRequest();
}

async function seedPurgeTransaction(
  history: HistoryService,
  input: HistoryCase,
): Promise<SemanticPurgeStreamTransaction | undefined> {
  const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
    enabled: input.rows.some(
      (row) => row.metadata?.semanticMediaPurgeBoundary !== undefined,
    ),
    explicitCacheWriteRequired: true,
  });
  return coordinator.begin({ mode: 'remove' });
}

async function transactionSeedReference(
  format: FrozenFormat,
  settings: FrozenSettings,
  input: HistoryCase,
  transaction: SemanticPurgeStreamTransaction | undefined,
  serviceReference: CaseOutcome,
  sameBoundary: boolean,
): Promise<{ serviceReference: CaseOutcome; sameBoundary: boolean }> {
  if (transaction === undefined) return { serviceReference, sameBoundary };
  const rows: IContent[] = [];
  for await (const row of transaction.requestRows(true)) rows.push(row);
  const serviceRows = eagerProviderOracle({ ...input, rows }).rows;
  const providerRows =
    settings.form === 'raw' ? input.rows : await normalizedRows(input.rows);
  return {
    serviceReference: referenceSeedOutcome(format, settings, serviceRows),
    sameBoundary: isDeepStrictEqual(serviceRows, providerRows),
  };
}

export async function checkNativeSeed(
  format: FrozenFormat,
  seed: number,
): Promise<void> {
  const reference = await seedReference(format, seed);
  const { input, settings, expected, excluded } = reference;
  await withCoreSuffixFixture(
    input.rows.length,
    async (history, ownership, counters) => {
      const transaction = await seedPurgeTransaction(history, input);
      const { serviceReference, sameBoundary } = await transactionSeedReference(
        format,
        settings,
        input,
        transaction,
        reference.serviceReference,
        reference.sameBoundary,
      );
      const open = transaction?.providerSnapshotOpener(true);
      const service = await (open?.([], { ownership }) ??
        history.prepareCuratedForProviderSnapshot([], { ownership }));
      const provider =
        settings.form === 'normalized'
          ? await prepareSeedProvider(input)
          : undefined;
      let failure: { readonly error: unknown } | undefined;
      try {
        const providerActual = await captureSeed(
          format,
          settings,
          input,
          provider?.openReader() ?? callerOwnedRawProviderSource(input.rows),
          provider,
        );
        const serviceActual = await captureSeed(
          format,
          settings,
          input,
          service.openReader(),
          service,
        );
        recordSeedComparison(
          format,
          seed,
          settings,
          excluded,
          sameBoundary,
          providerActual,
          serviceActual,
          serviceReference,
        );
        expect(
          describeCaseDifference(
            expected,
            fixtureCaseOf(seed, expected[1], providerActual),
          ),
        ).toBeUndefined();
        expect(serviceActual).toStrictEqual(serviceReference);
        assertSameFrozenBoundary(seed, expected, serviceActual, sameBoundary);
        expect(ownership.snapshot().liveRows).toBe(0);
        expect(counters.snapshot().peakDecodedRows).toBe(0);
      } catch (error) {
        failure = { error };
        throw error;
      } finally {
        await closeInOrder(failure, provider, service, transaction);
        expect(() => service.openReader()).toThrow('closed');
        expect(ownership.snapshot().liveRows).toBe(0);
      }
    },
    0,
    (index) => structuredClone(input.rows[index]),
    undefined,
    guardedSeedHistory,
  );
}
