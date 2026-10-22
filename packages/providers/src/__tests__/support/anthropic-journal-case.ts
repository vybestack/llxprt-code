/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createServer } from 'node:http';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { AnthropicProvider } from '../../anthropic/AnthropicProvider.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createRuntimeTokenizerFactory } from '../../composition/runtimeTokenizerFactory.js';
import type { GenerateChatOptions } from '../../IProvider.js';
import { TEST_PROVIDER_CONFIG } from '../providerTestConfig.js';
import {
  buildHistoryCallOptions,
  WIRE_ROUTES,
  type WireRoute,
} from './wireBodyCapture.js';

export interface AnthropicCapturedRequest {
  readonly body: string;
  readonly length: string | undefined;
}

export async function anthropicJournalSink(): Promise<{
  readonly route: WireRoute;
  readonly requests: AnthropicCapturedRequest[];
  close(): Promise<void>;
}> {
  const route = WIRE_ROUTES.find((item) => item.id === 'anthropic-cache-off');
  if (route === undefined) throw new Error('Missing Anthropic route');
  const requests: AnthropicCapturedRequest[] = [];
  const server = createServer((request, response) => {
    void (async (): Promise<void> => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        if (!Buffer.isBuffer(chunk)) throw new Error('Expected HTTP bytes');
        chunks.push(chunk);
      }
      requests.push({
        body: Buffer.concat(chunks).toString('utf8'),
        length: request.headers['content-length'],
      });
      const reply = route.respond();
      response.writeHead(reply.status, Object.fromEntries(reply.headers));
      response.end(await reply.text());
    })().catch((error: unknown) =>
      response.destroy(
        error instanceof Error ? error : new Error(String(error)),
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing socket');
  return {
    route: { ...route, baseURL: `http://127.0.0.1:${address.port}` },
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
        server.closeAllConnections();
      }),
  };
}

export async function sendAnthropicJournalCase(
  route: WireRoute,
  selection: ProviderRequestSelection,
  overrides: Pick<GenerateChatOptions, 'metadata'> = {},
  authToken = 'test-api-key',
  projected = false,
): Promise<number | undefined> {
  const provider = new AnthropicProvider(
    authToken,
    undefined,
    TEST_PROVIDER_CONFIG,
  );
  const options = buildHistoryCallOptions(
    route,
    {
      id: 'anthropic-journal-case',
      description: 'Anthropic journal route',
      rows: [],
      systemInstruction: 'Answer precisely 雪.',
    },
    'rows',
    new SettingsService(),
    selection,
  );
  const request = {
    ...options,
    ...overrides,
    resolved: { ...options.resolved, authToken },
  };
  const projection = projected
    ? await provider.projectPromptEnvelope(request)
    : undefined;
  try {
    const estimate =
      projection === undefined
        ? undefined
        : await estimatePromptEnvelope(
            provider.name,
            projection,
            createRuntimeTokenizerFactory(),
          );
    for await (const chunk of provider.generateChatCompletion({
      ...request,
      ...(projection === undefined
        ? {}
        : { promptEnvelopeTransportToken: projection.transportToken }),
    }))
      void chunk;
    return estimate?.estimatedPromptTokens;
  } finally {
    await projection?.releaseIfUnsent?.();
  }
}
