/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { buildMcpAuthFactoryRegistry } from '@vybestack/llxprt-code-mcp';
import {
  parseRuntimePluginManifest,
  RuntimePluginIncompatibleError,
  RuntimePluginMalformedError,
} from './manifest.js';
import {
  loadInstalledRuntimePlugins,
  loadRuntimePlugins,
} from './loadRuntimePlugins.js';
import type { ProviderAliasFactory } from './types.js';

const dormantProvider: ProviderAliasFactory = () => {
  throw new Error('provider activated before selection');
};

function providerManifest(): object {
  return {
    apiVersion: 1,
    id: 'finite-plugin',
    providers: [{ providerId: 'finite', createProvider: dormantProvider }],
  };
}

function malformed(value: unknown): RuntimePluginMalformedError {
  try {
    parseRuntimePluginManifest('finite-plugin', value);
  } catch (error) {
    if (error instanceof RuntimePluginMalformedError) return error;
    throw error;
  }
  throw new Error('malformed manifest was accepted');
}

describe('runtime plugin finite validation contract', () => {
  it('retains provider factory identity without activating it', () => {
    const manifest = parseRuntimePluginManifest(
      'finite-plugin',
      providerManifest(),
    );
    expect(manifest.providers[0].createProvider).toBe(dormantProvider);
  });

  it('retains callable MCP factories without activating them', () => {
    const createAuthProvider = (): never => {
      throw new Error('MCP auth activated before selection');
    };
    const manifest = parseRuntimePluginManifest('finite-plugin', {
      apiVersion: 1,
      id: 'auth-only',
      providers: [],
      mcpAuthFactories: [{ authProviderType: 'finite', createAuthProvider }],
    });
    expect(manifest.mcpAuthFactories?.[0].createAuthProvider).toBe(
      createAuthProvider,
    );
  });

  it.each([undefined, null, 42, 'factory', {}, []].map((value) => [value]))(
    'rejects non-callable provider values with their exact path: %p',
    (createProvider: unknown) => {
      const error = malformed({
        ...providerManifest(),
        providers: [{ providerId: 'finite', createProvider }],
      });
      expect(error.issues).toContain('providers.0.createProvider');
    },
  );

  it.each([undefined, null, 42, 'factory', {}, []].map((value) => [value]))(
    'rejects non-callable MCP values with their exact path: %p',
    (createAuthProvider: unknown) => {
      const error = malformed({
        apiVersion: 1,
        id: 'auth-only',
        providers: [],
        mcpAuthFactories: [{ authProviderType: 'finite', createAuthProvider }],
      });
      expect(error.issues).toContain('mcpAuthFactories.0.createAuthProvider');
    },
  );

  it.each([
    { ...providerManifest(), unauthorized: true },
    {
      ...providerManifest(),
      providers: [
        {
          providerId: 'finite',
          createProvider: dormantProvider,
          unauthorized: true,
        },
      ],
    },
    {
      ...providerManifest(),
      mcpAuthFactories: [
        {
          authProviderType: 'finite',
          createAuthProvider: () => {
            throw new Error('inactive');
          },
          unauthorized: true,
        },
      ],
    },
    {
      ...providerManifest(),
      providers: [
        {
          providerId: 'finite',
          createProvider: dormantProvider,
          builtinAliases: [
            {
              alias: 'finite',
              config: { baseProvider: 'finite' },
              unauthorized: true,
            },
          ],
        },
      ],
    },
  ])('rejects undeclared structural keys: %p', (value: unknown) => {
    expect(malformed(value).issues).toContain('unauthorized');
  });

  it('reports the alias config path without restricting provider-specific payloads', () => {
    const error = malformed({
      ...providerManifest(),
      providers: [
        {
          providerId: 'finite',
          createProvider: dormantProvider,
          builtinAliases: [{ alias: 'finite', config: { baseProvider: '' } }],
        },
      ],
    });
    expect(error.issues).toContain('providers.0.builtinAliases.0.config');
  });

  it('retains permissive shared cyclic alias payloads and freezes their data', () => {
    const shared: { providerSpecific: string; self?: object } = {
      providerSpecific: 'custom',
    };
    shared.self = shared;
    const config = { baseProvider: 'finite', customPayload: shared };
    const manifest = parseRuntimePluginManifest('finite-plugin', {
      ...providerManifest(),
      providers: [
        {
          providerId: 'finite',
          createProvider: dormantProvider,
          builtinAliases: [
            { alias: 'one', config },
            { alias: 'two', config },
          ],
        },
      ],
    });
    const aliases = manifest.providers[0].builtinAliases;
    if (!aliases) throw new Error('Missing aliases');
    expect(aliases[0].config).toBe(aliases[1].config);
    expect(shared.self).toBe(shared);
    expect(Reflect.set(shared, 'providerSpecific', 'changed')).toBe(false);
    expect(Reflect.set(config, 'baseProvider', 'changed')).toBe(false);
    expect(
      Reflect.set(manifest.providers[0], 'createProvider', () => null),
    ).toBe(false);
    expect(Object.isFrozen(aliases)).toBe(true);
    expect(Object.isFrozen(dormantProvider)).toBe(false);
  });

  it('distinguishes unsupported numeric versions from malformed version values', () => {
    expect(() =>
      parseRuntimePluginManifest('finite-plugin', {
        ...providerManifest(),
        apiVersion: 2,
      }),
    ).toThrow(RuntimePluginIncompatibleError);
    expect(
      malformed({ ...providerManifest(), apiVersion: '2' }).issues,
    ).toContain('apiVersion');
  });

  it('does not activate either kind of factory while loading and registering a plugin', async () => {
    const createAuthProvider = (): never => {
      throw new Error('MCP auth activated before selection');
    };
    const registry = await loadRuntimePlugins(['finite-plugin'], {
      importModule: async (): Promise<unknown> => ({
        llxprtRuntimePlugin: {
          ...providerManifest(),
          mcpAuthFactories: [
            { authProviderType: 'finite', createAuthProvider },
          ],
        },
      }),
    });
    expect(registry.getProviderFactory('finite')).toBe(dormantProvider);
    expect(
      registry.getMcpAuthFactories()[0].contribution.createAuthProvider,
    ).toBe(createAuthProvider);
  });

  it('retains independent same-name factory roots and live owner inputs through parsing and registration', async () => {
    const owners = [{ credential: 'first' }, { credential: 'second' }];
    const registries = await Promise.all(
      owners.map(async (owner) => {
        const registry = await loadRuntimePlugins(['same-plugin'], {
          importModule: async (): Promise<unknown> => ({
            llxprtRuntimePlugin: {
              apiVersion: 1,
              id: 'same-plugin',
              providers: [],
              mcpAuthFactories: [
                {
                  authProviderType: 'same-auth',
                  createAuthProvider: (config: { url?: string }): never => {
                    throw new Error(`${owner.credential}:${config.url}`);
                  },
                },
              ],
            },
          }),
        });
        return buildMcpAuthFactoryRegistry(
          registry.getMcpAuthFactories().map((entry) => entry.contribution),
        );
      }),
    );
    owners[0].credential = 'renewed-first';
    const first = registries[0].getAuthProviderFactory('SAME-AUTH');
    const second = registries[1].getAuthProviderFactory('same-auth');
    if (!first || !second) throw new Error('Missing owner factories');
    expect(() => first({ url: 'https://first.invalid' })).toThrow(
      'renewed-first:https://first.invalid',
    );
    expect(() => second({ url: 'https://second.invalid' })).toThrow(
      'second:https://second.invalid',
    );
    expect(first).not.toBe(second);
  });

  it('loads actual local installed provider and MCP plugin contributions', async () => {
    const registry = await loadInstalledRuntimePlugins();
    expect(registry.listProviderIds()).toContain('gemini');
    expect(
      registry
        .getContributedAliases()
        .some(
          (alias) =>
            alias.alias === 'gemini' && alias.config.baseProvider === 'gemini',
        ),
    ).toBe(true);
    expect(
      registry
        .getMcpAuthFactories()
        .map((entry) => entry.contribution.authProviderType),
    ).toStrictEqual(
      expect.arrayContaining([
        'google_credentials',
        'service_account_impersonation',
      ]),
    );
    expect(typeof registry.getProviderFactory('gemini')).toBe('function');
  });
});
