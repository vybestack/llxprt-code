/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { BaseProvider } from '../BaseProvider.js';
import {
  callerOwnedProviderRequest,
  callerOwnedProviderSource,
} from '@vybestack/llxprt-code-core/services/history/caller-owned-provider-request.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import {
  buildHistoryCallOptions,
  rowsSelection,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';
import { normalizedRows } from './support/frozenWire/normalizedRows.js';

const rows: readonly IContent[] = [
  {
    speaker: 'human',
    metadata: { cacheAnchor: true },
    blocks: [
      { type: 'text', text: 'Describe 雪' },
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'YQ==',
      },
    ],
  },
  {
    speaker: 'ai',
    blocks: [
      { type: 'thinking', thought: 'reason', sourceField: 'reasoning_content' },
      {
        type: 'tool_call',
        id: 'call_a',
        name: 'lookup',
        parameters: { path: '雪' },
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
      {
        type: 'media',
        mimeType: 'image/png',
        encoding: 'base64',
        data: 'Yg==',
      },
    ],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'Explain' }] },
];

describe('caller-owned native provider rows', () => {
  for (const strip of ['none', 'allButLast', 'all']) {
    for (const route of WIRE_ROUTES) {
      it(`${route.id} ${strip} sends identical bytes without files`, async () => {
        const bodies: string[] = [];
        const lengths: Array<string | null> = [];
        const server = Bun.serve({
          hostname: '127.0.0.1',
          port: 0,
          async fetch(request) {
            bodies.push(await request.text());
            lengths.push(request.headers.get('content-length'));
            return route.respond();
          },
        });
        const selection = await callerOwnedProviderRequest(rows);
        async function send(
          requestRows: ProviderRequestSelection,
          source: 'selection' | 'stream' | 'array' = 'selection',
        ): Promise<void> {
          const options = buildHistoryCallOptions(
            { ...route, baseURL: `http://127.0.0.1:${server.port}/v1` },
            {
              id: 'caller',
              description: 'caller rows',
              rows: [],
              ephemerals: {
                'reasoning.includeInContext': true,
                'reasoning.stripFromContext': strip,
              },
            },
            'rows',
            new SettingsService(),
            requestRows,
          );
          const provider = route.createProvider();
          if (!(provider instanceof BaseProvider))
            throw new Error('Expected a concrete provider');
          for await (const chunk of provider.generateChatCompletion({
            ...options,
            ...(source === 'selection'
              ? {}
              : {
                  requestRows: undefined,
                  contents:
                    source === 'array' ? rows : callerOwnedProviderSource(rows),
                }),
            metadata: {
              _retryRequestContext: { reasoningIdTime: 1780000000123 },
            },
          }))
            void chunk;
        }
        try {
          await send(rowsSelection(await normalizedRows(rows)));
          const created = await operationFileCreates(
            () => send(selection),
            true,
          );
          expect(created).toStrictEqual({ files: [], directories: [] });
          expect(bodies).toHaveLength(2);
          expect(bodies[1]).toBe(bodies[0]);
          expect(lengths).toStrictEqual(
            bodies.map((body) => String(Buffer.byteLength(body))),
          );
          expect(bodies[1]).toContain('Yg==');
          const streamedCreates = await operationFileCreates(
            () => send(selection, 'stream'),
            true,
          );
          expect(streamedCreates).toStrictEqual({ files: [], directories: [] });
          expect(bodies[2]).toBe(bodies[0]);
          const arrayCreates = await operationFileCreates(
            () => send(selection, 'array'),
            true,
          );
          expect(arrayCreates).toStrictEqual({ files: [], directories: [] });
          expect(bodies).toHaveLength(4);
          expect(bodies[3]).toBe(bodies[0]);
          expect(lengths).toStrictEqual(
            bodies.map((body) => String(Buffer.byteLength(body))),
          );
        } finally {
          await selection.close();
          await server.stop(true);
        }
      });
    }
  }
});
