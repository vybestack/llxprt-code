/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  buildProviderContributionRegistry,
  createBuiltinProviderContributionRegistry,
} from './registry.js';
import type {
  LoadedRuntimePlugin,
  ProviderAliasFactory,
  RuntimeProviderContribution,
} from './types.js';

const BUILTIN_PROVIDER_IDS = [
  'openai',
  'openai-responses',
  'openaivercel',
  'openai-vercel',
  'gemini',
  'anthropic',
];

function noopFactory(): ProviderAliasFactory {
  return () => null;
}

function makePlugin(
  specifier: string,
  pluginId: string,
  providers: RuntimeProviderContribution[],
): LoadedRuntimePlugin {
  return {
    specifier,
    manifest: { apiVersion: 1, id: pluginId, providers },
  };
}

function contribution(
  providerId: string,
  overrides?: Partial<RuntimeProviderContribution>,
): RuntimeProviderContribution {
  return { providerId, createProvider: noopFactory(), ...overrides };
}

function captureError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
    throw new Error(`Expected an Error but got ${String(error)}`);
  }
  throw new Error('Expected the operation to throw');
}

describe('buildProviderContributionRegistry', () => {
  it('exposes exactly the built-in provider ids when no plugins are loaded', () => {
    expect(buildProviderContributionRegistry([]).listProviderIds()).toEqual(
      BUILTIN_PROVIDER_IDS,
    );
  });

  it('builds a built-ins-only registry from createBuiltinProviderContributionRegistry', () => {
    expect(
      createBuiltinProviderContributionRegistry().listProviderIds(),
    ).toEqual(BUILTIN_PROVIDER_IDS);
  });

  it('lists built-in ids first, then plugin providers in plugin order', () => {
    const registry = buildProviderContributionRegistry([
      makePlugin('first-pkg', 'first-plugin', [contribution('first-provider')]),
      makePlugin('second-pkg', 'second-plugin', [
        contribution('second-provider'),
        contribution('third-provider'),
      ]),
    ]);

    expect(registry.listProviderIds()).toEqual([
      ...BUILTIN_PROVIDER_IDS,
      'first-provider',
      'second-provider',
      'third-provider',
    ]);
  });

  it('resolves a provider factory by provider id with a plugin origin', () => {
    const factory = noopFactory();
    const registry = buildProviderContributionRegistry([
      makePlugin('pkg', 'plugin-a', [
        contribution('custom-provider', { createProvider: factory }),
      ]),
    ]);

    expect(registry.getProviderFactory('custom-provider')).toBe(factory);
    expect(registry.getProviderOrigin('custom-provider')).toEqual({
      kind: 'plugin',
      pluginId: 'plugin-a',
      specifier: 'pkg',
    });
  });

  it('resolves provider ids case-insensitively, and built-ins report a builtin origin', () => {
    const registry = buildProviderContributionRegistry([
      makePlugin('pkg', 'plugin-a', [contribution('Turbo')]),
    ]);

    const builtinFactory = registry.getProviderFactory('GEMINI');
    expect(builtinFactory).toBeTypeOf('function');
    expect(registry.getProviderOrigin('GEMINI')).toEqual({ kind: 'builtin' });
    expect(registry.getProviderFactory('turbo')).toBeTypeOf('function');
    expect(registry.getProviderOrigin('TURBO')).toEqual({
      kind: 'plugin',
      pluginId: 'plugin-a',
      specifier: 'pkg',
    });
    expect(registry.getProviderFactory('unknown-id')).toBeUndefined();
  });

  it('rejects a duplicate plugin id across two specifiers naming both specifiers', () => {
    const error = captureError(() =>
      buildProviderContributionRegistry([
        makePlugin('first-pkg', 'shared-id', [contribution('provider-a')]),
        makePlugin('second-pkg', 'shared-id', [contribution('provider-b')]),
      ]),
    );

    expect(error.message).toContain('shared-id');
    expect(error.message).toContain('first-pkg');
    expect(error.message).toContain('second-pkg');
  });

  it('rejects a duplicate provider id within one plugin', () => {
    const error = captureError(() =>
      buildProviderContributionRegistry([
        makePlugin('pkg', 'plugin-a', [
          contribution('dup-provider'),
          contribution('dup-provider'),
        ]),
      ]),
    );

    expect(error.message).toContain('dup-provider');
    expect(error.message).toContain('plugin-a');
  });

  it('rejects a duplicate provider id across two plugins naming both plugin ids', () => {
    const error = captureError(() =>
      buildProviderContributionRegistry([
        makePlugin('first-pkg', 'plugin-a', [contribution('shared-provider')]),
        makePlugin('second-pkg', 'plugin-b', [contribution('shared-provider')]),
      ]),
    );

    expect(error.message).toContain('shared-provider');
    expect(error.message).toContain("plugin 'plugin-a'");
    expect(error.message).toContain("plugin 'plugin-b'");
  });

  it('rejects a contributed provider id colliding with a built-in id, case-insensitively', () => {
    const error = captureError(() =>
      buildProviderContributionRegistry([
        makePlugin('pkg', 'plugin-a', [contribution('OpenAI')]),
      ]),
    );

    expect(error.message).toContain('OpenAI');
    expect(error.message).toContain('openai');
  });

  it('rejects a duplicate contributed alias across two plugins naming both plugin ids', () => {
    const error = captureError(() =>
      buildProviderContributionRegistry([
        makePlugin('first-pkg', 'plugin-a', [
          contribution('provider-a', {
            builtinAliases: [
              { alias: 'shared-alias', config: { baseProvider: 'provider-a' } },
            ],
          }),
        ]),
        makePlugin('second-pkg', 'plugin-b', [
          contribution('provider-b', {
            builtinAliases: [
              { alias: 'shared-alias', config: { baseProvider: 'provider-b' } },
            ],
          }),
        ]),
      ]),
    );

    expect(error.message).toContain('shared-alias');
    expect(error.message).toContain("plugin 'plugin-a'");
    expect(error.message).toContain("plugin 'plugin-b'");
  });

  it('exposes contributed aliases in plugin-configured order', () => {
    const registry = buildProviderContributionRegistry([
      makePlugin('first-pkg', 'plugin-a', [
        contribution('provider-a', {
          builtinAliases: [
            { alias: 'alias-first', config: { baseProvider: 'provider-a' } },
          ],
        }),
      ]),
      makePlugin('second-pkg', 'plugin-b', [
        contribution('provider-b', {
          builtinAliases: [
            { alias: 'alias-second', config: { baseProvider: 'provider-b' } },
          ],
        }),
      ]),
    ]);

    expect(
      registry.getContributedAliases().map((alias) => alias.alias),
    ).toEqual(['alias-first', 'alias-second']);
  });

  it('returns an immutable registry whose returned arrays are frozen copies', () => {
    const registry = buildProviderContributionRegistry([
      makePlugin('pkg', 'plugin-a', [
        contribution('provider-a', {
          builtinAliases: [
            { alias: 'alias-a', config: { baseProvider: 'provider-a' } },
          ],
        }),
      ]),
    ]);

    expect(Object.isFrozen(registry)).toBe(true);

    const ids = registry.listProviderIds();
    const aliases = registry.getContributedAliases();
    expect(() => {
      (ids as string[]).push('injected');
    }).toThrow(TypeError);
    expect(() => {
      (aliases as unknown[]).push({});
    }).toThrow(TypeError);

    // Origins are handed out by reference, so they must be frozen too;
    // otherwise a caller could rewrite what the registry reports later.
    const origin = registry.getProviderOrigin('provider-a');
    expect(() => {
      (origin as { pluginId: string }).pluginId = 'hijacked';
    }).toThrow(TypeError);
    expect(registry.getProviderOrigin('provider-a')).toEqual({
      kind: 'plugin',
      pluginId: 'plugin-a',
      specifier: 'pkg',
    });

    expect(registry.listProviderIds()).toEqual([
      ...BUILTIN_PROVIDER_IDS,
      'provider-a',
    ]);
  });
});
