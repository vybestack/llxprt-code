/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { normalizedRows } from './support/frozenWire/normalizedRows.js';
import {
  buildHistoryCallOptions,
  rowsSelection,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

const rows: readonly IContent[] = [
  {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'question 雪\\"\n\ud800' }],
  },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'first',
        encryptedContent: 'encrypted-first',
        providerMetadata: { 'openai.responses.reasoningId': 'rs_first' },
      },
      { type: 'text', text: 'looking' },
      {
        type: 'tool_call',
        id: 'toolu_lookup',
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
        callId: 'toolu_lookup',
        toolName: 'lookup',
        result: { value: '雪\n' },
      },
    ],
  },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'last',
        encryptedContent: 'encrypted-last',
      },
      { type: 'text', text: 'answer' },
    ],
  },
];

async function captureSend(
  selection: ProviderRequestSelection,
  strip: string,
  routeId = 'openai-responses',
): Promise<{ body: string; length: string | null }> {
  const route = WIRE_ROUTES.find((entry) => entry.id === routeId);
  if (route === undefined) throw new Error('Missing Responses route');
  let body = '';
  let length: string | null = null;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      body = await request.text();
      length = request.headers.get('content-length');
      return route.respond();
    },
  });
  try {
    const options = buildHistoryCallOptions(
      {
        ...route,
        baseURL: `http://127.0.0.1:${server.port}/v1`,
        providerSettings: { ...route.providerSettings, apiMode: 'responses' },
      },
      {
        id: 'responses-native',
        description: 'native Responses',
        rows: [],
        systemInstruction: 'system 雪',
        ephemerals: {
          'responses-stateful': false,
          'reasoning.stripFromContext': strip,
          'reasoning.includeInContext': true,
        },
      },
      'rows',
      new SettingsService(),
      selection,
    );
    for await (const chunk of route.createProvider().generateChatCompletion({
      ...options,
      metadata: { _retryRequestContext: { reasoningIdTime: 1780000000123 } },
    }))
      void chunk;
    return { body, length };
  } finally {
    await server.stop(true);
  }
}

describe('native Responses production HTTP', () => {
  it.each(
    ['openai-responses', 'openai-responses-via-openai'].flatMap((route) =>
      ['none', 'all', 'allButLast'].flatMap((strip) =>
        [0, 2, rows.length].map((split) => ({ route, strip, split })),
      ),
    ),
  )(
    'matches existing $route bytes and length without creating files for $strip at tail split $split',
    async ({ route, strip, split }) => {
      const expected = await captureSend(
        rowsSelection(await normalizedRows(rows)),
        strip,
        route,
      );
      const fixture = await journalSendFixture(
        split === 0 ? [{ speaker: 'human', blocks: [] }] : rows.slice(0, split),
        rows.slice(split),
        {
          directory: 'tmp/responses-native/fixtures',
        },
      );
      try {
        let actual: Awaited<ReturnType<typeof captureSend>> | undefined;
        const created = await operationFileCreates(async () => {
          actual = await captureSend(fixture.selection, strip, route);
        }, true);
        expect(actual).toStrictEqual(expected);
        expect(actual?.length).toBe(String(Buffer.byteLength(expected.body)));
        expect(created).toStrictEqual({ files: [], directories: [] });
      } finally {
        await fixture.close();
      }
    },
  );
});
