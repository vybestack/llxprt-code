/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { captureBodyAttempt } from '../../packages/test-utils/src/body-evidence-writer.js';
import { randomUUID } from 'node:crypto';
import { withFetchPreconnect } from '../../packages/test-utils/src/fetch-test-helpers.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import { SettingsService } from '../../packages/settings/src/settings/SettingsService.js';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '../../packages/core/src/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '../../packages/core/src/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { OpenAIResponsesProvider } from '../../packages/providers/src/openai-responses/OpenAIResponsesProvider.js';
import { AnthropicProvider } from '../../packages/providers/src/anthropic/AnthropicProvider.js';
import { GeminiProvider } from '../../plugins/google-gemini/src/gemini/GeminiProvider.js';
import type { IProvider } from '../../packages/providers/src/IProvider.js';
import { RetryOrchestrator } from '../../packages/providers/src/RetryOrchestrator.js';
function makeProvider(name: string): IProvider {
  if (name === 'anthropic') return new AnthropicProvider('test-key');
  if (name === 'gemini') return new GeminiProvider('test-key');
  return new OpenAIResponsesProvider('test-key', 'https://api.openai.com/v1');
}
function response(name: string): Response {
  if (name === 'openai-responses')
    return new Response(
      'data: {"type":"response.output_text.delta","delta":"ok"}\n\ndata: {"type":"response.completed","response":{"id":"purge-body","status":"completed"}}\n\ndata: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  const body =
    name === 'anthropic'
      ? {
          id: 'msg_purge',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-5',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }
      : {
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'ok' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 1,
            totalTokenCount: 2,
          },
        };
  return name === 'gemini'
    ? new Response(
        `data: ${JSON.stringify(body)}

`,
        { headers: { 'content-type': 'text/event-stream' } },
      )
    : new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      });
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
export async function captureCuratedBody(
  name: string,
  contents: Iterable<IContent> | AsyncIterable<IContent>,
  caching = false,
  retry = false,
  orchestrated = false,
  responseContents?: IContent[],
  mediaResolver?: ProviderRuntimeContext['mediaResolver'],
): Promise<string> {
  let model = 'gpt-5.2';
  if (name === 'anthropic') model = 'claude-opus-5';
  if (name === 'gemini') model = 'gemini-2.5-flash';
  const settings = new SettingsService();
  settings.set('auth-key', 'test-key');
  settings.set('prompt-caching', caching ? 'on' : 'off');
  settings.setProviderSetting(name, 'model', model);
  settings.setProviderSetting(name, 'streaming', 'disabled');
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: `purge-body-${name}`,
    config: createRuntimeConfigStub(settings),
    mediaResolver,
  });
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: name,
    ephemeralsSnapshot: {
      'prompt-caching': caching ? 'on' : 'off',
      streaming: 'disabled',
      retries: 2,
      retrywait: 1,
    },
  });
  const rows = bodyRows(contents);
  const options = createProviderCallOptions({
    providerName: name,
    settings,
    config: runtime.config,
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
      return response(name);
    },
  );
  const provider = orchestrated
    ? new RetryOrchestrator(makeProvider(name), {
        maxAttempts: 2,
        initialDelayMs: 1,
        maxDelayMs: 1,
      })
    : makeProvider(name);
  try {
    for await (const chunk of provider.generateChatCompletion({
      ...options,
      contents: rows,
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
