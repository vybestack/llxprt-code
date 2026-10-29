/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { OpenAIResponsesProvider } from '../openai-responses/OpenAIResponsesProvider.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { normalizedRows } from './support/frozenWire/normalizedRows.js';
import {
  buildHistoryCallOptions,
  rowsSelection,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';

interface Scenario {
  readonly usage: boolean;
  readonly reject: boolean;
  readonly override?: unknown;
  readonly split: number;
  readonly model: string;
  readonly rows?: readonly IContent[];
}
interface CapturedRequest {
  readonly body: string;
  readonly length: string | null;
}
function history(usage: boolean): readonly IContent[] {
  return [
    { speaker: 'human', blocks: [{ type: 'text', text: 'before parent 雪' }] },
    {
      speaker: 'ai',
      metadata: {
        id: 'resp_parent',
        responsesStored: true,
        ...(usage
          ? {
              usage: {
                promptTokens: 100,
                completionTokens: 20,
                totalTokens: 120,
              },
            }
          : {}),
      },
      blocks: [
        {
          type: 'tool_call',
          id: 'call_parent',
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
          callId: 'call_parent',
          toolName: 'lookup',
          result: 'result 雪',
        },
      ],
    },
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 'generated reasoning 雪',
          encryptedContent: 'encrypted',
        },
        {
          type: 'thinking',
          thought: 'stored reasoning',
          encryptedContent: 'stored',
          providerMetadata: { 'openai.responses.reasoningId': 'rs_server' },
        },
        { type: 'text', text: 'after parent' },
        { type: 'tool_call', id: 'call_delta', name: 'lookup', parameters: {} },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'call_delta',
          toolName: 'lookup',
          result: { value: 'delta' },
        },
      ],
    },
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 'pure reasoning',
          encryptedContent: 'pure',
        },
      ],
    },
    { speaker: 'human', blocks: [{ type: 'text', text: 'next \\"\n\ud800' }] },
  ];
}

async function capture(
  selection: ProviderRequestSelection,
  scenario: Scenario,
): Promise<{
  requests: readonly CapturedRequest[];
  estimate: Awaited<ReturnType<typeof estimatePromptEnvelope>>;
}> {
  const route = WIRE_ROUTES.find((entry) => entry.id === 'openai-responses');
  if (route === undefined) throw new Error('Missing Responses route');
  const requests: CapturedRequest[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      requests.push({
        body: await request.text(),
        length: request.headers.get('content-length'),
      });
      if (scenario.reject && requests.length === 1)
        return Response.json(
          {
            error: {
              message: 'previous_response_id not found',
              type: 'invalid_request_error',
            },
          },
          { status: 400 },
        );
      return route.respond();
    },
  });
  const provider = new OpenAIResponsesProvider('test');
  const options = buildHistoryCallOptions(
    {
      ...route,
      baseURL: `http://127.0.0.1:${server.port}/v1`,
      model: scenario.model,
    },
    {
      id: 'stateful-native',
      description: 'stateful journal HTTP',
      rows: [],
      systemInstruction: 'system 雪',
      ephemerals: {
        'responses-stateful': true,
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'none',
        retries: 0,
        previous_response_id: 'caller-parent-must-not-leak',
        ...(scenario.override === undefined
          ? {}
          : { input: scenario.override }),
      },
    },
    'rows',
    new SettingsService(),
    selection,
  );
  const request = {
    ...options,
    metadata: { _retryRequestContext: { reasoningIdTime: 1780000000123 } },
  };
  try {
    const projection = await provider.projectPromptEnvelope(request);
    try {
      const estimate = await estimatePromptEnvelope(
        'openai-responses',
        projection,
        createRuntimeTokenizerFactory(),
      );
      for await (const chunk of provider.generateChatCompletion({
        ...request,
        promptEnvelopeTransportToken: projection.transportToken,
      }))
        void chunk;
      return { requests, estimate };
    } finally {
      await projection.releaseIfUnsent?.();
    }
  } finally {
    await server.stop(true);
  }
}

async function verify(
  scenario: Scenario,
): Promise<Awaited<ReturnType<typeof operationFileCreates>>> {
  const rows = scenario.rows ?? history(scenario.usage);
  const expected = await capture(
    rowsSelection(await normalizedRows(rows)),
    scenario,
  );
  const fixture = await journalSendFixture(
    rows.slice(0, scenario.split),
    rows.slice(scenario.split),
    {
      directory: 'tmp/responses-stateful/fixtures',
    },
  );
  try {
    let actual: Awaited<ReturnType<typeof capture>> | undefined;
    const created = await operationFileCreates(async () => {
      actual = await capture(fixture.selection, scenario);
    }, true);
    expect(actual).toStrictEqual(expected);
    expect(actual?.requests.length).toBe(scenario.reject ? 2 : 1);
    for (const sent of actual?.requests ?? [])
      expect(sent.length).toBe(String(Buffer.byteLength(sent.body)));
    expect(expected.requests[0]?.body).toContain(
      '"previous_response_id":"resp_parent"',
    );
    expect(expected.requests[0]?.body).not.toContain('before parent');
    expect(expected.estimate.statefulParentUsed).toBe(true);
    expect(
      expected.requests
        .slice(1)
        .map((sent) => sent.body.includes('previous_response_id')),
    ).toStrictEqual(scenario.reject ? [false] : []);
    expect(
      expected.requests
        .slice(1)
        .map((sent) => sent.body.includes('before parent')),
    ).toStrictEqual(scenario.reject ? [scenario.override === undefined] : []);
    return created;
  } finally {
    await fixture.close();
  }
}

describe('journal-native stateful Responses HTTP', () => {
  it.each([false, true])(
    'matches the disk body for a dangling parent call with following rows: %j',
    async (followingRows) => {
      const rows: readonly IContent[] = [
        ...history(true).slice(0, 2),
        ...(followingRows ? history(true).slice(-1) : []),
      ];
      const scenario: Scenario = {
        usage: true,
        reject: false,
        split: 2,
        model: 'gpt-5.6',
        rows,
      };
      const expected = await capture(
        rowsSelection(await normalizedRows(rows)),
        scenario,
      );
      const fixture = await journalSendFixture(
        rows.slice(0, 2),
        rows.slice(2),
        {
          directory: 'tmp/responses-stateful/fixtures',
        },
      );
      try {
        const actual = await capture(fixture.selection, scenario);
        expect(actual).toStrictEqual(expected);
        const body: unknown = JSON.parse(actual.requests[0].body);
        expect(body).toHaveProperty('previous_response_id', 'resp_parent');
        expect(body).toHaveProperty('input.0.type', 'function_call_output');
        expect(body).toHaveProperty('input.0.call_id', 'call_parent');
        expect(body).toHaveProperty('input.length', followingRows ? 2 : 1);
        expect(actual.requests[0].length).toBe(
          String(Buffer.byteLength(actual.requests[0].body)),
        );
      } finally {
        await fixture.close();
      }
    },
  );
  it('preserves unsupported-media diagnostics in a stateful estimate', async () => {
    const rows: readonly IContent[] = [
      ...history(true),
      {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            mimeType: 'audio/wav',
            encoding: 'base64',
            data: 'AQI=',
          },
        ],
      },
    ];
    expect(
      await verify({
        usage: true,
        reject: false,
        split: rows.length,
        model: 'gpt-5.6',
        rows,
      }),
    ).toStrictEqual({ files: [], directories: [] });
  });
  it('sends the synthetic output after a final parent tool call and recovers parentless', async () => {
    expect(
      await verify({
        usage: true,
        reject: true,
        split: 2,
        model: 'gpt-5.6',
        rows: history(true).slice(0, 2),
      }),
    ).toStrictEqual({ files: [], directories: [] });
  });
  it.each(
    ['gpt-5.2', 'gpt-5.6'].flatMap((model) =>
      [true, false].flatMap((usage) =>
        [true, false].flatMap((reject) =>
          [2, 7].map((split) => ({ usage, reject, split, model })),
        ),
      ),
    ),
  )(
    'preserves delta bytes, accounting and parentless recovery without files: $usage/$reject/$split',
    async (scenario) => {
      expect(await verify(scenario)).toStrictEqual({
        files: [],
        directories: [],
      });
    },
  );
  it.each(
    [
      'caller prompt 雪',
      [{ role: 'user', content: 'caller input replaces history' }],
    ].map((override) => ({ override })),
  )('streams caller input without files: %j', async ({ override }) => {
    expect(
      await verify({
        usage: true,
        reject: true,
        split: 6,
        override,
        model: 'gpt-5.6',
      }),
    ).toStrictEqual({ files: [], directories: [] });
  });
});
