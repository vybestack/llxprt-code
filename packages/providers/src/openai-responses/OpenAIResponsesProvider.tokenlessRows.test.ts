/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * Issue #854: compression summary calls hand the Responses provider
 * `requestRows` with no prepared projection token. The provider prepares the
 * same projection the chat seam would, sends exactly one request whose bytes
 * equal the token-primed send, and never ends the stream without sending.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from '../IProvider.js';
import {
  textRow,
  trackedRequestRows,
} from '../__tests__/requestRowsTestSupport.js';
import { projectionRuntime } from './__tests__/support/projection-ownership-fixture.js';

const completed =
  'data: {"type":"response.output_text.delta","delta":"summary"}\n\n' +
  'data: {"type":"response.completed","response":{"id":"resp_tokenless","status":"completed","output":[]}}\n\n' +
  'data: [DONE]\n\n';

let server: Bun.Server<undefined>;
let root: string;
let bodies: string[];
let respondWithoutBody = false;

const rows = (): IContent[] => [
  textRow('question one about the project'),
  textRow('answer one with detail', 'ai'),
  textRow('Summarize this conversation.'),
];

async function textOf(
  stream: AsyncIterableIterator<IContent>,
): Promise<string> {
  let text = '';
  for await (const chunk of stream)
    for (const block of chunk.blocks)
      if (block.type === 'text') text += block.text;
  return text;
}

async function setupWith(retries: unknown) {
  const setup = await projectionRuntime(
    `http://127.0.0.1:${server.port}/v1`,
    root,
  );
  const base = setup.options(trackedRequestRows(rows()));
  if (base.runtime === undefined || base.settings === undefined)
    throw new Error('Missing fixture runtime');
  const options: GenerateChatOptions = {
    ...base,
    invocation: createRuntimeInvocationContext({
      runtime: base.runtime,
      settings: base.settings,
      providerName: setup.provider.name,
      ephemeralsSnapshot: {
        'prompt-caching': 'off',
        ...(retries === undefined ? {} : { retries }),
        retrywait: 0,
      },
    }),
  };
  return { setup, options };
}

describe('OpenAIResponsesProvider requestRows without a projection token', () => {
  beforeEach(() => {
    bodies = [];
    respondWithoutBody = false;
    root = mkdtempSync(join(tmpdir(), 'responses-tokenless-'));
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        bodies.push(await request.text());
        if (respondWithoutBody) return new Response(null, { status: 200 });
        return new Response(completed, {
          headers: { 'content-type': 'text/event-stream' },
        });
      },
    });
  });

  afterEach(async () => {
    await server.stop(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('prepares its own projection and sends the same bytes as a token-primed send', async () => {
    const { setup, options } = await setupWith(2);
    try {
      const own = await textOf(setup.provider.generateChatCompletion(options));
      expect(own).toBe('summary');
      expect(bodies).toHaveLength(1);

      const projection = await setup.provider.projectPromptEnvelope(options);
      const primed = await textOf(
        setup.provider.generateChatCompletion({
          ...options,
          promptEnvelopeTransportToken: projection.transportToken,
        }),
      );
      expect(primed).toBe('summary');
      expect(bodies).toHaveLength(2);
      expect(bodies[0]).toBe(bodies[1]);
      expect(JSON.parse(bodies[0]).input).toHaveLength(3);
    } finally {
      await setup.config.dispose();
    }
  });

  it('closes every row reader it opened', async () => {
    const { setup } = await setupWith(2);
    const tracked = trackedRequestRows(rows());
    try {
      await textOf(
        setup.provider.generateChatCompletion({
          ...setup.options(tracked),
        }),
      );
      expect(tracked.openReaders()).toBe(0);
      expect(bodies).toHaveLength(1);
    } finally {
      await setup.config.dispose();
    }
  });

  it('still makes the single initial attempt when retries is 0', async () => {
    const { setup, options } = await setupWith(0);
    try {
      const text = await textOf(setup.provider.generateChatCompletion(options));
      expect(text).toBe('summary');
      expect(bodies).toHaveLength(1);
    } finally {
      await setup.config.dispose();
    }
  });

  it('makes the single initial attempt with retries 0 on a token-primed send too', async () => {
    const { setup, options } = await setupWith(0);
    try {
      const projection = await setup.provider.projectPromptEnvelope(options);
      const text = await textOf(
        setup.provider.generateChatCompletion({
          ...options,
          promptEnvelopeTransportToken: projection.transportToken,
        }),
      );
      expect(text).toBe('summary');
      expect(bodies).toHaveLength(1);
    } finally {
      await setup.config.dispose();
    }
  });

  it('uses the default attempt budget when retries is not set', async () => {
    const { setup, options } = await setupWith(undefined);
    try {
      const text = await textOf(setup.provider.generateChatCompletion(options));
      expect(text).toBe('summary');
      expect(bodies).toHaveLength(1);
    } finally {
      await setup.config.dispose();
    }
  });

  it('fails with a clear error for an invalid retries setting instead of ending the stream empty', async () => {
    const { setup, options } = await setupWith(-1);
    try {
      await expect(
        textOf(setup.provider.generateChatCompletion(options)),
      ).rejects.toThrow('retries setting must be a non-negative integer');
      expect(bodies).toHaveLength(0);
    } finally {
      await setup.config.dispose();
    }
  });

  it('fails when the endpoint answers 200 with an empty body instead of ending the stream empty', async () => {
    respondWithoutBody = true;
    const { setup, options } = await setupWith(0);
    try {
      await expect(
        textOf(setup.provider.generateChatCompletion(options)),
      ).rejects.toThrow('without an accepted terminal response event');
      expect(bodies).toHaveLength(1);
    } finally {
      await setup.config.dispose();
    }
  });
});
