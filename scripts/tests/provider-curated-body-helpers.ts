/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { captureBodyAttempt } from '../../packages/test-utils/src/body-evidence-writer.js';
import { bodyRequestRows } from './support/body-request-rows.js';
import { randomUUID } from 'node:crypto';
import { withFetchPreconnect } from '../../packages/test-utils/src/fetch-test-helpers.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import { SettingsService } from '../../packages/settings/src/settings/SettingsService.js';
import { createProviderRuntimeContext } from '../../packages/core/src/runtime/providerRuntimeContext.js';
import type { RequestMediaResolutionService } from '../../packages/core/src/storage/request-media-resolver.js';
import { bindProviderMedia } from '../../packages/core/src/runtime/bindProviderMedia.js';
import { createRuntimeInvocationContext } from '../../packages/core/src/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { OpenAIResponsesProvider } from '../../packages/providers/src/openai-responses/OpenAIResponsesProvider.js';
import { AnthropicProvider } from '../../packages/providers/src/anthropic/AnthropicProvider.js';
import type { IProvider } from '../../packages/providers/src/IProvider.js';
import { RetryOrchestrator } from '../../packages/providers/src/RetryOrchestrator.js';
export interface CuratedProviderAdapter {
  readonly model: string;
  makeProvider(): IProvider;
  response(): Response;
}

const ANTHROPIC_ADAPTER: CuratedProviderAdapter = {
  model: 'claude-opus-5',
  makeProvider: () => new AnthropicProvider('test-key'),
  response: () =>
    new Response(
      JSON.stringify({
        id: 'msg_purge',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
};

const OPENAI_RESPONSES_ADAPTER: CuratedProviderAdapter = {
  model: 'gpt-5.2',
  makeProvider: () =>
    new OpenAIResponsesProvider('test-key', 'https://api.openai.com/v1'),
  response: () =>
    new Response(
      'data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: {"type":"response.completed","response":{"id":"purge-body","status":"completed"}}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    ),
};

function packageAdapter(name: string): CuratedProviderAdapter {
  if (name === 'anthropic') return ANTHROPIC_ADAPTER;
  if (name === 'openai-responses') return OPENAI_RESPONSES_ADAPTER;
  throw new Error(`No package-hosted curated body adapter for ${name}`);
}
function bodyRows(
  contents: Iterable<IContent> | AsyncIterable<IContent>,
): AsyncIterable<IContent> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* contents;
    },
  };
}
export async function captureWithAdapter(
  name: string,
  adapter: CuratedProviderAdapter,
  contents: Iterable<IContent> | AsyncIterable<IContent>,
  caching = false,
  retry = false,
  orchestrated = false,
  responseContents?: IContent[],
  mediaResolver?: RequestMediaResolutionService,
): Promise<string> {
  const settings = new SettingsService();
  settings.set('auth-key', 'test-key');
  settings.set('prompt-caching', caching ? 'on' : 'off');
  settings.setProviderSetting(name, 'model', adapter.model);
  settings.setProviderSetting(name, 'streaming', 'disabled');
  const config = createRuntimeConfigStub(settings);
  const runtime = createProviderRuntimeContext({
    runtimeId: `purge-body-${name}`,
  });
  const invocation = createRuntimeInvocationContext({
    fetch: (input, init) => globalThis.fetch(input, init),
    runtimeId: runtime.runtimeId,
    runtimeMetadata: runtime.metadata,
    providerName: name,
    ephemeralsSnapshot: {
      'prompt-caching': caching ? 'on' : 'off',
      streaming: 'disabled',
      retries: 2,
      retrywait: 1,
    },
  });
  const selection = await bodyRequestRows(contents);
  const rows = bodyRows(selection.openReader());
  const options = createProviderCallOptions({
    providerName: name,
    settings,
    config,
    runtime,
    invocation,
    contents: rows,
  });
  const original = globalThis.fetch;
  const bodies: string[] = [];
  const captureId = randomUUID();
  globalThis.fetch = withFetchPreconnect(
    async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      if (!init?.body) throw new Error('Missing real provider request body');
      await captureBodyAttempt(bodies, init.body, name, captureId);
      if (retry && bodies.length === 1) throw new TypeError('fetch failed');
      return adapter.response();
    },
  );
  const provider = bindProviderMedia(
    orchestrated
      ? new RetryOrchestrator(adapter.makeProvider(), {
          maxAttempts: 2,
          initialDelayMs: 1,
          maxDelayMs: 1,
        })
      : adapter.makeProvider(),
    mediaResolver,
    undefined,
  );
  try {
    for await (const chunk of provider.generateChatCompletion({
      ...options,
      contents: rows,
      requestRows: selection,
      contentCount: selection.count,
    })) {
      responseContents?.push(chunk);
    }
  } finally {
    globalThis.fetch = original;
  }
  if (bodies.length !== (retry ? 2 : 1))
    throw new Error('Unexpected transport attempt count: ' + bodies.length);
  if (retry && bodies[0] !== bodies[1])
    throw new Error('Retry body differs from original');
  return bodies[bodies.length - 1];
}

/** Captures the request body for the providers hosted in packages/. */
export function captureCuratedBody(
  name: string,
  contents: Iterable<IContent> | AsyncIterable<IContent>,
  caching = false,
  retry = false,
  orchestrated = false,
  responseContents?: IContent[],
  mediaResolver?: RequestMediaResolutionService,
): Promise<string> {
  return captureWithAdapter(
    name,
    packageAdapter(name),
    contents,
    caching,
    retry,
    orchestrated,
    responseContents,
    mediaResolver,
  );
}
