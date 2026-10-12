/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { AuthPrecedenceResolver } from '@vybestack/llxprt-code-auth/precedence.js';
import type { IProviderKeyStorage } from '@vybestack/llxprt-code-auth';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import type { GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';

function gate(): { promise: Promise<void>; open(): void } {
  let open = (): void => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

class KeyOwnedOpenAIProvider extends OpenAIProvider {
  onAdmitted: (options: NormalizedGenerateChatOptions) => void = () => {};
  readonly admittedTemperatures: Array<number | undefined> = [];

  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    this.onAdmitted(options);
    this.admittedTemperatures.push(options.resolved.temperature);
    yield* super.generateChatCompletionWithOptions(options);
  }

  constructor(settings: SettingsService, storage: IProviderKeyStorage) {
    super(undefined);
    this.setRuntimeSettingsService(settings);
    this.authResolver = new AuthPrecedenceResolver(
      { providerId: 'openai', envKeyNames: [], supportsOAuth: false },
      { settingsService: settings, providerKeyStorage: storage },
    );
  }
}

async function drain(
  provider: OpenAIProvider,
  options: GenerateChatOptions,
): Promise<string> {
  const texts: string[] = [];
  for await (const content of provider.generateChatCompletion(options)) {
    for (const block of content.blocks) {
      if (block.type === 'text') texts.push(block.text);
    }
  }
  return texts.join('');
}

describe('public invocation ownership', () => {
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
  });

  async function endpoint(): Promise<{
    baseURL: string;
    requests: Array<{ body: unknown; headers: Record<string, unknown> }>;
  }> {
    const requests: Array<{
      body: unknown;
      headers: Record<string, unknown>;
    }> = [];
    const handleRequest = async (
      request: IncomingMessage,
      response: ServerResponse,
    ): Promise<void> => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({
        body: JSON.parse(Buffer.concat(chunks).toString()),
        headers: { ...request.headers },
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'local-completion',
          object: 'chat.completion',
          model: 'local-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'delivered' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    };
    const server = createServer((request, response) => {
      void handleRequest(request, response);
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing local endpoint address');
    }
    return { baseURL: `http://127.0.0.1:${address.port}/v1`, requests };
  }

  function settingsFor(baseURL: string): SettingsService {
    const settings = new SettingsService();
    settings.setProviderSetting('openai', 'model', 'initial-model');
    settings.setProviderSetting('openai', 'base-url', baseURL);
    settings.set('auth-key-name', 'owned-key');
    settings.set('streaming', 'disabled');
    settings.setProviderSetting('openai', 'temperature', 0.2);
    settings.set('maxOutputTokens', 17);
    settings.set('custom-headers', { 'X-Admission': 'first' });
    return settings;
  }

  function optionsFor(_settings: SettingsService): GenerateChatOptions {
    return {
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
      ],
      metadata: { runtimeId: 'public-invocation-owner' },
      systemInstruction: 'Respond to the user.',
    };
  }

  it('keeps model, policy and headers captured before an asynchronous credential read, and a fresh admission observes replacements', async () => {
    const first = await endpoint();
    const second = await endpoint();
    const settings = settingsFor(first.baseURL);
    const entered = gate();
    const resume = gate();
    const storage: IProviderKeyStorage = {
      getKey: async () => {
        entered.open();
        await resume.promise;
        return 'local-secret';
      },
      listKeys: async () => ['owned-key'],
      hasKey: async () => true,
    };
    const provider = new KeyOwnedOpenAIProvider(settings, storage);
    const requestFieldNames: string[][] = [];
    provider.onAdmitted = (options) => {
      requestFieldNames.push(Object.keys(options));
      expect(Object.keys(options)).not.toContain('settings');
      expect(Object.keys(options)).not.toContain('config');
    };
    const pending = drain(provider, optionsFor(settings));
    await entered.promise;
    settings.setProviderSetting('openai', 'model', 'replacement-model');
    settings.setProviderSetting('openai', 'base-url', second.baseURL);
    settings.setProviderSetting('openai', 'temperature', 0.8);
    settings.set('maxOutputTokens', 31);
    settings.set('custom-headers', { 'X-Admission': 'second' });
    resume.open();
    expect(await pending).toContain('delivered');
    expect(requestFieldNames[0]).not.toContain('runtime');
    expect(first.requests[0]?.body).toMatchObject({
      model: 'initial-model',
      temperature: 0.2,
      max_tokens: 17,
    });
    expect(first.requests[0]?.headers['x-admission']).toBe('first');
    expect(provider.admittedTemperatures).toStrictEqual([0.2]);
    expect(second.requests).toHaveLength(0);
    provider.clearAuthCache();
    expect(await drain(provider, optionsFor(settings))).toContain('delivered');
    expect(second.requests[0]?.body).toMatchObject({
      model: 'replacement-model',
      temperature: 0.8,
      max_tokens: 31,
    });
    expect(second.requests[0]?.headers['x-admission']).toBe('second');
    expect(provider.admittedTemperatures).toStrictEqual([0.2, 0.8]);
  });

  it('isolates concurrent owners with the same runtime label through local HTTP', async () => {
    const left = await endpoint();
    const right = await endpoint();
    const leftSettings = settingsFor(left.baseURL);
    const rightSettings = settingsFor(right.baseURL);
    leftSettings.setProviderSetting('openai', 'model', 'left-owner');
    rightSettings.setProviderSetting('openai', 'model', 'right-owner');
    const leftGate = gate();
    const rightGate = gate();
    const release = gate();
    const storageFor = (
      entered: ReturnType<typeof gate>,
      token: string,
    ): IProviderKeyStorage => ({
      getKey: async () => {
        entered.open();
        await release.promise;
        return token;
      },
      listKeys: async () => ['owned-key'],
      hasKey: async () => true,
    });
    const leftProvider = new KeyOwnedOpenAIProvider(
      leftSettings,
      storageFor(leftGate, 'left-secret'),
    );
    const rightProvider = new KeyOwnedOpenAIProvider(
      rightSettings,
      storageFor(rightGate, 'right-secret'),
    );
    const leftPending = drain(leftProvider, optionsFor(leftSettings));
    const rightPending = drain(rightProvider, optionsFor(rightSettings));
    await Promise.all([leftGate.promise, rightGate.promise]);
    leftSettings.setProviderSetting('openai', 'model', 'left-replaced');
    rightSettings.setProviderSetting('openai', 'model', 'right-replaced');
    release.open();
    await Promise.all([leftPending, rightPending]);
    expect(left.requests[0]).toMatchObject({
      body: { model: 'left-owner' },
      headers: { authorization: 'Bearer left-secret' },
    });
    expect(right.requests[0]).toMatchObject({
      body: { model: 'right-owner' },
      headers: { authorization: 'Bearer right-secret' },
    });
    expect(left.requests).toHaveLength(1);
    expect(right.requests).toHaveLength(1);
  });

  it('does not acquire owner service authority through the public invocation context', () => {
    const settings = settingsFor('http://127.0.0.1:1/v1');
    settings.set('reasoning.enabled', true);
    const invocation = createRuntimeInvocationContext({
      runtimeId: 'data-owner',

      providerName: 'openai',
      ephemeralsSnapshot: settings.getAllGlobalSettings(),
    });
    expect(Object.keys(invocation)).not.toContain('settings');
    expect(Object.keys(invocation)).not.toContain('runtime');
    settings.set('reasoning.enabled', false);
    expect(invocation.getModelBehavior<boolean>('reasoning.enabled')).toBe(
      true,
    );
  });

  it('owns nested provider policy without freezing the owner and retains the live cancellation signal', () => {
    const policy = { nested: { enabled: true }, models: ['first'] };
    const controller = new AbortController();
    const invocation = createRuntimeInvocationContext({
      runtimeId: 'data-owner',

      providerName: 'openai',
      ephemeralsSnapshot: { openai: policy },
      signal: controller.signal,
    });
    policy.nested.enabled = false;
    policy.models.push('second');
    expect(
      invocation.getProviderOverrides<Record<string, unknown>>('openai'),
    ).toStrictEqual({
      nested: { enabled: true },
      models: ['first'],
    });
    expect(Object.isFrozen(policy.nested)).toBe(false);
    controller.abort(new Error('revoked'));
    expect(invocation.signal?.aborted).toBe(true);
  });

  it('denies a revoked credential at its live read without sending to the admitted endpoint', async () => {
    const entered = gate();
    const resume = gate();
    let authorized = true;
    const settings = settingsFor('https://revoked.invalid/v1');
    const provider = new KeyOwnedOpenAIProvider(settings, {
      getKey: async () => {
        entered.open();
        await resume.promise;
        return authorized ? 'permitted' : null;
      },
      listKeys: async () => ['owned-key'],
      hasKey: async () => authorized,
    });
    const pending = drain(provider, optionsFor(settings));
    await entered.promise;
    authorized = false;
    resume.open();
    await expect(pending).rejects.toThrow('Credential resolution failed');
  });
});
