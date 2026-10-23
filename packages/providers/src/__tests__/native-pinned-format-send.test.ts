/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { withCoreSuffixFixture } from '@vybestack/llxprt-code-core/services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import { normalizedRows } from './support/frozenWire/normalizedRows.js';
import {
  sendThroughRoute,
  WIRE_ROUTES,
  type WireRoute,
  type CapturedWireRequest,
} from './support/wireBodyCapture.js';

const rows: readonly IContent[] = [
  {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'original question 雪' }],
  },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'toolu_original',
        name: 'lookup',
        parameters: {},
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'toolu_original',
        toolName: 'lookup',
        result: 'original answer',
      },
    ],
  },
];
const later: IContent = {
  speaker: 'human',
  blocks: [
    { type: 'text', text: 'later question must not enter the old request' },
  ],
};
const shape = { id: 'pinned-fill', description: 'pinned format fill', rows };

async function mutateHistory(
  history: HistoryService,
  mutation: string,
): Promise<void> {
  if (mutation === 'append') await history.addBatch([later]);
  else if (mutation === 'clear') {
    await history.clear();
    await history.addBatch([later]);
  } else
    await history.detachedValues.transform(async (source, sink) => {
      let index = 0;
      for await (const row of source.streamRows()) {
        const ordinal = index++;
        if (ordinal === 0) await sink.removeValue(ordinal);
        else await sink.appendDerived(ordinal, row);
      }
    });
  await history.waitForCommit();
}

async function captureFormat(
  route: WireRoute,
  expectedRows: readonly IContent[],
  selection?: ProviderRequestSnapshot,
): Promise<CapturedWireRequest> {
  return sendThroughRoute(
    route,
    {
      ...shape,
      rows: selection === undefined ? await normalizedRows(expectedRows) : [],
    },
    'rows',
    undefined,
    selection,
  );
}

async function captureFormats(
  expectedRows: readonly IContent[],
  selection?: ProviderRequestSnapshot,
): Promise<readonly Uint8Array[]> {
  const bodies: Uint8Array[] = [];
  for (const route of WIRE_ROUTES)
    bodies.push((await captureFormat(route, expectedRows, selection)).bytes);
  return bodies;
}

describe('native pinned request format fills', () => {
  for (const mutation of ['append', 'purge', 'clear'])
    it.each([...WIRE_ROUTES])(
      `sends the selected old bytes after ${mutation} on $id`,
      async (route) => {
        await withCoreSuffixFixture(
          rows.length,
          async (history, ownership) => {
            const selected = await history.prepareCuratedForProviderSnapshot(
              [],
              {
                ownership,
              },
            );
            try {
              const expected = await captureFormat(route, rows);
              await mutateHistory(history, mutation);
              const actual = await captureFormat(route, rows, selected);
              expect(actual.bytes).toStrictEqual(expected.bytes);
              expect(actual.contentLength).toBe(String(expected.bytes.length));
            } finally {
              await selected.close();
            }
          },
          0,
          (index) => structuredClone(rows[index]),
          undefined,
          undefined,
          'journal',
        );
      },
    );

  it('keeps old bytes through successive fills after live format slots are reused', async () => {
    await withCoreSuffixFixture(
      rows.length,
      async (history, ownership) => {
        const selected = await history.prepareCuratedForProviderSnapshot([], {
          ownership,
        });
        try {
          await mutateHistory(history, 'append');
          const current = await history.prepareCuratedForProviderSnapshot([], {
            ownership,
          });
          try {
            const expectedCurrent = await captureFormats([...rows, later]);
            expect(
              await captureFormats([...rows, later], current),
            ).toStrictEqual(expectedCurrent);
            expect(await captureFormats(rows, selected)).toStrictEqual(
              await captureFormats(rows),
            );
            expect(
              await captureFormats([...rows, later], current),
            ).toStrictEqual(expectedCurrent);
          } finally {
            await current.close();
          }
        } finally {
          await selected.close();
        }
      },
      0,
      (index) => structuredClone(rows[index]),
      undefined,
      undefined,
      'journal',
    );
  });
});
