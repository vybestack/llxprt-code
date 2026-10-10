/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { GenerateChatOptions } from '../IProvider.js';
import { requestSelection } from './__tests__/support/request-selection.js';
import { sanitizeDiagnosticData } from '../utils/mediaDiagnostics.js';
import { projectionRuntime } from './__tests__/support/projection-ownership-fixture.js';

const completed =
  'data: {"type":"response.output_text.delta","delta":"ok"}\n\n' +
  'data: {"type":"response.completed","response":{"id":"resp_o","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n';

const history: readonly IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'list "files" 雪' }] },
  {
    speaker: 'ai',
    blocks: [
      { type: 'tool_call', id: 'hist_tool_ls', name: 'ls', parameters: {} },
    ],
  },
  {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'hist_tool_ls',
        toolName: 'ls',
        result: 'a.txt',
      },
    ],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'thanks' }] },
];

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

type Setup = Awaited<ReturnType<typeof projectionRuntime>>;

function withEphemerals(
  setup: Setup,
  options: GenerateChatOptions,
  ephemerals: Record<string, unknown>,
): GenerateChatOptions {
  if (options.runtime === undefined || options.settings === undefined)
    throw new Error('Missing fixture runtime');
  return {
    ...options,
    invocation: createRuntimeInvocationContext({
      runtime: options.runtime,
      settings: options.settings,
      providerName: setup.provider.name,
      ephemeralsSnapshot: ephemerals,
    }),
  };
}

async function send(
  setup: Setup,
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

describe('Responses source route request overrides and dumps', () => {
  const bodies: string[] = [];
  let cacheHome = '';
  let previousCacheHome: string | undefined;
  let server: Bun.Server<undefined>;
  let setup: Setup;
  let failWith: number | undefined;

  beforeEach(async () => {
    bodies.length = 0;
    failWith = undefined;
    cacheHome = mkdtempSync(join(tmpdir(), 'responses-override-cache-'));
    previousCacheHome = process.env['LLXPRT_CACHE_HOME'];
    process.env['LLXPRT_CACHE_HOME'] = cacheHome;
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request): Promise<Response> {
        bodies.push(await request.text());
        if (failWith !== undefined)
          return new Response('{"error":{"message":"rejected"}}', {
            status: failWith,
            headers: { 'content-type': 'application/json' },
          });
        return new Response(completed, {
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    });
    setup = await projectionRuntime(
      `http://127.0.0.1:${server.port}/v1`,
      process.cwd(),
    );
  });

  afterEach(async () => {
    await server.stop(true);
    await setup.config.dispose();
    if (previousCacheHome === undefined)
      delete process.env['LLXPRT_CACHE_HOME'];
    else process.env['LLXPRT_CACHE_HOME'] = previousCacheHome;
    rmSync(cacheHome, { recursive: true, force: true });
  });

  function dumpBodies(): unknown[] {
    const dir = join(cacheHome, 'dumps');
    return readdirSync(dir)
      .filter((name) => name.endsWith('-request.json'))
      .map(
        (name) =>
          (
            JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
              request: { body: unknown };
            }
          ).request.body,
      );
  }

  it('sends an input override in place of the rows', async () => {
    const override = { input: [{ role: 'user', content: 'override "雪"' }] };
    const selection = requestSelection({ ...rowsOf(history), close: () => {} });
    await send(
      setup,
      withEphemerals(setup, setup.options(selection), override),
      true,
    );
    expect(bodies).toHaveLength(1);
    expect(JSON.parse(bodies[0])).toStrictEqual({
      model: 'gpt-5.6',
      input: [{ role: 'user', content: 'override "雪"' }],
      stream: true,
      instructions: 'Read rows. Preserve "quotes", \\ and 雪.',
    });
  }, 60000);

  it('keeps the input override in model params across consecutive requests', async () => {
    const override = { input: [{ role: 'user', content: 'override twice' }] };
    const options = withEphemerals(
      setup,
      setup.options(requestSelection({ ...rowsOf(history), close: () => {} })),
      override,
    );
    await send(setup, options, true);
    const again = {
      ...options,
      requestRows: requestSelection({ ...rowsOf(history), close: () => {} }),
    };
    await send(setup, again, true);
    expect(bodies).toHaveLength(2);
    for (const body of bodies)
      expect((JSON.parse(body) as { input: unknown }).input).toStrictEqual([
        { role: 'user', content: 'override twice' },
      ]);
    expect(options.invocation?.modelParams['input']).toStrictEqual([
      { role: 'user', content: 'override twice' },
    ]);
  }, 60000);

  it('streams a request dump whose body equals the array route wire body', async () => {
    const dump = { dumpcontext: 'on' };
    const rows = rowsOf(history);
    await send(setup, withEphemerals(setup, setup.options(rows), dump), false);
    const arrayWire: unknown = JSON.parse(bodies.splice(0)[0]);
    rmSync(join(cacheHome, 'dumps'), { recursive: true, force: true });
    const selection = requestSelection({ ...rows, close: () => {} });
    await send(
      setup,
      withEphemerals(setup, setup.options(selection), dump),
      true,
    );
    const sourceDumps = dumpBodies();
    expect(sourceDumps).toHaveLength(1);
    expect(sourceDumps[0]).toStrictEqual(arrayWire);
    expect(JSON.parse(bodies[0])).toStrictEqual(arrayWire);
  }, 60000);

  const png = Buffer.from('not really a png but base64 bytes'.repeat(40));
  const mediaHistory: readonly IContent[] = [
    ...history,
    {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'look' },
        {
          type: 'media',
          mimeType: 'image/png',
          encoding: 'base64',
          data: png.toString('base64'),
        },
      ],
    },
  ];

  async function sendWithDump(
    mode: 'on' | 'error',
    status: number | undefined,
    viaSource: boolean,
  ): Promise<string[]> {
    rmSync(join(cacheHome, 'dumps'), { recursive: true, force: true });
    failWith = status;
    const rows = rowsOf(mediaHistory);
    const options = withEphemerals(
      setup,
      setup.options(
        viaSource ? requestSelection({ ...rows, close: () => {} }) : rows,
      ),
      { dumpcontext: mode },
    );
    await send(setup, options, viaSource).catch(() => undefined);
    const dir = join(cacheHome, 'dumps');
    return readdirSync(dir)
      .filter((name) => name.endsWith('-request.json'))
      .map((name) => readFileSync(join(dir, name), 'utf8'));
  }

  function bodyText(dump: string): string {
    const body = (JSON.parse(dump) as { request: { body: unknown } }).request
      .body;
    return JSON.stringify(body);
  }

  it.each([
    ['success dump', 'on', undefined],
    ['error-only dump', 'error', 400],
  ] as const)(
    'writes the sanitized wire body with summarized media for a %s on the source route',
    async (_name, mode, status) => {
      await sendWithDump('on', undefined, false);
      const wire: unknown = JSON.parse(bodies.splice(0)[0]);
      const expected = JSON.stringify(sanitizeDiagnosticData(wire));
      expect(expected).toContain('"contentId":"sha256:');
      expect(expected).toContain('"byteCount":');
      expect(expected).not.toContain(png.toString('base64').slice(0, 64));
      const sourceDumps = await sendWithDump(mode, status, true);
      expect(sourceDumps).toHaveLength(1);
      expect(bodyText(sourceDumps[0])).toBe(expected);
    },
    60000,
  );
});
