/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { OpenAIResponsesProvider } from '@vybestack/llxprt-code-providers';
import { createRuntimeTokenizerFactory } from '@vybestack/llxprt-code-providers/composition/providerManagerInstance.js';
import { activeRequestBodyCount } from '@vybestack/llxprt-code-providers/utils/requestScopedBody.js';
import {
  prepareAtSendSeam,
  buildSourceProviderChatOptions,
  enforceAndStreamSourcePromptEnvelopeRetries,
} from './promptEnvelopeSendSeam.js';
import {
  diskSource,
  rowText,
  sourceRootSetup,
} from './__tests__/support/prompt-envelope-source-test-helpers.js';

const root = sourceRootSetup();
const responseExitModes: ReadonlyArray<'return' | 'abort'> = [
  'return',
  'abort',
];
const instructions = 'Read rows.';

function expectedDigest(
  count: number,
  large: boolean,
  systemText = instructions,
): string {
  const hash = createHash('sha256');
  hash.update('{"model":"o3-mini","input":[');
  for (let index = 0; index < count; index++) {
    if (index !== 0) hash.update(',');
    hash.update(
      JSON.stringify({
        role: 'user',
        content: rowText(index, large && index === count - 1),
      }),
    );
  }
  hash.update(`],"stream":true,"instructions":${JSON.stringify(systemText)}}`);
  return hash.digest('hex');
}

async function uploadDigest(body: ReadableStream<Uint8Array>): Promise<string> {
  const hash = createHash('sha256');
  const reader = body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      hash.update(next.value);
    }
    return hash.digest('hex');
  } finally {
    reader.releaseLock();
  }
}

function endpoint(retry: boolean) {
  const bodies: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request): Promise<Response> {
      if (request.body === null) throw new Error('Missing upload');
      bodies.push(await uploadDigest(request.body));
      if (retry && bodies.length === 1)
        return new Response('{"error":{"message":"retry"}}', { status: 503 });
      return new Response(
        'data: {"type":"response.output_text.delta","delta":"finished"}\n\ndata: {"type":"response.completed","response":{"id":"resp_source","status":"completed","output":[]}}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  return { bodies, server };
}

function runtime(baseURL: string, retries = 2) {
  const settings = new SettingsService();
  settings.setProviderSetting('openai-responses', 'model', 'o3-mini');
  settings.setProviderSetting('openai-responses', 'base-url', baseURL);
  settings.setProviderSetting('openai-responses', 'auth-key', 'test-key');
  settings.set('prompt-caching', 'off');
  const config = new Config({
    cwd: root(),
    targetDir: root(),
    sessionId: randomUUID(),
    model: 'o3-mini',
    debugMode: false,
    settingsService: settings,
  });
  config.setTokenizerFactory(createRuntimeTokenizerFactory());
  const provider = new OpenAIResponsesProvider('test-key', baseURL);
  const context = { config, settingsService: settings, runtimeId: root() };
  const invocation = createRuntimeInvocationContext({
    runtime: context,
    settings,
    providerName: provider.name,
    ephemeralsSnapshot: { 'prompt-caching': 'off', retries, retrywait: 0 },
  });
  return { config, provider, context, invocation };
}

async function independentEstimate(
  setup: ReturnType<typeof runtime>,
  count: number,
  large: boolean,
  systemText = instructions,
): Promise<number> {
  const contents: AsyncIterable<IContent> = {
    async *[Symbol.asyncIterator]() {
      for (let index = 0; index < count; index++)
        yield {
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: rowText(index, large && index === count - 1),
            },
          ],
        };
    },
  };
  const prepared = await prepareAtSendSeam(setup.provider, {
    contents,
    config: setup.config,
    runtime: setup.context,
    settings: setup.context.settingsService,
    invocation: setup.invocation,
    systemInstruction: systemText,
  });
  try {
    if (prepared.estimate === null)
      throw new Error('Missing actual provider estimate');
    return prepared.estimate.estimatedPromptTokens;
  } finally {
    await prepared.releaseIfUnsent?.();
  }
}

async function runOracle(large: boolean): Promise<number> {
  const fixture = await diskSource(root(), 64, large);
  const http = endpoint(true);
  const setup = runtime(`http://127.0.0.1:${http.server.port}/v1`);
  const expectedTokens = await independentEstimate(setup, 64, large);
  let enforcedTokens = -1;
  let stream: AsyncIterableIterator<IContent> | undefined;
  try {
    stream = await enforceAndStreamSourcePromptEnvelopeRetries({
      provider: setup.provider,
      source: fixture.source,
      buildOptions: (source) =>
        buildSourceProviderChatOptions(
          source,
          undefined,
          setup.context,
          setup.invocation,
          { requestId: 'actual-source-http' },
          instructions,
        ),
      enforce: async (source, estimate) => {
        enforcedTokens = await estimate(source);
        return source;
      },
      shouldRetryOnError: () => false,
    });
    const output: string[] = [];
    for await (const row of stream) {
      expect(fixture.state.closed).toBe(0);
      output.push(
        ...row.blocks.flatMap((block) =>
          block.type === 'text' ? [block.text] : [],
        ),
      );
    }
    expect(output.join('')).toBe('finished');
    expect(enforcedTokens).toBe(expectedTokens);
    const expected = expectedDigest(64, large);
    expect(http.bodies).toStrictEqual([expected, expected]);
    expect(fixture.state.closed).toBe(1);
    expect(fixture.state.active).toBe(0);
    expect(activeRequestBodyCount()).toBe(0);
    return enforcedTokens;
  } finally {
    await stream?.return?.();
    await http.server.stop(true);
    await setup.config.dispose();
  }
}

async function projectionDemandSentinel(): Promise<number> {
  const fixture = await diskSource(root());
  const http = endpoint(false);
  const setup = runtime(`http://127.0.0.1:${http.server.port}/v1`);
  let stream: AsyncIterableIterator<IContent> | undefined;
  try {
    stream = await enforceAndStreamSourcePromptEnvelopeRetries({
      provider: setup.provider,
      source: fixture.source,
      buildOptions: (source) =>
        buildSourceProviderChatOptions(
          source,
          undefined,
          setup.context,
          setup.invocation,
          undefined,
          instructions,
        ),
      enforce: async (source, estimate) => {
        await estimate(source);
        return source;
      },
      shouldRetryOnError: () => false,
    });
    return fixture.state.pulled;
  } finally {
    await stream?.return?.();
    await http.server.stop(true);
    await setup.config.dispose();
  }
}

describe('source-backed seam actual Responses local HTTP', () => {
  it(
    'reprojects a real HTTP retry with changed instructions and preserved retry context',
    testActualSeamRetry,
    60000,
  );
  it.each([...responseExitModes])(
    'releases sent disk ownership on actual HTTP response %s',
    async (mode) => {
      expect(await actualResponseCancellation(mode)).toBe(
        mode === 'abort' ? 'cancel actual response' : 'returned',
      );
    },
    60000,
  );
  it.each([false, true])(
    'preserves actual estimation and byte-identical retry for 64 disk rows, oversized=%s',
    async (large) => {
      expect(await runOracle(large)).toBeGreaterThan(0);
    },
    60000,
  );
  if (process.env.ISSUE854_SOURCE_PROJECTION_DEMAND === '1') {
    it('does not predrain disk contents before actual provider BODY demand', async () => {
      expect(await projectionDemandSentinel()).toBeLessThan(64);
    }, 60000);
  }
});

async function testActualSeamRetry(): Promise<void> {
  const fixture = await diskSource(root());
  const http = endpoint(true);
  const setup = runtime(`http://127.0.0.1:${http.server.port}/v1`, 1);
  const tokens: object[] = [];
  const retryContext = { requestId: 'actual-retry', observedTokens: 41 };
  const retryInstructions = `${instructions} Retry this request.`;
  let systemText = instructions;
  let stream: AsyncIterableIterator<IContent> | undefined;
  try {
    stream = await enforceAndStreamSourcePromptEnvelopeRetries({
      provider: setup.provider,
      source: fixture.source,
      buildOptions: (source) =>
        buildSourceProviderChatOptions(
          source,
          undefined,
          setup.context,
          setup.invocation,
          retryContext,
          systemText,
        ),
      enforce: async (source, estimate) => {
        await estimate(source);
        return source;
      },
      shouldRetryOnError: (error) =>
        error instanceof Error && 'status' in error && error.status === 503,
      async *send(prepared, attemptIndex) {
        const token = prepared.options.promptEnvelopeTransportToken;
        if (token === undefined)
          throw new Error('Missing actual projection token');
        tokens.push(token);
        const attemptText =
          attemptIndex === 0 ? instructions : retryInstructions;
        expect(prepared.options.requestRows).toBe(fixture.source);
        expect(prepared.options.metadata?.['_retryRequestContext']).toBe(
          retryContext,
        );
        expect(prepared.estimate.estimatedPromptTokens).toBe(
          await independentEstimate(setup, 64, false, attemptText),
        );
        systemText = retryInstructions;
        yield* setup.provider.generateChatCompletion(prepared.options);
      },
    });
    const text: string[] = [];
    for await (const row of stream)
      text.push(
        ...row.blocks.flatMap((block) =>
          block.type === 'text' ? [block.text] : [],
        ),
      );
    expect(text.join('')).toBe('finished');
    expect(tokens).toHaveLength(2);
    expect(tokens[1]).not.toBe(tokens[0]);
    expect(http.bodies).toStrictEqual([
      expectedDigest(64, false),
      expectedDigest(64, false, retryInstructions),
    ]);
    expect(fixture.state.closed).toBe(1);
    expect(activeRequestBodyCount()).toBe(0);
  } finally {
    await stream?.return?.();
    await http.server.stop(true);
    await setup.config.dispose();
  }
}

async function actualResponseCancellation(
  mode: 'return' | 'abort',
): Promise<string> {
  const fixture = await diskSource(root());
  const http = endpoint(false);
  const setup = runtime(`http://127.0.0.1:${http.server.port}/v1`);
  const controller = new AbortController();
  let stream: AsyncIterableIterator<IContent> | undefined;
  try {
    stream = await enforceAndStreamSourcePromptEnvelopeRetries({
      provider: setup.provider,
      source: fixture.source,
      signal: controller.signal,
      buildOptions: (source) =>
        buildSourceProviderChatOptions(
          source,
          undefined,
          setup.context,
          setup.invocation,
          undefined,
          instructions,
        ),
      enforce: async (source, estimate) => {
        await estimate(source);
        return source;
      },
      shouldRetryOnError: () => false,
    });
    const first = await stream.next();
    expect(first.done).toBe(false);
    expect(fixture.state.closed).toBe(0);
    expect(http.bodies).toStrictEqual([expectedDigest(64, false)]);
    let outcome = 'returned';
    if (mode === 'return') await stream.return?.();
    else {
      controller.abort(new Error('cancel actual response'));
      outcome = await stream.next().then(
        () => 'unexpected success',
        (error: unknown) =>
          error instanceof Error ? error.message : String(error),
      );
    }
    expect(fixture.state.closed).toBe(1);
    expect(fixture.state.active).toBe(0);
    expect(activeRequestBodyCount()).toBe(0);
    return outcome;
  } finally {
    await stream?.return?.();
    await http.server.stop(true);
    await setup.config.dispose();
  }
}
