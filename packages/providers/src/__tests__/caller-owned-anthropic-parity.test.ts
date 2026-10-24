/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { callerOwnedProviderRequest } from '@vybestack/llxprt-code-core/services/history/caller-owned-provider-request.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import {
  WIRE_ROUTES,
  buildHistoryCallOptions,
  installFakeTransport,
  rowsSelection,
  type CapturedWireRequest,
} from './support/wireBodyCapture.js';
import { normalizedRows } from './support/frozenWire/normalizedRows.js';

const rows: readonly IContent[] = [
  {
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'Describe' },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: 'YQ==',
      },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'audio/wav',
        data: 'AAAA',
      },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'video/mp4',
        data: 'BBBB',
      },
    ],
  },
  {
    speaker: 'ai',
    blocks: [
      { type: 'tool_call', id: 'call_a', name: 'lookup', parameters: {} },
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
  { speaker: 'human', blocks: [{ type: 'text', text: 'Explain' }] },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'reason',
        sourceField: 'thinking',
        signature: 'signature',
      },
    ],
  },
  {
    speaker: 'ai',
    metadata: { cacheAnchor: true },
    blocks: [{ type: 'text', text: 'answer' }],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'Continue' }] },
];

describe('caller-owned Anthropic media and anchors', () => {
  for (const route of WIRE_ROUTES.filter(
    (route) => route.providerName === 'anthropic',
  )) {
    it(`${route.id} preserves request bytes and media estimates`, async () => {
      const factory = createRuntimeTokenizerFactory();
      await factory.prepareTokenizer?.(route.providerName, route.model);
      const selection = await callerOwnedProviderRequest(rows);
      const reference = rowsSelection(await normalizedRows(rows));
      const captured: CapturedWireRequest[] = [];
      const restore = installFakeTransport(route, captured);
      async function run(requestRows: typeof reference): Promise<unknown> {
        const provider = route.createProvider();
        const options = buildHistoryCallOptions(
          route,
          { id: 'media', description: 'media and anchor', rows: [] },
          'rows',
          new SettingsService(),
          requestRows,
        );
        const projection = await provider.projectPromptEnvelope?.(options);
        if (projection === undefined) throw new Error('Missing projection');
        const estimate = await estimatePromptEnvelope(
          provider.name,
          projection,
          factory,
        );
        for await (const chunk of provider.generateChatCompletion({
          ...options,
          promptEnvelopeTransportToken: projection.transportToken,
        }))
          void chunk;
        return { estimate, unsupportedMedia: projection.unsupportedMedia };
      }
      try {
        const expected = await run(reference);
        let actual: unknown;
        const creates = await operationFileCreates(async () => {
          actual = await run(selection);
        }, true);
        expect(creates).toStrictEqual({ files: [], directories: [] });
        expect(actual).toStrictEqual(expected);
        expect(captured).toHaveLength(2);
        expect(captured[1].bytes).toStrictEqual(captured[0].bytes);
        expect(captured[1].contentLength).toBe(
          String(captured[1].bytes.byteLength),
        );
      } finally {
        restore();
        await selection.close();
      }
    });
  }
});
