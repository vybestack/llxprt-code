/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type {
  IContent,
  UsageStats,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { GenerateChatOptions } from '../IProvider.js';
import { requestSelection } from './__tests__/support/request-selection.js';
import { projectionRuntime } from './__tests__/support/projection-ownership-fixture.js';

const completed =
  'data: {"type":"response.output_text.delta","delta":"ok"}\n\n' +
  'data: {"type":"response.completed","response":{"id":"resp_s","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n';

const text = (speaker: 'human' | 'ai', value: string): IContent => ({
  speaker,
  blocks: [{ type: 'text', text: value }],
});

const parent = (id: string, usage?: UsageStats): IContent => ({
  ...text('ai', `answer ${id}`),
  metadata: {
    id,
    responsesStored: true,
    ...(usage === undefined ? {} : { usage }),
  },
});

const usage: UsageStats = {
  promptTokens: 10,
  completionTokens: 5,
  totalTokens: 15,
};

const histories: Record<string, readonly IContent[]> = {
  'a parent with observed usage': [
    text('human', 'one'),
    parent('resp_parent', usage),
    text('human', 'two "雪"'),
  ],
  'a parent without observed usage': [
    text('human', 'one'),
    parent('resp_parent'),
    text('human', 'two'),
  ],
  'the newest of two parents': [
    text('human', 'one'),
    parent('resp_old', usage),
    text('human', 'two'),
    parent('resp_new', usage),
    text('human', 'three'),
  ],
  'a parent as the last row': [text('human', 'one'), parent('resp_parent')],
  'no parent': [
    text('human', 'one'),
    text('ai', 'plain'),
    text('human', 'two'),
  ],
  'a parent from another endpoint': [
    text('human', 'one'),
    {
      ...parent('resp_foreign', usage),
      metadata: {
        id: 'resp_foreign',
        responsesStored: true,
        providerBaseURL: 'https://elsewhere.example/v1',
      },
    },
    text('human', 'two'),
  ],
};

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

function tmpPromptDirs(): Set<string> {
  return new Set(
    readdirSync(tmpdir()).filter((name) =>
      name.startsWith('responses-prompt-keys-'),
    ),
  );
}

describe('Responses source route stateful accounting', () => {
  const bodies: string[] = [];
  let rejectParent: string | undefined;
  let server: Bun.Server<undefined>;
  let setup: Setup;

  beforeEach(async () => {
    bodies.length = 0;
    rejectParent = undefined;
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request): Promise<Response> {
        const body = await request.text();
        bodies.push(body);
        const sent = (JSON.parse(body) as { previous_response_id?: string })
          .previous_response_id;
        if (sent !== undefined && sent === rejectParent)
          return new Response(
            `{"error":{"message":"Previous response with id '${sent}' not found.","param":"previous_response_id"}}`,
            { status: 400 },
          );
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
  });

  async function bothRoutes(
    list: readonly IContent[],
    ephemerals: Record<string, unknown>,
  ): Promise<string[]> {
    const before = tmpPromptDirs();
    const rows = rowsOf(list);
    await send(
      setup,
      withEphemerals(setup, setup.options(rows), ephemerals),
      false,
    );
    const arrayBodies = bodies.splice(0);
    const selection = requestSelection({ ...rows, close: () => {} });
    await send(
      setup,
      withEphemerals(setup, setup.options(selection), ephemerals),
      true,
    );
    expect(bodies).toStrictEqual(arrayBodies);
    expect(
      [...tmpPromptDirs()].filter((entry) => !before.has(entry)),
    ).toHaveLength(0);
    return arrayBodies;
  }

  for (const [name, list] of Object.entries(histories)) {
    it(`matches the array route bytes with ${name}`, async () => {
      const sent = await bothRoutes(list, { 'responses-stateful': true });
      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0])).toHaveProperty('store', true);
    }, 60000);
  }

  it('sends only the rows after the parent', async () => {
    const [sent] = await bothRoutes(histories['a parent with observed usage'], {
      'responses-stateful': true,
    });
    const body = JSON.parse(sent) as {
      previous_response_id: string;
      input: unknown[];
    };
    expect(body.previous_response_id).toBe('resp_parent');
    expect(body.input).toHaveLength(1);
  }, 60000);

  it('falls back to full history when the parent is the last row', async () => {
    const [sent] = await bothRoutes(histories['a parent as the last row'], {
      'responses-stateful': true,
    });
    const body = JSON.parse(sent) as {
      previous_response_id?: string;
      input: unknown[];
    };
    expect(body.previous_response_id).toBeUndefined();
    expect(body.input).toHaveLength(2);
  }, 60000);

  it('stays stateless without the responses-stateful option', async () => {
    const [sent] = await bothRoutes(
      histories['a parent with observed usage'],
      {},
    );
    expect(JSON.parse(sent)).not.toHaveProperty('previous_response_id');
  }, 60000);

  it('honours an explicit store=false by not chaining', async () => {
    const [sent] = await bothRoutes(histories['a parent with observed usage'], {
      'responses-stateful': true,
      store: false,
    });
    const body = JSON.parse(sent) as Record<string, unknown>;
    expect(body['previous_response_id']).toBeUndefined();
    expect(body['store']).toBe(false);
  }, 60000);

  it('retires a rejected parent and replays full history like the array route', async () => {
    const list = histories['a parent with observed usage'];
    rejectParent = 'resp_parent';
    const ephemerals = { 'responses-stateful': true };
    const rows = rowsOf(list);
    await send(
      setup,
      withEphemerals(setup, setup.options(rows), ephemerals),
      false,
    );
    const arrayBodies = bodies.splice(0);
    expect(arrayBodies).toHaveLength(2);
    expect(JSON.parse(arrayBodies[1])).not.toHaveProperty(
      'previous_response_id',
    );
    setup.provider.clearState();
    const selection = requestSelection({ ...rows, close: () => {} });
    await send(
      setup,
      withEphemerals(setup, setup.options(selection), ephemerals),
      true,
    );
    expect(bodies).toStrictEqual(arrayBodies);
  }, 60000);
});
