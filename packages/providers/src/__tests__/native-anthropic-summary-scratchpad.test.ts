import { createTestScratchOwner } from '@vybestack/llxprt-code-core/storage/__tests__/support/scratch-owner.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
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

const tokenizerScratchRoots = createTestScratchOwner();
const SNAPSHOT =
  '<state_snapshot><overall_goal>Ship #4128 雪</overall_goal></state_snapshot>';

function summary(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: {
      isSummary: true,
      synthetic: true,
      reason: 'compression-state-snapshot',
    },
  };
}

const reply: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'text', text: 'Continuing from the summary.' }],
};
const next: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'Next request' }],
};

interface CapturedRequest {
  readonly body: string;
  readonly length: string | undefined;
}

async function localSink(): Promise<{
  readonly route: WireRoute;
  readonly requests: CapturedRequest[];
  close(): Promise<void>;
}> {
  const route = WIRE_ROUTES.find((item) => item.id === 'anthropic-cache-off');
  if (route === undefined) throw new Error('Missing Anthropic route');
  const requests: CapturedRequest[] = [];
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
      const answer = route.respond();
      response.writeHead(answer.status, Object.fromEntries(answer.headers));
      response.end(await answer.text());
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
): Promise<number | undefined> {
  const provider = new AnthropicProvider(
    'test-api-key',
    undefined,
    TEST_PROVIDER_CONFIG,
  );
  const options = buildHistoryCallOptions(
    route,
    {
      id: 'summary-scratchpad',
      description: 'summary scratchpad',
      rows: [],
      systemInstruction: 'Answer precisely.',
    },
    'rows',
    new SettingsService(),
    selection,
  );
  const projection = await provider.projectPromptEnvelope(options);
  try {
    const estimate = await estimatePromptEnvelope(
      provider.name,
      projection,
      createRuntimeTokenizerFactory(tokenizerScratchRoots),
    );
    for await (const chunk of provider.generateChatCompletion({
      ...options,
      promptEnvelopeTransportToken: projection.transportToken,
    }))
      void chunk;
    return estimate.estimatedPromptTokens;
  } finally {
    await projection.releaseIfUnsent?.();
  }
}

describe('native Anthropic send of compression summaries with a scratchpad', () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly stored: readonly IContent[];
    readonly sent: readonly IContent[];
  }> = [
    {
      name: 'a summary whose scratchpad precedes the snapshot',
      stored: [
        summary(`<scratchpad>\nprivate review 🐈\n</scratchpad>\n${SNAPSHOT}`),
        reply,
        next,
      ],
      sent: [summary(SNAPSHOT), reply, next],
    },
    {
      name: 'a summary that holds nothing but an unterminated scratchpad',
      stored: [summary('<scratchpad>truncated reasoning'), reply, next],
      sent: [reply, next],
    },
  ];

  it.each([...cases])(
    'sends $name from the journal without the scratchpad and with an exact Content-Length',
    async ({ stored, sent }) => {
      const sink = await localSink();
      const fixture = await journalSendFixture(stored, [], {
        directory: `${import.meta.dir}/../../../../tmp/anthropic-native/fixtures`,
      });
      try {
        const expectedTokens = await send(
          sink.route,
          rowsSelection(await normalizedRows(sent)),
        );
        const actualTokens = await send(sink.route, fixture.selection);

        expect(sink.requests).toHaveLength(2);
        const [expected, actual] = sink.requests;
        expect(actual.body.toLowerCase()).not.toContain('scratchpad');
        expect(actual.length).toBe(String(Buffer.byteLength(actual.body)));
        expect(actual).toStrictEqual(expected);
        expect(actualTokens).toBe(expectedTokens);
      } finally {
        await fixture.close();
        await sink.close();
      }
    },
  );
});
