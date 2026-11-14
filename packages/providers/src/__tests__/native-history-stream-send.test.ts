/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  createCoreSuffixFixtureGraph,
  withCoreSuffixFixture,
} from '@vybestack/llxprt-code-core/services/history/__tests__/support/core-suffix-fixture-test-helpers.js';
import { acquireRequestRows } from '../utils/requestRowsLease.js';
import { providerRowsOf } from '../utils/providerRows.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import {
  buildHistoryCallOptions,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';
import { createHash } from 'node:crypto';

const rows: IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'Find the value' }] },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'call_a',
        name: 'lookup',
        parameters: { value: 1 },
      },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call_a',
        toolName: 'lookup',
        result: 'found',
      },
    ],
  },
];
const pending: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'Explain it' }],
};

describe('journal history stream provider admission', () => {
  it('keeps the producer cancellation signal when the request has its own signal', async () => {
    await withCoreSuffixFixture(1, async (history) => {
      const producer = new AbortController();
      const request = new AbortController();
      const scope = acquireRequestRows(
        history.getCuratedForProviderStream([], producer.signal),
        undefined,
        request.signal,
      );
      producer.abort(new Error('producer cancelled'));
      try {
        await expect(providerRowsOf(scope.options)).rejects.toThrow(
          'producer cancelled',
        );
      } finally {
        await scope.close();
      }
    });
  });

  it('reopens a shared native selection and releases its indexed pin with the lease', async () => {
    await withCoreSuffixFixture(1, async (history) => {
      const scope = acquireRequestRows(history.getCuratedForProviderStream());
      const selected = await providerRowsOf(scope.options);
      const reopened = await providerRowsOf(scope.options);
      expect(reopened.native).toBe(selected.native);
      expect(await reopened.readAt(0)).toStrictEqual(await selected.readAt(0));
      await scope.close();
      expect(() => selected.native?.indexed.readAt(0)).toThrow('closed');
    });
  });

  for (const route of WIRE_ROUTES) {
    it(`${route.id} preserves native request bytes without staging a history stream`, async () => {
      const parent = join(process.cwd(), 'tmp/scratch-removal2/history-stream');
      mkdirSync(parent, { recursive: true });
      const graph = createCoreSuffixFixtureGraph(
        mkdtempSync(join(parent, 'fixture-')),
      );
      const requests: Array<{
        readonly bytes: number;
        readonly sha256: string;
        readonly contentLength: string | null;
      }> = [];
      const server = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        async fetch(request) {
          const bytes = Buffer.from(await request.arrayBuffer());
          requests.push({
            bytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            contentLength: request.headers.get('content-length'),
          });
          return route.respond();
        },
      });
      const localRoute = {
        ...route,
        baseURL: `http://127.0.0.1:${server.port}/v1`,
        providerSettings: {
          ...route.providerSettings,
          ...(route.id.includes('responses') ? { apiMode: 'responses' } : {}),
        },
      };
      try {
        await graph.seed(rows);
        const selection = await graph.service.prepareCuratedForProviderSnapshot(
          [pending],
        );
        const options = buildHistoryCallOptions(
          localRoute,
          { id: 'stream', description: 'history stream', rows: [] },
          'rows',
          new SettingsService(),
          selection,
        );
        for await (const chunk of route
          .createProvider()
          .generateChatCompletion(options))
          void chunk;
        await selection.close();
        const { requestRows: _selection, ...streamOptions } = options;
        const created = await operationFileCreates(async () => {
          for await (const chunk of route
            .createProvider()
            .generateChatCompletion({
              ...streamOptions,
              contents: graph.service.getCuratedForProviderStream([pending]),
            }))
            void chunk;
        }, true);
        expect(created).toStrictEqual({ files: [], directories: [] });
        expect(requests).toHaveLength(2);
        expect(requests[1]).toStrictEqual(requests[0]);
      } finally {
        await server.stop(true);
        await graph.service.dispose();
        await graph.recording.dispose();
      }
    });
  }
});
