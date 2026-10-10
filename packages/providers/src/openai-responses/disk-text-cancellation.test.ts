/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { GenerateChatOptions } from '../IProvider.js';
import { activeRequestBodyCount } from '../utils/requestScopedBody.js';
import { requestSelection } from './__tests__/support/request-selection.js';
import { projectionRuntime } from './__tests__/support/projection-ownership-fixture.js';

const completed =
  'data: {"type":"response.output_text.delta","delta":"ok"}\n\n' +
  'data: {"type":"response.completed","response":{"id":"resp_c","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n';

const parent: IContent = {
  speaker: 'ai',
  blocks: [
    { type: 'text', text: 'answer' },
    { type: 'tool_call', id: 'hist_call_1', name: 'ls', parameters: {} },
  ],
  metadata: { id: 'resp_parent', responsesStored: true },
};

const history: readonly IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'one' }] },
  parent,
];

const scenarios: Record<string, Record<string, unknown>> = {
  'a stateful parent with dangling tool calls': { 'responses-stateful': true },
  'an input override': { input: [{ role: 'user', content: 'override' }] },
  'a streamed request dump': { dumpcontext: 'on' },
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

function promptDirs(): Set<string> {
  return new Set(
    readdirSync(tmpdir()).filter((name) =>
      name.startsWith('responses-prompt-keys-'),
    ),
  );
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

describe('Responses source route cancellation cleanup', () => {
  let bodies = 0;
  let server: Bun.Server<undefined>;
  let setup: Setup;
  let before: Set<string>;

  beforeEach(async () => {
    bodies = 0;
    before = promptDirs();
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request): Promise<Response> {
        await request.text();
        bodies++;
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

  function released(): void {
    expect(activeRequestBodyCount()).toBe(0);
    expect([...promptDirs()].filter((name) => !before.has(name))).toHaveLength(
      0,
    );
  }

  for (const [name, ephemerals] of Object.entries(scenarios)) {
    const prepare = (
      signal?: AbortSignal,
    ): { options: GenerateChatOptions } => {
      const selection = requestSelection({
        ...rowsOf(history),
        close: () => {},
      });
      return {
        options: withEphemerals(
          setup,
          setup.options(selection, signal),
          ephemerals,
        ),
      };
    };

    it(`releases ${name} when aborted before the first pull`, async () => {
      const controller = new AbortController();
      controller.abort(new Error('stop before pull'));
      const { options } = prepare(controller.signal);
      await expect(
        setup.provider.projectPromptEnvelope(options),
      ).rejects.toThrow('stop before pull');
      expect(bodies).toBe(0);
      released();
    }, 60000);

    it(`releases ${name} when the consumer returns before the first next`, async () => {
      const { options } = prepare();
      const projection = await setup.provider.projectPromptEnvelope(options);
      const stream = setup.provider.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      });
      await stream.return?.();
      await projection.releaseIfUnsent?.();
      expect(bodies).toBe(0);
      released();
    }, 60000);

    it(`releases ${name} when the consumer returns after the first chunk`, async () => {
      const { options } = prepare();
      const projection = await setup.provider.projectPromptEnvelope(options);
      const stream = setup.provider.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      });
      expect((await stream.next()).done).toBe(false);
      await stream.return?.();
      expect(bodies).toBe(1);
      released();
    }, 60000);
  }
});
