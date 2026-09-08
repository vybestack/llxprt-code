/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { IProvider } from '../../IProvider.js';
import {
  loadRuntimePlugins,
  RuntimePluginIncompatibleError,
  RuntimePluginMalformedError,
} from './index.js';
import type { ProviderAliasFactory } from './types.js';

const BUILTIN_PROVIDER_IDS = [
  'openai',
  'openai-responses',
  'openaivercel',
  'openai-vercel',
  'gemini',
  'anthropic',
];

function noopFactory(): ProviderAliasFactory {
  return () => ({}) as unknown as IProvider;
}

function makeExport(
  pluginId: string,
  providers: unknown[],
): Record<string, unknown> {
  return {
    llxprtRuntimePlugin: {
      apiVersion: 1,
      id: pluginId,
      providers,
    },
  };
}

async function captureRejection(operation: Promise<unknown>): Promise<Error> {
  try {
    await operation;
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw new Error(`Expected an Error but got ${String(error)}`);
  }
  throw new Error('Expected the operation to reject');
}

function stubImports(modules: Record<string, unknown>): {
  importModule: (specifier: string) => Promise<unknown>;
} {
  return {
    importModule: (specifier: string): Promise<unknown> =>
      Promise.resolve(modules[specifier]),
  };
}

describe('loadRuntimePlugins', () => {
  it('returns a registry with exactly the built-in provider ids for an empty specifier list', async () => {
    const registry = await loadRuntimePlugins([], stubImports({}));

    expect(registry.listProviderIds()).toStrictEqual(BUILTIN_PROVIDER_IDS);
  });

  it('resolves one valid plugin and preserves the factory identity', async () => {
    const factory = noopFactory();
    const registry = await loadRuntimePlugins(
      ['my-plugin'],
      stubImports({
        'my-plugin': makeExport('my-plugin', [
          { providerId: 'my-provider', createProvider: factory },
        ]),
      }),
    );

    expect(registry.getProviderFactory('my-provider')).toBe(factory);
    expect(registry.getProviderOrigin('my-provider')).toStrictEqual({
      kind: 'plugin',
      pluginId: 'my-plugin',
      specifier: 'my-plugin',
    });
  });

  it('imports each specifier once, in configured order', async () => {
    const callOrder: string[] = [];
    const registry = await loadRuntimePlugins(['first-pkg', 'second-pkg'], {
      importModule: (specifier: string): Promise<unknown> => {
        callOrder.push(specifier);
        return Promise.resolve(
          makeExport(`plugin-${specifier}`, [
            {
              providerId: `provider-${specifier}`,
              createProvider: noopFactory(),
            },
          ]),
        );
      },
    });

    // Exact sequence: configured order, each specifier imported exactly once.
    expect(callOrder).toStrictEqual(['first-pkg', 'second-pkg']);

    expect(registry.listProviderIds()).toStrictEqual([
      ...BUILTIN_PROVIDER_IDS,
      'provider-first-pkg',
      'provider-second-pkg',
    ]);
  });

  it('rejects a missing module with an import failure naming the specifier and preserving the cause', async () => {
    const cause = new Error('Cannot find package missing-pkg');
    const error = await captureRejection(
      loadRuntimePlugins(['missing-pkg'], {
        importModule: () => Promise.reject(cause),
      }),
    );

    expect(error.message).toContain('missing-pkg');
    expect(error.cause).toBe(cause);
  });

  it('rejects a resolver that throws synchronously, preserving the cause', async () => {
    // Distinct from the rejected-promise path above: this exercises the resolver
    // throwing before it ever returns a promise.
    const cause = new Error('evaluation blew up');
    const error = await captureRejection(
      loadRuntimePlugins(['exploding-pkg'], {
        importModule: (): Promise<unknown> => {
          throw cause;
        },
      }),
    );

    expect(error.message).toContain('exploding-pkg');
    expect(error.cause).toBe(cause);
  });

  it('rejects a module without the llxprtRuntimePlugin export naming the export name', async () => {
    const error = await captureRejection(
      loadRuntimePlugins(
        ['no-export-pkg'],
        stubImports({ 'no-export-pkg': { somethingElse: true } }),
      ),
    );

    expect(error.message).toContain('no-export-pkg');
    expect(error.message).toContain('llxprtRuntimePlugin');
  });

  it('propagates a malformed manifest error naming the specifier', async () => {
    const error = await captureRejection(
      loadRuntimePlugins(
        ['bad-manifest-pkg'],
        stubImports({
          'bad-manifest-pkg': {
            llxprtRuntimePlugin: {
              apiVersion: 1,
              id: '',
              providers: [{ providerId: 'x', createProvider: () => null }],
            },
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(RuntimePluginMalformedError);
    expect(error.message).toContain('bad-manifest-pkg');
  });

  it('propagates an incompatible apiVersion error naming the specifier', async () => {
    const error = await captureRejection(
      loadRuntimePlugins(
        ['future-pkg'],
        stubImports({
          'future-pkg': {
            llxprtRuntimePlugin: {
              apiVersion: 99,
              id: 'future',
              providers: [
                {
                  providerId: 'future-provider',
                  createProvider: () => ({}) as unknown as IProvider,
                },
              ],
            },
          },
        }),
      ),
    );

    expect(error).toBeInstanceOf(RuntimePluginIncompatibleError);
    expect(error.message).toContain('future-pkg');
  });

  it('rejects a duplicate plugin id across two specifiers naming both specifiers', async () => {
    const error = await captureRejection(
      loadRuntimePlugins(['first-pkg', 'second-pkg'], {
        importModule: (specifier: string): Promise<unknown> =>
          Promise.resolve(
            makeExport('same-id', [
              {
                providerId: `provider-${specifier}`,
                createProvider: noopFactory(),
              },
            ]),
          ),
      }),
    );

    expect(error.message).toContain('same-id');
    expect(error.message).toContain('first-pkg');
    expect(error.message).toContain('second-pkg');
  });

  it('rejects a duplicate provider id across two plugins naming both plugin ids', async () => {
    const error = await captureRejection(
      loadRuntimePlugins(['first-pkg', 'second-pkg'], {
        importModule: (specifier: string): Promise<unknown> =>
          Promise.resolve(
            makeExport(specifier, [
              {
                providerId: 'shared-provider',
                createProvider: noopFactory(),
              },
            ]),
          ),
      }),
    );

    expect(error.message).toContain('shared-provider');
    expect(error.message).toContain("plugin 'first-pkg'");
    expect(error.message).toContain("plugin 'second-pkg'");
  });

  it('rejects a duplicate provider id within one plugin', async () => {
    const error = await captureRejection(
      loadRuntimePlugins(['dup-provider-pkg'], {
        importModule: (specifier: string): Promise<unknown> =>
          Promise.resolve(
            makeExport(specifier, [
              { providerId: 'dup', createProvider: noopFactory() },
              { providerId: 'dup', createProvider: noopFactory() },
            ]),
          ),
      }),
    );

    expect(error.message).toContain('dup');
    expect(error.message).toContain("plugin 'dup-provider-pkg'");
  });

  it('rejects a contributed provider id equal to a built-in id naming the built-in', async () => {
    const error = await captureRejection(
      loadRuntimePlugins(
        ['shadows-openai-pkg'],
        stubImports({
          'shadows-openai-pkg': makeExport('shadow', [
            { providerId: 'openai', createProvider: noopFactory() },
          ]),
        }),
      ),
    );

    expect(error.message).toContain('openai');
  });

  it('rejects a duplicate contributed alias name across two plugins naming both plugin ids', async () => {
    const error = await captureRejection(
      loadRuntimePlugins(['first-pkg', 'second-pkg'], {
        importModule: (specifier: string): Promise<unknown> =>
          Promise.resolve(
            makeExport(specifier, [
              {
                providerId: `provider-${specifier}`,
                createProvider: noopFactory(),
                builtinAliases: [
                  {
                    alias: 'dup-alias',
                    config: { baseProvider: `provider-${specifier}` },
                  },
                ],
              },
            ]),
          ),
      }),
    );

    expect(error.message).toContain('dup-alias');
    expect(error.message).toContain("plugin 'first-pkg'");
    expect(error.message).toContain("plugin 'second-pkg'");
  });

  it('stops importing further packages once a collision is known', async () => {
    const callOrder: string[] = [];
    const modules: Record<string, unknown> = {
      'first-pkg': makeExport('plugin-one', [
        { providerId: 'shared-provider', createProvider: noopFactory() },
      ]),
      // Collides with first-pkg's provider id.
      'second-pkg': makeExport('plugin-two', [
        { providerId: 'shared-provider', createProvider: noopFactory() },
      ]),
      'third-pkg': makeExport('plugin-three', [
        { providerId: 'late-provider', createProvider: noopFactory() },
      ]),
    };

    const error = await captureRejection(
      loadRuntimePlugins(['first-pkg', 'second-pkg', 'third-pkg'], {
        importModule: (specifier: string): Promise<unknown> => {
          callOrder.push(specifier);
          return Promise.resolve(modules[specifier]);
        },
      }),
    );

    expect(error.message).toContain('shared-provider');
    // Importing a package executes its module body, so a configuration that is
    // already known to be invalid must not run any more plugin code.
    expect(callOrder).toStrictEqual(['first-pkg', 'second-pkg']);
  });

  it('returns an immutable registry exposing contributed aliases in plugin order', async () => {
    const registry = await loadRuntimePlugins(['first-pkg', 'second-pkg'], {
      importModule: (specifier: string): Promise<unknown> =>
        Promise.resolve(
          makeExport(specifier, [
            {
              providerId: `provider-${specifier}`,
              createProvider: noopFactory(),
              builtinAliases: [
                {
                  alias: `alias-${specifier}`,
                  config: { baseProvider: `provider-${specifier}` },
                },
              ],
            },
          ]),
        ),
    });

    expect(Object.isFrozen(registry)).toBe(true);
    expect(
      registry.getContributedAliases().map((alias) => alias.alias),
    ).toStrictEqual(['alias-first-pkg', 'alias-second-pkg']);
  });
});
