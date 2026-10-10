/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { GenerateChatOptions } from '../IProvider.js';
import { requestSelection } from './__tests__/support/request-selection.js';
import { projectionRuntime } from './__tests__/support/projection-ownership-fixture.js';

const completed =
  'data: {"type":"response.output_text.delta","delta":"ok"}\n\n' +
  'data: {"type":"response.completed","response":{"id":"resp_features","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n';

function captureServer(failFirst: boolean): {
  server: Bun.Server<undefined>;
  bodies: string[];
} {
  const bodies: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      bodies.push(await request.text());
      if (failFirst && bodies.length === 1)
        return new Response('{"error":{"message":"retry"}}', { status: 503 });
      return new Response(completed, {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  return { server, bodies };
}

function rowsOf(list: readonly IContent[]): ProviderRequestRows {
  return {
    count: list.length,
    async *openReader(signal?: AbortSignal): AsyncGenerator<IContent, void> {
      for (const row of list) {
        signal?.throwIfAborted();
        yield structuredClone(row);
      }
    },
  };
}

const image = {
  type: 'media' as const,
  mimeType: 'image/png',
  encoding: 'base64' as const,
  data: 'YQ==',
};

const fixtures: Record<string, readonly IContent[]> = {
  'tool call and result': [
    { speaker: 'human', blocks: [{ type: 'text', text: 'list files' }] },
    {
      speaker: 'ai',
      blocks: [
        { type: 'text', text: 'looking' },
        {
          type: 'tool_call',
          id: 'hist_tool_call_one',
          name: 'ls',
          parameters: { path: '"/tmp" \\ 雪' },
        },
        {
          type: 'tool_call',
          id: 'hist_tool_call_two',
          name: 'cat',
          parameters: { path: 'a' },
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'hist_tool_call_two',
          toolName: 'cat',
          result: { text: 'second' },
        },
        {
          type: 'tool_response',
          callId: 'hist_tool_call_one',
          toolName: 'ls',
          result: 'first',
        },
      ],
    },
    { speaker: 'ai', blocks: [{ type: 'text', text: 'done' }] },
    { speaker: 'human', blocks: [{ type: 'text', text: 'thanks' }] },
  ],
  'media and tool result media': [
    { speaker: 'human', blocks: [{ type: 'text', text: 'see' }, image] },
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'hist_tool_call_shot',
          name: 'shot',
          parameters: {},
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'hist_tool_call_shot',
          toolName: 'shot',
          result: 'captured',
        },
        image,
      ],
    },
    { speaker: 'human', blocks: [{ type: 'text', text: 'next' }] },
  ],
  reasoning: [
    { speaker: 'human', blocks: [{ type: 'text', text: 'think' }] },
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'thinking',
          thought: 'summary',
          encryptedContent: 'enc-payload',
          providerMetadata: { 'openai.responses.reasoningId': 'rs_abc' },
        },
        {
          type: 'thinking',
          thought: 'local',
          encryptedContent: 'enc-local',
        },
        { type: 'text', text: 'answer' },
      ],
    },
    { speaker: 'human', blocks: [{ type: 'text', text: 'again' }] },
  ],
};

const tools = [
  {
    name: 'ls',
    description: 'list',
    parametersJsonSchema: {
      type: 'object' as const,
      properties: { path: { type: 'string' as const } },
    },
  },
];

function tmpPromptDirs(): Set<string> {
  return new Set(
    readdirSync(tmpdir()).filter((name) =>
      name.startsWith('responses-prompt-keys-'),
    ),
  );
}

async function send(
  setup: Awaited<ReturnType<typeof projectionRuntime>>,
  options: GenerateChatOptions,
  viaSource: boolean,
): Promise<void> {
  if (!viaSource) {
    for await (const _ of setup.provider.generateChatCompletion(options));
    return;
  }
  const projection = await setup.provider.projectPromptEnvelope(options);
  for await (const _ of setup.provider.generateChatCompletion({
    ...options,
    promptEnvelopeTransportToken: projection.transportToken,
  }));
}

describe('Responses source route covers non-text features', () => {
  for (const [name, list] of Object.entries(fixtures)) {
    for (const withTools of [false, true]) {
      it(`matches the array route bytes for ${name}${withTools ? ' with tools' : ''}, including a 503 replay`, async () => {
        const before = tmpPromptDirs();
        const http = captureServer(true);
        const setup = await projectionRuntime(
          `http://127.0.0.1:${http.server.port}/v1`,
          process.cwd(),
        );
        try {
          const extra = withTools ? { tools } : {};
          const rows = rowsOf(list);
          await send(setup, { ...setup.options(rows), ...extra }, false);
          const arrayBodies = http.bodies.splice(0);
          const selection = requestSelection({
            ...rows,
            close: () => {},
          });
          await send(setup, { ...setup.options(selection), ...extra }, true);
          expect(arrayBodies).toHaveLength(2);
          expect(arrayBodies[0]).toBe(arrayBodies[1]);
          expect(http.bodies).toStrictEqual(arrayBodies);
          expect(
            [...tmpPromptDirs()].filter((entry) => !before.has(entry)),
          ).toHaveLength(0);
        } finally {
          await http.server.stop(true);
          await setup.config.dispose();
        }
      }, 60000);
    }
  }
});
