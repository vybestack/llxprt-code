/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for issue #2758 AC6/AC7: alias construction dispatches
 * through the provider contribution registry, built-in aliases keep their
 * existing behavior, unknown base providers fail fast, and contributed aliases
 * merge deterministically behind file aliases.
 *
 * The only stubbed boundary is module resolution (`deps.importModule`). The
 * ProviderManager, registerAliasProviders, the registry, and the built-in
 * factories are all real.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { ProviderManager } from '../ProviderManager.js';
import { OAuthManager, createTokenStore } from '../auth/index.js';
import {
  createOpenAIAliasProvider,
  registerAliasProviders,
} from './aliasProviderFactory.js';
import {
  createProviderManager,
  refreshAliasProviders,
  registerProviderManagerSingleton,
  resetProviderManager,
} from './providerManagerInstance.js';
import {
  createBuiltinProviderContributionRegistry,
  loadRuntimePlugins,
} from './runtimePlugins/index.js';
import type { ProviderContributionRegistry } from './runtimePlugins/types.js';
import type {
  ProviderAliasConfig,
  ProviderAliasEntry,
} from './providerAliases.js';
import type { IProvider } from '../IProvider.js';
import type { IProviderConfig } from '../types/IProviderConfig.js';

const OAUTH_MANAGER = new OAuthManager(createTokenStore(), undefined, {});
const EMPTY_PROVIDER_CONFIG: IProviderConfig = {};
const FALLBACK_BASE_URL = 'https://fallback.example.com/v1';

function makeAliasEntry(
  alias: string,
  config: ProviderAliasConfig,
): ProviderAliasEntry {
  return {
    alias,
    config,
    filePath: `/config/providers/${alias}.config`,
    source: 'user',
  };
}

function makeManager(): ProviderManager {
  return new ProviderManager({
    settingsService: new SettingsService() as never,
    runtimeId: 'issue2758-contributions-test',
  });
}

/**
 * A plugin provider whose model list is derived from the alias entry, so an
 * assertion on the models proves the real factory ran for the real entry
 * rather than echoing a configured literal.
 */
function aliasEchoProvider(entry: ProviderAliasEntry): IProvider {
  return {
    name: entry.alias,
    getModels: () =>
      Promise.resolve([
        {
          id: `${entry.config.baseProvider}:${entry.alias}`,
          name: entry.alias,
          provider: entry.alias,
          supportedToolFormats: ['openai'],
        },
      ]),
    getServerTools: () => [],
    invokeServerTool: () =>
      Promise.reject(new Error('no server tools in this test provider')),
    getDefaultModel: () => `${entry.alias}-default`,
    generateChatCompletion: () => {
      throw new Error('not exercised by these tests');
    },
  } as unknown as IProvider;
}

interface PluginStubOptions {
  readonly providerId?: string;
  readonly aliasName?: string;
  readonly factory?: (entry: ProviderAliasEntry) => IProvider | null;
}

function pluginModule(
  pluginId: string,
  options: PluginStubOptions = {},
): Record<string, unknown> {
  const providerId = options.providerId ?? `${pluginId}-provider`;
  return {
    llxprtRuntimePlugin: {
      apiVersion: 1,
      id: pluginId,
      providers: [
        {
          providerId,
          createProvider: options.factory ?? aliasEchoProvider,
          ...(options.aliasName === undefined
            ? {}
            : {
                builtinAliases: [
                  {
                    alias: options.aliasName,
                    config: { baseProvider: providerId },
                  },
                ],
              }),
        },
      ],
    },
  };
}

async function registryFor(
  modules: Record<string, Record<string, unknown>>,
): Promise<ProviderContributionRegistry> {
  return loadRuntimePlugins(Object.keys(modules), {
    importModule: (specifier: string) => Promise.resolve(modules[specifier]),
  });
}

function register(
  manager: ProviderManager,
  entries: ProviderAliasEntry[],
  contributions?: ProviderContributionRegistry,
): void {
  registerAliasProviders(
    manager,
    entries,
    'sk-test',
    FALLBACK_BASE_URL,
    EMPTY_PROVIDER_CONFIG,
    OAUTH_MANAGER,
    undefined,
    false,
    contributions === undefined ? {} : { providerContributions: contributions },
  );
}

function registeredProvider(manager: ProviderManager, name: string): IProvider {
  const provider = manager.getProviderByName(name);
  if (!provider) {
    throw new Error(`expected provider '${name}' to be registered`);
  }
  return provider;
}

async function modelIds(provider: IProvider): Promise<string[]> {
  const models = await provider.getModels();
  return models.map((model) => model.id);
}

interface OAuthAwareProvider {
  isOAuthOnlyAvailable(): Promise<boolean>;
}

function isOAuthAwareProvider(
  provider: IProvider,
): provider is IProvider & OAuthAwareProvider {
  return (
    'isOAuthOnlyAvailable' in provider &&
    typeof (provider as { isOAuthOnlyAvailable: unknown })
      .isOAuthOnlyAvailable === 'function'
  );
}

async function oauthOnlyAvailable(provider: IProvider): Promise<boolean> {
  if (!isOAuthAwareProvider(provider)) {
    throw new Error(
      `provider '${provider.name}' does not expose isOAuthOnlyAvailable()`,
    );
  }
  return provider.isOAuthOnlyAvailable();
}

describe('registerAliasProviders registry dispatch', () => {
  it('registers a built-in openai alias through the built-in contribution path', async () => {
    const manager = makeManager();

    register(manager, [
      makeAliasEntry('builtin-alias', {
        baseProvider: 'openai',
        'base-url': 'https://builtin.example.com/v1',
        staticModels: [{ id: 'builtin-model', name: 'Builtin Model' }],
      }),
    ]);

    expect(manager.listProviders()).toContain('builtin-alias');
    const provider = registeredProvider(manager, 'builtin-alias');
    expect(provider.name).toBe('builtin-alias');
    expect(await modelIds(provider)).toEqual(['builtin-model']);
  });

  it('creates an alias whose baseProvider is contributed by a plugin using the plugin factory', async () => {
    const contributions = await registryFor({
      'plugin-pkg': pluginModule('plugin-pkg'),
    });
    const manager = makeManager();

    register(
      manager,
      [
        makeAliasEntry('plugin-alias', {
          baseProvider: 'plugin-pkg-provider',
        }),
      ],
      contributions,
    );

    const provider = registeredProvider(manager, 'plugin-alias');
    expect(provider.name).toBe('plugin-alias');
    expect(await modelIds(provider)).toEqual([
      'plugin-pkg-provider:plugin-alias',
    ]);
  });

  it('throws for an alias whose baseProvider is neither built-in nor contributed', async () => {
    const contributions = await registryFor({
      'plugin-pkg': pluginModule('plugin-pkg'),
    });
    const manager = makeManager();
    const entries = [
      makeAliasEntry('ghost-alias', { baseProvider: 'no-such-provider' }),
    ];

    let thrown: unknown;
    try {
      register(manager, entries, contributions);
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof Error)) {
      throw new Error('expected registerAliasProviders to throw an Error');
    }
    expect(thrown.message).toContain('ghost-alias');
    expect(thrown.message).toContain('no-such-provider');
    expect(thrown.message).toContain('openai');
    expect(thrown.message).toContain('plugin-pkg-provider');
    expect(manager.listProviders()).not.toContain('ghost-alias');
  });

  it('registers aliases contributed by a plugin manifest', async () => {
    const contributions = await registryFor({
      'plugin-pkg': pluginModule('plugin-pkg', {
        aliasName: 'contributed-alias',
      }),
    });
    const manager = makeManager();

    register(manager, [], contributions);

    const provider = registeredProvider(manager, 'contributed-alias');
    expect(provider.name).toBe('contributed-alias');
    expect(await modelIds(provider)).toEqual([
      'plugin-pkg-provider:contributed-alias',
    ]);
  });

  it('gives a contributed alias an honest plugin origin instead of a fabricated file path', async () => {
    const seen: ProviderAliasEntry[] = [];
    const contributions = await registryFor({
      'plugin-pkg': pluginModule('plugin-pkg', {
        aliasName: 'origin-alias',
        factory: (entry) => {
          seen.push(entry);
          return aliasEchoProvider(entry);
        },
      }),
    });

    register(makeManager(), [], contributions);

    expect(seen).toHaveLength(1);
    expect(seen[0].source).toBe('plugin');
    expect(seen[0].filePath).toBe('plugin:plugin-pkg');
  });

  it('lets a file alias win over a contributed alias with the same name', async () => {
    const contributions = await registryFor({
      'plugin-pkg': pluginModule('plugin-pkg', { aliasName: 'shared-name' }),
    });
    const manager = makeManager();

    register(
      manager,
      [
        makeAliasEntry('shared-name', {
          baseProvider: 'openai',
          'base-url': 'https://file.example.com/v1',
          staticModels: [{ id: 'file-model', name: 'File Model' }],
        }),
      ],
      contributions,
    );

    const provider = registeredProvider(manager, 'shared-name');
    // The contributed alias would have produced 'plugin-pkg-provider:shared-name'.
    expect(await modelIds(provider)).toEqual(['file-model']);
    expect(
      manager.listProviders().filter((name) => name === 'shared-name'),
    ).toHaveLength(1);
  });

  it('keeps the claudecode-only OAuth binding when dispatching through the registry', async () => {
    const factory =
      createBuiltinProviderContributionRegistry().getProviderFactory(
        'anthropic',
      );
    if (!factory) {
      throw new Error('expected a built-in anthropic factory');
    }
    const context = {
      openaiApiKey: undefined,
      openaiBaseUrl: undefined,
      openaiProviderConfig: EMPTY_PROVIDER_CONFIG,
      oauthManager: OAUTH_MANAGER,
      config: undefined,
      authOnlyEnabled: false,
    };

    const claudecode = factory(
      makeAliasEntry('claudecode', { baseProvider: 'anthropic' }),
      context,
    );
    const anthropic = factory(
      makeAliasEntry('anthropic', { baseProvider: 'anthropic' }),
      context,
    );

    expect(claudecode.name).toBe('claudecode');
    expect(anthropic.name).toBe('anthropic');
    // Only the subscription identity is bound to the OAuth manager, so with no
    // API key configured OAuth is the only auth route for `claudecode` and is
    // not available at all for the API-key-only `anthropic` alias.
    expect(await oauthOnlyAvailable(claudecode)).toBe(true);
    expect(await oauthOnlyAvailable(anthropic)).toBe(false);
  });

  it('cannot let a plugin shadow a built-in alias file', async () => {
    // Built-in aliases arrive as file entries (source 'builtin'), so the
    // file-wins precedence rule protects them from a plugin contributing the
    // same alias name. Pinned explicitly because plugins are trusted-but-foreign
    // input and this is the boundary that stops one hijacking a known alias.
    //
    // Uses 'kimi' rather than 'gemini': an alias whose name is also a PROVIDER
    // id is rejected earlier, when the registry is built, so it would not reach
    // this precedence rule at all.
    const contributions = await registryFor({
      'plugin-pkg': pluginModule('plugin-pkg', { aliasName: 'kimi' }),
    });
    const manager = makeManager();
    const builtinEntry: ProviderAliasEntry = {
      alias: 'kimi',
      config: {
        baseProvider: 'openai',
        'base-url': 'https://builtin-file.example.com/v1',
        staticModels: [
          { id: 'builtin-file-model', name: 'Builtin File Model' },
        ],
      },
      filePath: '/builtin/providers/kimi.config',
      source: 'builtin',
    };

    register(manager, [builtinEntry], contributions);

    const provider = registeredProvider(manager, 'kimi');
    // The plugin's factory would have produced 'plugin-pkg-provider:kimi'.
    expect(await modelIds(provider)).toEqual(['builtin-file-model']);
  });

  it('registers nothing when a later alias is unresolvable, leaving the manager untouched', async () => {
    const contributions = await registryFor({
      'plugin-pkg': pluginModule('plugin-pkg'),
    });
    const manager = makeManager();

    expect(() =>
      register(
        manager,
        [
          makeAliasEntry('good-alias', {
            baseProvider: 'plugin-pkg-provider',
          }),
          makeAliasEntry('bad-alias', { baseProvider: 'no-such-provider' }),
        ],
        contributions,
      ),
    ).toThrow(/no-such-provider/);

    // Registration is all-or-nothing: refresh runs this against a live manager,
    // so one bad alias must not leave the set half-swapped.
    expect(manager.listProviders()).not.toContain('good-alias');
    expect(manager.listProviders()).not.toContain('bad-alias');
  });

  it('names the alias source file when a base provider cannot be resolved', () => {
    expect(() =>
      register(makeManager(), [
        makeAliasEntry('traceable-alias', { baseProvider: 'missing-provider' }),
      ]),
    ).toThrow(/\/config\/providers\/traceable-alias\.config/);
  });

  it('uses the built-ins-only registry when no contributions are supplied', () => {
    const manager = makeManager();

    register(manager, [
      makeAliasEntry('default-registry-alias', {
        baseProvider: 'openai',
        'base-url': 'https://default.example.com/v1',
      }),
    ]);

    expect(manager.listProviders()).toContain('default-registry-alias');
  });
});

describe('refreshAliasProviders registry reuse', () => {
  afterEach(() => {
    resetProviderManager();
  });

  it('re-registers contributed aliases through the registry createProviderManager was given', async () => {
    // Each factory call stamps an incrementing generation into the model id, so
    // a second generation after refresh proves the plugin factory ran again
    // through the registry stored on the manager's registration context.
    let generation = 0;
    const contributions = await registryFor({
      'plugin-pkg': pluginModule('plugin-pkg', {
        aliasName: 'refresh-alias',
        factory: (entry) => {
          generation += 1;
          const stampedGeneration = generation;
          return {
            name: entry.alias,
            getModels: () =>
              Promise.resolve([
                {
                  id: `${entry.alias}-gen${stampedGeneration}`,
                  name: entry.alias,
                  provider: entry.alias,
                  supportedToolFormats: ['openai'],
                },
              ]),
            getServerTools: () => [],
            invokeServerTool: () =>
              Promise.reject(new Error('no server tools in this test')),
          } as unknown as IProvider;
        },
      }),
    });

    const { manager, oauthManager } = createProviderManager(
      {
        settingsService: new SettingsService(),
        runtimeId: 'issue2758-refresh-test',
      } as never,
      {
        providerContributions: contributions,
        activateConfiguredProvider: false,
      },
    );
    registerProviderManagerSingleton(manager, oauthManager);

    expect(
      await modelIds(registeredProvider(manager, 'refresh-alias')),
    ).toEqual(['refresh-alias-gen1']);

    refreshAliasProviders();

    expect(
      await modelIds(registeredProvider(manager, 'refresh-alias')),
    ).toEqual(['refresh-alias-gen2']);
  });
});

describe('built-in alias factory parity', () => {
  it('still yields a named provider when a base URL is available', () => {
    const provider = createOpenAIAliasProvider(
      makeAliasEntry('direct-alias', {
        baseProvider: 'openai',
        'base-url': 'https://direct.example.com/v1',
      }),
      'sk-direct',
      'https://direct.example.com/v1',
      EMPTY_PROVIDER_CONFIG,
    );

    expect(provider.name).toBe('direct-alias');
  });

  it('throws instead of skipping when no base URL is available', () => {
    // Silently dropping a provider the user configured leaves them with a
    // missing provider and no explanation. The error names the alias and the
    // file it came from.
    let thrown: unknown;
    try {
      createOpenAIAliasProvider(
        makeAliasEntry('no-base-url', { baseProvider: 'openai' }),
        undefined,
        undefined,
        EMPTY_PROVIDER_CONFIG,
      );
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof Error)) {
      throw new Error('expected createOpenAIAliasProvider to throw');
    }
    expect(thrown.message).toContain('no-base-url');
    expect(thrown.message).toContain('base-url');
    expect(thrown.message).toContain('/config/providers/no-base-url.config');
  });

  it('exposes exactly the built-in provider ids', () => {
    expect(
      createBuiltinProviderContributionRegistry().listProviderIds(),
    ).toEqual([
      'openai',
      'openai-responses',
      'openaivercel',
      'openai-vercel',
      'gemini',
      'anthropic',
    ]);
  });
});
