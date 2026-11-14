/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { callerOwnedRawProviderSource } from '@vybestack/llxprt-code-core/services/history/caller-owned-provider-request.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { sendThroughRoute, WIRE_ROUTES } from './support/wireBodyCapture.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';

const human: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'question' }],
};

describe('caller-owned Responses selection validation', () => {
  for (const route of WIRE_ROUTES.filter(
    (value) => value.endpoint === '/responses',
  )) {
    it(`${route.id} sends a stored parent without requiring journal metadata`, async () => {
      const rows: IContent[] = [
        human,
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'answer' }],
          metadata: { id: 'resp_prior', responsesStored: true },
        },
        { ...human, blocks: [{ type: 'text', text: 'follow up' }] },
      ];
      const selection =
        await callerOwnedRawProviderSource(rows).openProviderRequest();
      try {
        const creates = await operationFileCreates(async () => {
          const request = await sendThroughRoute(
            route,
            {
              id: 'caller-parent',
              description: 'stored parent',
              rows: [],
              ephemerals: { 'responses-stateful': true },
            },
            'rows',
            undefined,
            selection,
          );
          expect(
            JSON.parse(new TextDecoder().decode(request.bytes)),
          ).toMatchObject({
            previous_response_id: 'resp_prior',
            input: [{ role: 'user', content: 'follow up' }],
          });
        }, true);
        expect(creates).toStrictEqual({ files: [], directories: [] });
      } finally {
        await selection.close();
      }
    });
    it(`${route.id} retains an unanswered call and emits its cancellation result`, async () => {
      const selection = await callerOwnedRawProviderSource([
        human,
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_pending',
              name: 'read',
              parameters: { path: 'a' },
            },
          ],
        },
      ]).openProviderRequest();
      try {
        const creates = await operationFileCreates(async () => {
          const request = await sendThroughRoute(
            route,
            {
              id: 'caller-cancellation',
              description: 'unanswered call',
              rows: [],
            },
            'rows',
            undefined,
            selection,
          );
          expect(
            JSON.parse(new TextDecoder().decode(request.bytes)),
          ).toMatchObject({
            input: [
              { role: 'user', content: 'question' },
              {
                type: 'function_call',
                call_id: 'call_pending',
                name: 'read',
                arguments: '{"path":"a"}',
              },
              {
                type: 'function_call_output',
                call_id: 'call_pending',
                output: 'Tool execution cancelled by user',
              },
            ],
          });
        }, true);
        expect(creates).toStrictEqual({ files: [], directories: [] });
      } finally {
        await selection.close();
      }
    });
    it(`${route.id} refuses PDFs above the aggregate limit without creating files`, async () => {
      const data = Buffer.alloc(25_000_001).toString('base64');
      const selection = await callerOwnedRawProviderSource([
        {
          speaker: 'human',
          blocks: [
            {
              type: 'media',
              encoding: 'base64',
              mimeType: 'application/pdf',
              data,
            },
            {
              type: 'media',
              encoding: 'base64',
              mimeType: 'application/pdf',
              data,
            },
          ],
        },
      ]).openProviderRequest();
      try {
        const creates = await operationFileCreates(async () => {
          await expect(
            sendThroughRoute(
              {
                ...route,
                // Exercise the PDF limit after passing the separate media budget.
                createProvider: () =>
                  bindProviderMedia(
                    route.createProvider(),
                    undefined,
                    data.length * 2,
                  ),
              },
              {
                id: 'caller-pdf',
                description: 'aggregate PDF limit',
                rows: [],
              },
              'rows',
              undefined,
              selection,
            ),
          ).rejects.toThrow('50000002 bytes');
        }, true);
        expect(creates).toStrictEqual({ files: [], directories: [] });
      } finally {
        await selection.close();
      }
    });
  }
});
