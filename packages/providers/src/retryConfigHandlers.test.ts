/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import { ProviderManager } from './ProviderManager.js';
import { OAuthManager } from './auth/oauth-manager.js';
import { MemoryTokenStore } from './auth/__tests__/behavioral/test-utils.js';
import { afterEach, describe, expect, it } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { OpenAIProvider } from './openai/OpenAIProvider.js';
import { RetryOrchestrator } from './RetryOrchestrator.js';
import type { GenerateChatOptions } from './IProvider.js';
import type { OnAuthErrorHandler } from '@vybestack/llxprt-code-core/config/configTypes.js';

async function consume(
  provider: RetryOrchestrator,
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

describe('owner-selected retry authentication over HTTP', () => {
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

  async function owner(alwaysReject = false) {
    const authorizations: Array<string | undefined> = [];
    const server = createServer((request, response) => {
      void (async () => {
        for await (const chunk of request) {
          void chunk;
        }
        const token = request.headers.authorization;
        authorizations.push(token);
        if (alwaysReject || token !== 'Bearer recovered-secret') {
          response.writeHead(401, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify({
              error: {
                message: 'Credential revoked',
                type: 'authentication_error',
              },
            }),
          );
          return;
        }
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            id: 'local-result',
            object: 'chat.completion',
            model: 'local-model',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'accepted' },
                finish_reason: 'stop',
              },
            ],
          }),
        );
      })().catch((error: unknown) =>
        response.destroy(
          error instanceof Error ? error : new Error(String(error)),
        ),
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Missing endpoint');
    const settings = new SettingsService();
    settings.set('streaming', 'disabled');
    settings.set('auth-key', 'revoked-secret');
    settings.setProviderSetting('openai', 'model', 'local-model');
    settings.setProviderSetting(
      'openai',
      'base-url',
      `http://127.0.0.1:${address.port}/v1`,
    );
    const config = createRuntimeConfigStub(settings);
    let credential: string | undefined = 'revoked-secret';
    const options: GenerateChatOptions = {
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'hello' }] },
      ],
      invocation: captureProviderInvocation(
        { settingsService: settings, runtimeId: 'same-label' },
        'openai',
      ),
      resolved: {
        authToken: { provide: () => credential },
        baseURL: `http://127.0.0.1:${address.port}/v1`,
        model: 'local-model',
      },
      metadata: { runtimeId: 'same-label' },
      systemInstruction: 'Respond to the user.',
    };
    const provider = new RetryOrchestrator(new OpenAIProvider(undefined), {
      maxAttempts: 4,
      initialDelayMs: 0,
    });
    return {
      provider,
      options,
      settings,
      config,
      authorizations,
      setCredential: (value: string | undefined): void => {
        credential = value;
      },
    };
  }

  it('recovers a real 401 using the selected live operation without Config handler discovery', async () => {
    const fixture = await owner();
    Object.assign(fixture.config, {
      getOnAuthErrorHandler: () => {
        throw new Error('Forbidden Config discovery');
      },
      getBucketFailoverHandler: () => {
        throw new Error('Forbidden Config discovery');
      },
    });
    const contexts: Array<
      Parameters<OnAuthErrorHandler['handleAuthError']>[0]
    > = [];
    const options = {
      ...fixture.options,
      handleAuthError: async (
        context: Parameters<OnAuthErrorHandler['handleAuthError']>[0],
      ): Promise<void> => {
        contexts.push(context);
        fixture.setCredential('recovered-secret');
      },
    };
    expect(await consume(fixture.provider, options)).toContain('accepted');
    expect(fixture.authorizations).toStrictEqual([
      'Bearer revoked-secret',
      'Bearer recovered-secret',
    ]);
    expect(contexts).toMatchObject([
      {
        providerId: 'openai',
        failedAccessToken: 'revoked-secret',
        errorStatus: 401,
      },
    ]);
  });

  it.each(['absent', 'unchanged', 'rejected'] as const)(
    'does not retry unauthorized transport when recovery is %s',
    async (mode) => {
      const fixture = await owner();
      const handleAuthError =
        mode === 'absent'
          ? undefined
          : async (): Promise<void> => {
              if (mode === 'rejected') throw new Error('Recovery unavailable');
            };
      await expect(
        consume(fixture.provider, { ...fixture.options, handleAuthError }),
      ).rejects.toThrow('Credential revoked');
      expect(fixture.authorizations).toStrictEqual(['Bearer revoked-secret']);
    },
  );

  it('does not repeatedly refresh a credential rejected again by the server', async () => {
    const fixture = await owner(true);
    let repairs = 0;
    const options = {
      ...fixture.options,
      handleAuthError: async (): Promise<void> => {
        repairs++;
        fixture.setCredential('recovered-secret');
      },
    };
    await expect(consume(fixture.provider, options)).rejects.toThrow(
      'Credential revoked',
    );
    expect(fixture.authorizations).toStrictEqual([
      'Bearer revoked-secret',
      'Bearer recovered-secret',
    ]);
    expect(repairs).toBe(1);
  });

  it('denies revoked live authority before another transport attempt', async () => {
    const fixture = await owner();
    const options = {
      ...fixture.options,
      handleAuthError: async (): Promise<void> => {
        fixture.setCredential(undefined);
      },
    };
    await expect(consume(fixture.provider, options)).rejects.toThrow(
      'Credential revoked',
    );
    expect(fixture.authorizations).toStrictEqual(['Bearer revoked-secret']);
  });

  it('uses the selected OAuth owner to refresh real HTTP credentials', async () => {
    const fixture = await owner();
    const store = new MemoryTokenStore();
    const token = {
      access_token: 'revoked-secret',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'refresh-secret',
    };
    await store.saveToken('openai', token);
    const oauth = new OAuthManager(store);
    oauth.registerProvider({
      name: 'openai',
      initiateAuth: async () => token,
      getToken: async () => null,
      refreshToken: async () => ({
        ...token,
        access_token: 'recovered-secret',
      }),
    });
    await oauth.toggleOAuthEnabled('openai');
    const result = await consume(fixture.provider, {
      ...fixture.options,
      ...oauth.composeRetryOperations('openai'),
      resolved: {
        authToken: {
          provide: async () => (await oauth.getToken('openai')) ?? undefined,
        },
      },
    });
    expect(result).toBe('accepted');
    expect(fixture.authorizations).toStrictEqual([
      'Bearer revoked-secret',
      'Bearer recovered-secret',
    ]);
  });

  it('selects the member profile recovery instead of the parent callbacks over HTTP', async () => {
    const fixture = await owner();
    const manager = new ProviderManager({
      settingsService: fixture.settings,
      config: fixture.config,
    });
    manager.registerProvider(new OpenAIProvider(undefined));
    manager.setRetryOperationsFactory((_providerName, profileId) => ({
      handleAuthError: async () => {
        if (profileId !== 'member-profile')
          throw new Error('Wrong member recovery scope');
        fixture.setCredential('recovered-secret');
      },
    }));
    const options = manager.normalizeRuntimeInputs(
      {
        ...fixture.options,
        metadata: { ...fixture.options.metadata, profileId: 'member-profile' },
        handleAuthError: async () => {
          throw new Error('Parent recovery must not run');
        },
      },
      'openai',
    );
    expect(await consume(fixture.provider, options)).toBe('accepted');
    expect(fixture.authorizations).toStrictEqual([
      'Bearer revoked-secret',
      'Bearer recovered-secret',
    ]);
  });

  it('keeps concurrent same-label owners recovery and credentials separate', async () => {
    const left = await owner();
    const right = await owner();
    const results = await Promise.allSettled([
      consume(left.provider, {
        ...left.options,
        handleAuthError: async (): Promise<void> =>
          left.setCredential('recovered-secret'),
      }),
      consume(right.provider, {
        ...right.options,
        handleAuthError: async (): Promise<void> => {},
      }),
    ]);
    expect(results.map((result) => result.status)).toStrictEqual([
      'fulfilled',
      'rejected',
    ]);
    expect(left.authorizations).toStrictEqual([
      'Bearer revoked-secret',
      'Bearer recovered-secret',
    ]);
    expect(right.authorizations).toStrictEqual(['Bearer revoked-secret']);
  });
});
