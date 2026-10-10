/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { Gpt56SourceProjection } from '../tokenizers/gpt56-source-projection.js';
import { tmpdir } from 'node:os';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { requestSelection } from './__tests__/support/request-selection.js';
import { withGpt56DiskSources } from '../tokenizers/gpt56-disk-tokenizer-factory.js';
import { diskTextFixture } from './__tests__/support/disk-text-fixture.js';
import { projectionRuntime } from './__tests__/support/projection-ownership-fixture.js';
import type { GenerateChatOptions } from '../IProvider.js';

function richOptions(
  base: GenerateChatOptions,
  providerName: string,
): GenerateChatOptions {
  if (base.runtime === undefined || base.settings === undefined)
    throw new Error('Missing fixture runtime');
  return {
    ...base,
    invocation: createRuntimeInvocationContext({
      runtime: base.runtime,
      settings: base.settings,
      providerName,
      ephemeralsSnapshot: {
        'prompt-caching': 'off',
        'text.verbosity': 'low',
        temperature: 0.2,
        max_tokens: 500,
        'reasoning.enabled': true,
        'reasoning.effort': 'low',
      },
    }),
    systemInstruction: `${'a'.repeat(4095)}\ud83d\ude00\ud800\nend`,
    tools: [
      {
        name: 'lookup',
        description: 'Find "雪" \\ records',
        parametersJsonSchema: {
          type: 'object',
          properties: { id: { type: 'string' } },
        },
      },
    ],
  };
}

describe('source projection finalized options parity', () => {
  it('sends the same instruction, tools and request controls as the native provider, including UTF16 reader boundaries', async () => {
    const bodies: string[] = [];
    const speakers: string[] = [];
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        bodies.push(await request.text());
        return new Response(
          'data: {"type":"response.completed","response":{"id":"resp_options","status":"completed","output":[]}}\n\ndata: [DONE]\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        );
      },
    });
    const disk = diskTextFixture(false, false);
    const setup = await projectionRuntime(
      `http://127.0.0.1:${server.port}/v1`,
      disk.root,
    );
    const options = richOptions(
      setup.options(requestSelection(disk.rows)),
      setup.provider.name,
    );
    try {
      const eager = await setup.provider.projectPromptEnvelope({
        ...options,
        requestRows: undefined,
      });
      const oracle = await estimatePromptEnvelope(
        setup.provider.name,
        eager,
        setup.factory,
      );
      for await (const row of setup.provider.generateChatCompletion({
        ...options,
        requestRows: undefined,
        promptEnvelopeTransportToken: eager.transportToken,
      }))
        speakers.push(row.speaker);
      const rows = requestSelection(disk.rows);
      const sourceOptions = {
        ...options,
        contents: { [Symbol.asyncIterator]: () => rows.openReader() },
        requestRows: rows,
      };
      const source = await setup.provider.projectPromptEnvelope(sourceOptions);
      const estimate = await estimatePromptEnvelope(
        setup.provider.name,
        source,
        withGpt56DiskSources(setup.factory, tmpdir()),
      );
      for await (const row of setup.provider.generateChatCompletion({
        ...sourceOptions,
        promptEnvelopeTransportToken: source.transportToken,
      }))
        speakers.push(row.speaker);
      expect(speakers).toStrictEqual(['ai', 'ai']);
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).toBe(bodies[0]);
      expect(JSON.parse(bodies[1]).instructions).toBe(
        options.systemInstruction,
      );
      expect(JSON.parse(bodies[1]).tools[0].name).toBe('lookup');
      expect(JSON.parse(bodies[1]).max_output_tokens).toBe(500);
      expect(estimate).toStrictEqual(oracle);
    } finally {
      disk.close();
      await server.stop(true);
      await setup.config.dispose();
    }
  }, 120000);
});

describe('source prepared options rejection', () => {
  it('rejects incompatible options added after preparing the source token rather than ignoring them', async () => {
    const disk = diskTextFixture(false, false);
    const setup = await projectionRuntime('http://127.0.0.1:1/v1', disk.root);
    const options = setup.options(requestSelection(disk.rows));
    const projection = await setup.provider.projectPromptEnvelope(options);
    if (options.runtime === undefined || options.settings === undefined)
      throw new Error('Missing fixture runtime');
    const invocation = createRuntimeInvocationContext({
      runtime: options.runtime,
      settings: options.settings,
      providerName: setup.provider.name,
      ephemeralsSnapshot: { 'responses-stateful': true },
    });
    const stream = setup.provider.generateChatCompletion({
      ...options,
      invocation,
      promptEnvelopeTransportToken: projection.transportToken,
    });
    try {
      await expect(stream.next()).rejects.toThrow(
        'stateful options changed after the source token was prepared',
      );
      const source = projection.finalizedProjection;
      if (!(source instanceof Gpt56SourceProjection))
        throw new Error('Missing sealed source');
      expect(
        source.promptSegments.every(
          (segment) => !existsSync(segment.source.path),
        ),
      ).toBe(true);
    } finally {
      await stream.return?.();
      await projection.releaseIfUnsent?.();
      disk.close();
      await setup.config.dispose();
    }
  });

  it('rejects a source token without its transport-read request rows before normalization reads any rows', async () => {
    const disk = diskTextFixture(false, false);
    const setup = await projectionRuntime('http://127.0.0.1:1/v1', disk.root);
    const options = setup.options(requestSelection(disk.rows));
    const projection = await setup.provider.projectPromptEnvelope(options);
    let reads = 0;
    const contents = {
      async *[Symbol.asyncIterator](): AsyncGenerator<IContent, void> {
        reads++;
        yield {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'not the sealed selection' }],
        };
      },
    };
    try {
      expect(() =>
        setup.provider.generateChatCompletion({
          ...options,
          requestRows: undefined,
          contents,
          promptEnvelopeTransportToken: projection.transportToken,
        }),
      ).toThrow('Source token requires its transport-read request rows');
      expect(reads).toBe(0);
    } finally {
      await projection.releaseIfUnsent?.();
      disk.close();
      await setup.config.dispose();
    }
  });
});
