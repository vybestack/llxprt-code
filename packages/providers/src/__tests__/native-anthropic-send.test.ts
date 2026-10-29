/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import type { UnsupportedMediaEntry } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { AnthropicProvider } from '../anthropic/AnthropicProvider.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import { TEST_PROVIDER_CONFIG } from './providerTestConfig.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { normalizedRows } from './support/frozenWire/normalizedRows.js';
import {
  buildHistoryCallOptions,
  rowsSelection,
  WIRE_ROUTES,
  type WireRoute,
} from './support/wireBodyCapture.js';

const rows: readonly IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'question 雪 🐈' }] },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'first thought',
        sourceField: 'thinking',
        signature: 'sig',
      },
      { type: 'text', text: 'checking' },
      {
        type: 'tool_call',
        id: 'call_repeat-1',
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
        callId: 'call_repeat-1',
        toolName: 'lookup',
        result: 'first result',
      },
    ],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'again' }] },
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'thinking',
        thought: 'last thought',
        sourceField: 'thinking',
        signature: 'last-sig',
      },
      {
        type: 'tool_call',
        id: 'call_repeat-1',
        name: 'lookup',
        parameters: {},
      },
      { type: 'tool_call', id: 'call_orphan', name: 'lookup', parameters: {} },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'call_repeat-1',
        toolName: 'lookup',
        result: 'second result',
      },
    ],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'finish' }] },
];

function routeOf(): WireRoute {
  const route = WIRE_ROUTES.find((item) => item.id === 'anthropic-cache-off');
  if (route === undefined) throw new Error('Missing Anthropic route');
  return route;
}

async function localSink(): Promise<{
  readonly route: WireRoute;
  readonly requests: Array<{ body: string; length: string | undefined }>;
  close(): Promise<void>;
}> {
  const route = routeOf();
  const requests: Array<{ body: string; length: string | undefined }> = [];
  const server = createServer((request, response) => {
    void (async (): Promise<void> => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        if (!Buffer.isBuffer(chunk)) throw new Error('Expected HTTP bytes');
        chunks.push(chunk);
      }
      requests.push({
        body: Buffer.concat(chunks).toString('utf8'),
        length: request.headers['content-length'],
      });
      const reply = route.respond();
      response.writeHead(reply.status, Object.fromEntries(reply.headers));
      response.end(await reply.text());
    })().catch((error: unknown) =>
      response.destroy(
        error instanceof Error ? error : new Error(String(error)),
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing socket');
  return {
    route: { ...route, baseURL: `http://127.0.0.1:${address.port}` },
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
        server.closeAllConnections();
      }),
  };
}

async function send(
  route: WireRoute,
  selection: ProviderRequestSelection,
  strip: string,
  projected: boolean,
  authToken = 'test-api-key',
  observeUnsupported?: (entries: readonly UnsupportedMediaEntry[]) => void,
): Promise<number | undefined> {
  const provider = new AnthropicProvider(
    authToken,
    undefined,
    TEST_PROVIDER_CONFIG,
  );
  const callOptions = buildHistoryCallOptions(
    route,
    {
      id: 'native-anthropic',
      description: 'native Anthropic',
      rows: [],
      systemInstruction: 'Answer precisely 雪.',
      ephemerals: {
        'reasoning.enabled': true,
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': strip,
      },
    },
    'rows',
    new SettingsService(),
    selection,
  );
  const options = {
    ...callOptions,
    resolved: { ...callOptions.resolved, authToken },
  };
  const projection = projected
    ? await provider.projectPromptEnvelope(options)
    : undefined;
  if (projection !== undefined)
    observeUnsupported?.(projection.unsupportedMedia);
  try {
    const estimate =
      projection === undefined
        ? undefined
        : await estimatePromptEnvelope(
            provider.name,
            projection,
            createRuntimeTokenizerFactory(),
          );
    for await (const chunk of provider.generateChatCompletion({
      ...options,
      ...(projection === undefined
        ? {}
        : { promptEnvelopeTransportToken: projection.transportToken }),
    }))
      void chunk;
    return estimate?.estimatedPromptTokens;
  } finally {
    await projection?.releaseIfUnsent?.();
  }
}

describe('native Anthropic production HTTP', () => {
  for (const strip of ['none', 'all', 'allButLast']) {
    for (const projected of [false, true]) {
      it(`sends ${strip}, projected=${projected} with builder bytes and estimates without creating files`, async () => {
        const sink = await localSink();
        const fixture = await journalSendFixture(rows, [], {
          directory: `${import.meta.dir}/../../../../tmp/anthropic-native/fixtures`,
        });
        try {
          const expectedTokens = await send(
            sink.route,
            rowsSelection(await normalizedRows(rows)),
            strip,
            projected,
          );
          let actualTokens: number | undefined;
          const created = await operationFileCreates(async () => {
            actualTokens = await send(
              sink.route,
              fixture.selection,
              strip,
              projected,
            );
          }, true);
          expect(created).toStrictEqual({ files: [], directories: [] });
          expect(sink.requests).toHaveLength(2);
          expect(sink.requests[1]).toStrictEqual(sink.requests[0]);
          expect(sink.requests[1].length).toBe(
            String(Buffer.byteLength(sink.requests[1].body)),
          );
          expect(actualTokens).toBe(expectedTokens);
          expect(sink.requests[1].body).not.toContain('cache_control');
          expect(sink.requests[1].body).toContain(
            '[tool execution interrupted]',
          );
        } finally {
          await fixture.close();
          await sink.close();
        }
      });
    }
  }
  it('preserves the OAuth system prompt and context prefix without files', async () => {
    const oauthRows: readonly IContent[] = rows.map((row) => ({
      ...row,
      blocks: row.blocks.map((block) =>
        block.type === 'tool_call'
          ? { ...block, name: `llxprt_${block.name}` }
          : block,
      ),
    }));
    const sink = await localSink();
    const fixture = await journalSendFixture(oauthRows, [], {
      directory: `${import.meta.dir}/../../../../tmp/anthropic-native/fixtures`,
    });
    try {
      const token = 'sk-ant-oat-native';
      const expected = await send(
        sink.route,
        rowsSelection(await normalizedRows(oauthRows)),
        'none',
        true,
        token,
      );
      let actual: number | undefined;
      const created = await operationFileCreates(async () => {
        actual = await send(sink.route, fixture.selection, 'none', true, token);
      }, true);
      expect(created).toStrictEqual({ files: [], directories: [] });
      expect(sink.requests).toHaveLength(2);
      expect(sink.requests[1]).toStrictEqual(sink.requests[0]);
      expect(actual).toBe(expected);
      expect(sink.requests[1].body).toContain(
        "You are Claude Code, Anthropic's official CLI for Claude.",
      );
    } finally {
      await fixture.close();
      await sink.close();
    }
  });
});

describe('Anthropic media projection dispatch', () => {
  it('preserves unsupported media metadata and body bytes for journal rows', async () => {
    const mediaRows: readonly IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Describe this recording' },
          {
            type: 'media',
            mimeType: 'audio/wav',
            encoding: 'base64',
            data: 'AAAA',
          },
        ],
      },
    ];
    const sink = await localSink();
    const fixture = await journalSendFixture(mediaRows, [], {
      directory: `${import.meta.dir}/../../../../tmp/anthropic-native/fixtures`,
    });
    try {
      let expected: readonly UnsupportedMediaEntry[] = [];
      let actual: readonly UnsupportedMediaEntry[] = [];
      const expectedTokens = await send(
        sink.route,
        rowsSelection(await normalizedRows(mediaRows)),
        'none',
        true,
        'test-api-key',
        (entries) => {
          expected = entries;
        },
      );
      const actualTokens = await send(
        sink.route,
        fixture.selection,
        'none',
        true,
        'test-api-key',
        (entries) => {
          actual = entries;
        },
      );
      expect(expected).toHaveLength(1);
      expect(actual).toStrictEqual(expected);
      expect(actualTokens).toBe(expectedTokens);
      expect(sink.requests).toHaveLength(2);
      expect(sink.requests[1]).toStrictEqual(sink.requests[0]);
    } finally {
      await fixture.close();
      await sink.close();
    }
  });
});

describe('native Anthropic message shapes', () => {
  const histories: ReadonlyArray<{ name: string; rows: readonly IContent[] }> =
    [
      { name: 'empty history', rows: [] },
      {
        name: 'leading assistant',
        rows: [{ speaker: 'ai', blocks: [{ type: 'text', text: 'answer' }] }],
      },
      {
        name: 'merged user rows',
        rows: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'first 雪' }] },
          { speaker: 'human', blocks: [{ type: 'text', text: 'second' }] },
        ],
      },
      {
        name: 'legacy special strings',
        rows: [
          {
            speaker: 'human',
            blocks: [
              {
                type: 'text',
                text: 'literal <|endoftext|> and <|endofprompt|>',
              },
            ],
          },
        ],
      },
    ];
  it.each([...histories])(
    'preserves bytes and legacy estimates for $name without files',
    async (history) => {
      const sink = await localSink();
      const fixture = await journalSendFixture(history.rows, [], {
        directory: `${import.meta.dir}/../../../../tmp/anthropic-native/fixtures`,
      });
      try {
        const route = { ...sink.route, model: 'claude-sonnet-4' };
        const expected = await send(
          route,
          rowsSelection(await normalizedRows(history.rows)),
          'none',
          true,
        );
        let actual: number | undefined;
        const created = await operationFileCreates(async () => {
          actual = await send(route, fixture.selection, 'none', true);
        }, true);
        expect(created).toStrictEqual({ files: [], directories: [] });
        expect(sink.requests).toHaveLength(2);
        expect(sink.requests[1]).toStrictEqual(sink.requests[0]);
        expect(actual).toBe(expected);
      } finally {
        await fixture.close();
        await sink.close();
      }
    },
  );
});
