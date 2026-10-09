/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { captureBodyAttempt } from '../../../../../scripts/lib/body-evidence-writer.js';
import { randomUUID } from 'node:crypto';
import { withFetchPreconnect } from '../../../../test-utils/src/fetch-test-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SettingsService } from '@vybestack/llxprt-code-settings/settings/SettingsService.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { OpenAIProvider } from '../../../../providers/src/openai/OpenAIProvider.js';
import { RetryOrchestrator } from '../../../../providers/src/RetryOrchestrator.js';
import { captureCuratedBody } from '../../../../../scripts/tests/provider-curated-body-helpers.js';

function chatResponse(): Response {
  return new Response(
    JSON.stringify({
      id: 'chat-compression',
      object: 'chat.completion',
      created: 0,
      model: 'gpt-5.2',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { headers: { 'content-type': 'application/json' } },
  );
}

function createBodyCaptureFetch(
  bodies: string[],
  retry: boolean,
): typeof fetch {
  const captureId = randomUUID();
  return withFetchPreconnect(
    async (
      _input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      if (init?.body === undefined || init.body === null)
        throw new Error('Missing OpenAI request BODY');
      await captureBodyAttempt(bodies, init.body, 'openai', captureId);
      if (retry && bodies.length === 1) throw new TypeError('fetch failed');
      return chatResponse();
    },
  );
}

export async function captureCompressionBody(
  name: string,
  contents: Iterable<IContent> | AsyncIterable<IContent>,
  caching: boolean,
  retry = false,
  orchestrated = false,
): Promise<string> {
  if (name !== 'openai')
    return captureCuratedBody(name, contents, caching, retry, orchestrated);
  const settings = new SettingsService();
  settings.set('auth-key', 'test-key');
  settings.set('prompt-caching', caching ? 'on' : 'off');
  settings.setProviderSetting('openai', 'model', 'gpt-5.2');
  settings.setProviderSetting('openai', 'streaming', 'disabled');
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: 'compression-openai-body',
    config: createRuntimeConfigStub(settings),
  });
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: 'openai',
    ephemeralsSnapshot: {
      'prompt-caching': caching ? 'on' : 'off',
      streaming: 'disabled',
      retries: 2,
      retrywait: 1,
    },
  });
  const rows = {
    async *[Symbol.asyncIterator](): AsyncGenerator<IContent, void, unknown> {
      yield* contents;
    },
  };
  const options = createProviderCallOptions({
    providerName: 'openai',
    settings,
    config: runtime.config,
    runtime,
    invocation,
    contents: rows,
  });
  const provider = new OpenAIProvider('test-key', 'https://api.openai.com/v1');
  const selected = orchestrated
    ? new RetryOrchestrator(provider, {
        maxAttempts: 2,
        initialDelayMs: 1,
        maxDelayMs: 1,
      })
    : provider;
  const original = globalThis.fetch;
  const bodies: string[] = [];
  globalThis.fetch = createBodyCaptureFetch(bodies, retry);
  try {
    for await (const _chunk of selected.generateChatCompletion({
      ...options,
      contents: rows,
    })) {
      void _chunk;
    }
  } finally {
    globalThis.fetch = original;
  }
  if (bodies.length !== (retry ? 2 : 1))
    throw new Error('Unexpected OpenAI attempt count');
  if (retry && bodies[0] !== bodies[1])
    throw new Error('OpenAI retry BODY changed');
  return bodies[bodies.length - 1];
}
