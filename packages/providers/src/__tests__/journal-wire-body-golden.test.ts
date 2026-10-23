/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withCoreSuffixFixture } from '@vybestack/llxprt-code-core/services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import { SemanticMediaPurgeStreamCoordinator } from '@vybestack/llxprt-code-core/services/history/semantic-purge-stream.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { forbidHistoryMaterializationForTest } from '@vybestack/llxprt-code-test-utils/core/history-materialization-test-guard.js';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import { closeInOrder } from './support/close-in-order.js';
import {
  buildRouteCallOptions,
  installFakeTransport,
  recordOf,
  singleModelRequest,
  WIRE_ROUTES,
  type CapturedWireRequest,
  type WireBodyRecord,
  type WireRoute,
} from './support/wireBodyCapture.js';
import { createCorpus, GoldenRecorder } from './support/wireBodyCorpus.js';
import { PINNED_CLOCK } from './support/wireBodyFixtures.js';
import type { HistoryCase } from './support/wireBodyHistories.js';

const corpus = await createCorpus();
const recorder = new GoldenRecorder(false);

async function captureRows(
  route: WireRoute,
  input: HistoryCase,
  rows: AsyncIterable<IContent>,
): Promise<WireBodyRecord> {
  const captured: CapturedWireRequest[] = [];
  const restore = installFakeTransport(route, captured);
  try {
    const created = route.createProvider();
    const provider =
      input.usesMediaReferences === true
        ? bindProviderMedia(
            created,
            corpus.binding.resolver,
            corpus.binding.budgetBytes,
          )
        : created;
    const options = buildRouteCallOptions(
      route,
      input,
      rows,
      new SettingsService(),
    );
    for await (const item of provider.generateChatCompletion(options))
      void item;
    return recordOf(singleModelRequest(route, captured));
  } finally {
    restore();
  }
}

function guardedHistory(
  options?: ConstructorParameters<typeof HistoryService>[0],
): HistoryService {
  const history = new HistoryService(options);
  forbidHistoryMaterializationForTest(
    history,
    'native wire golden materialized history',
  );
  return history;
}

async function captureJournal(
  route: WireRoute,
  input: HistoryCase,
): Promise<WireBodyRecord> {
  return withCoreSuffixFixture(
    input.rows.length,
    async (history) => {
      const tagged = input.rows.some(
        (row) => row.metadata?.semanticMediaPurgeBoundary !== undefined,
      );
      if (!tagged) return captureRows(route, input, history.streamRawHistory());
      const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
        enabled: true,
        explicitCacheWriteRequired: true,
      });
      const transaction = await coordinator.begin({ mode: 'remove' });
      if (transaction === undefined)
        throw new Error('Missing native purge transaction');
      let failure: { readonly error: unknown } | undefined;
      try {
        return await captureRows(route, input, transaction.requestRows(true));
      } catch (error) {
        failure = { error };
        throw error;
      } finally {
        await closeInOrder(failure, transaction);
      }
    },
    0,
    (index) => structuredClone(input.rows[index]),
    undefined,
    guardedHistory,
  );
}

describe('native HistoryService frozen request bytes', () => {
  beforeAll(() => setSystemTime(new Date(PINNED_CLOCK)));
  afterAll(async () => {
    setSystemTime();
    await corpus.dispose();
  });

  for (const route of WIRE_ROUTES) {
    describe(`route ${route.id}`, () => {
      for (const input of corpus.histories) {
        it(`${input.id} sends the frozen complete body and Content-Length from journal rows`, async () => {
          const actual = await captureJournal(route, input);
          expect(
            recorder.check(route.id, input.id, 'stream', actual),
          ).toBeUndefined();
        });
      }
    });
  }

  it('rejects a changed committed row through the real native source and transport', async () => {
    const input = corpus.histories[0];
    const changed = {
      ...input,
      rows: [
        ...input.rows,
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'native mutation control' }],
        },
      ],
    } satisfies HistoryCase;
    const actual = await captureJournal(WIRE_ROUTES[0], changed);
    expect(
      recorder.check(WIRE_ROUTES[0].id, input.id, 'stream', actual),
    ).toContain('bytes differ');
  });
});
