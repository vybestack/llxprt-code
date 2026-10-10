/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import type { GenerateChatOptions } from '../IProvider.js';

describe('call-bound provider ports', () => {
  const directories: string[] = [];
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeAllConnections();
          }),
      ),
    );
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function owner(
    bytes: Uint8Array,
    baseURL: string,
    secret: string,
  ): Promise<{
    provider: OpenAIProvider;
    options: GenerateChatOptions;
    resolver: RequestMediaResolver;
    settings: SettingsService;
  }> {
    await mkdir(join(process.cwd(), 'tmp'), { recursive: true });
    const directory = await mkdtemp(join(process.cwd(), 'tmp/port-owner-'));
    directories.push(directory);
    const store = new LocalMediaStore({
      rootDirectory: directory,
      quotaBytes: 1024,
    });
    const reference = await store.admit({
      bytes,
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const resolver = new RequestMediaResolver(store);
    const settings = new SettingsService();
    settings.set('auth-key', secret);
    settings.set('streaming', 'disabled');
    settings.setProviderSetting('openai', 'model', 'gpt-4o');
    settings.setProviderSetting('openai', 'base-url', baseURL);
    const provider = bindProviderMedia(
      shared.bindOwnerAuthentication(settings),
      resolver,
      1024,
    );
    const invocation = createRuntimeInvocationContext({
      runtimeId: 'same-label',
      providerName: provider.name,
      ephemeralsSnapshot: {
        ...settings.getAllGlobalSettings(),
        openai: settings.getProviderSettings('openai'),
      },
    });
    return {
      provider,
      options: {
        contents: [{ speaker: 'human', blocks: [reference] }],
        invocation,
        systemInstruction: 'Describe the image.',
      },
      resolver,
      settings,
    };
  }

  const shared = new OpenAIProvider(undefined);

  async function endpoint(): Promise<{
    baseURL: string;
    requests: Array<{ body: unknown; authorization: string | undefined }>;
  }> {
    const requests: Array<{
      body: unknown;
      authorization: string | undefined;
    }> = [];
    const server = createServer((request, response) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        requests.push({
          body: JSON.parse(Buffer.concat(chunks).toString()),
          authorization: request.headers.authorization,
        });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            id: 'local',
            object: 'chat.completion',
            model: 'gpt-4o',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'delivered' },
                finish_reason: 'stop',
              },
            ],
          }),
        );
      })();
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing local endpoint');
    return { baseURL: `http://127.0.0.1:${address.port}/v1`, requests };
  }

  async function drain(
    input: Awaited<ReturnType<typeof owner>>,
  ): Promise<string> {
    const texts: string[] = [];
    for await (const content of input.provider.generateChatCompletion(
      input.options,
    )) {
      for (const block of content.blocks)
        if (block.type === 'text') texts.push(block.text);
    }
    return texts.join('');
  }

  it('isolates simultaneous same-label owner authentication and actual stored media on one public provider', async () => {
    const leftEndpoint = await endpoint();
    const rightEndpoint = await endpoint();
    const left = await owner(
      new Uint8Array([1, 2, 3]),
      leftEndpoint.baseURL,
      'left-secret',
    );
    const right = await owner(
      new Uint8Array([4, 5, 6]),
      rightEndpoint.baseURL,
      'right-secret',
    );
    expect(await Promise.all([drain(left), drain(right)])).toStrictEqual([
      'delivered',
      'delivered',
    ]);
    expect(leftEndpoint.requests[0]?.authorization).toBe('Bearer left-secret');
    expect(rightEndpoint.requests[0]?.authorization).toBe(
      'Bearer right-secret',
    );
    expect(JSON.stringify(leftEndpoint.requests[0]?.body)).toContain('AQID');
    expect(JSON.stringify(leftEndpoint.requests[0]?.body)).not.toContain(
      'BAUG',
    );
    expect(JSON.stringify(rightEndpoint.requests[0]?.body)).toContain('BAUG');
    expect(left.resolver.accounting().activeRequestCount).toBe(0);
    expect(right.resolver.accounting().activeRequestCount).toBe(0);
    expect(Object.keys(left.options)).not.toContain('runtime');
  });

  it('cancels one admitted owner without releasing its sibling projection or sending a cancelled request', async () => {
    const local = await endpoint();
    const left = await owner(
      new Uint8Array([1, 2, 3]),
      local.baseURL,
      'left-secret',
    );
    const right = await owner(
      new Uint8Array([4, 5, 6]),
      local.baseURL,
      'right-secret',
    );
    const abort = new AbortController();
    left.options = {
      ...left.options,
      invocation: createRuntimeInvocationContext({
        runtimeId: 'same-label',
        providerName: 'openai',
        ephemeralsSnapshot: left.options.invocation?.ephemerals,
        signal: abort.signal,
      }),
    };
    const [leftProjection, rightProjection] = await Promise.all([
      left.provider.projectPromptEnvelope(left.options),
      right.provider.projectPromptEnvelope(right.options),
    ]);
    left.options = {
      ...left.options,
      promptEnvelopeTransportToken: leftProjection.transportToken,
    };
    right.options = {
      ...right.options,
      promptEnvelopeTransportToken: rightProjection.transportToken,
    };
    abort.abort(new Error('owner cancelled'));
    await expect(drain(left)).rejects.toThrow(/aborted/i);
    expect(left.resolver.accounting().activeRequestCount).toBe(0);
    expect(right.resolver.accounting().activeRequestCount).toBe(1);
    expect(await drain(right)).toContain('delivered');
    expect(local.requests).toHaveLength(1);
    expect(right.resolver.accounting().activeRequestCount).toBe(0);
  });

  it('releases only the abandoned owner projection while the other projection remains usable', async () => {
    const local = await endpoint();
    const left = await owner(
      new Uint8Array([1, 2, 3]),
      local.baseURL,
      'left-secret',
    );
    const right = await owner(
      new Uint8Array([4, 5, 6]),
      local.baseURL,
      'right-secret',
    );
    const [leftProjection, rightProjection] = await Promise.all([
      left.provider.projectPromptEnvelope(left.options),
      right.provider.projectPromptEnvelope(right.options),
    ]);
    await leftProjection.releaseIfUnsent?.();
    expect(left.resolver.accounting().activeRequestCount).toBe(0);
    expect(right.resolver.accounting().activeRequestCount).toBe(1);
    right.options = {
      ...right.options,
      promptEnvelopeTransportToken: rightProjection.transportToken,
    };
    expect(await drain(right)).toContain('delivered');
    expect(right.resolver.accounting().activeRequestCount).toBe(0);
    expect(local.requests).toHaveLength(1);
    expect(JSON.stringify(local.requests[0]?.body)).toContain('BAUG');
  });
});
