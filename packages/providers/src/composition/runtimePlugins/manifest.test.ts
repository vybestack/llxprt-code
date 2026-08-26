/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  parseRuntimePluginManifest,
  RUNTIME_PLUGIN_SUPPORTED_API_VERSION,
  RuntimePluginIncompatibleError,
  RuntimePluginMalformedError,
} from './manifest.js';
import type { ProviderAliasFactory } from './types.js';

const SPECIFIER = 'my-plugin';

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

function validManifest(overrides?: {
  providers?: unknown[];
  id?: string;
}): Record<string, unknown> {
  return {
    apiVersion: 1,
    id: 'theme-plugin',
    providers: [
      {
        providerId: 'theme',
        createProvider: () => null,
      },
    ],
    ...overrides,
  };
}

function validFactory(): ProviderAliasFactory {
  return () => null;
}

describe('parseRuntimePluginManifest', () => {
  it('parses a valid v1 manifest and returns a deep-frozen object', () => {
    const factory = validFactory();
    const manifest = parseRuntimePluginManifest(SPECIFIER, {
      apiVersion: 1,
      id: 'theme-plugin',
      providers: [
        {
          providerId: 'theme',
          createProvider: factory,
          builtinAliases: [
            {
              alias: 'theme-alias',
              config: { baseProvider: 'theme', 'base-url': 'https://x' },
            },
          ],
        },
      ],
    });

    expect(manifest.apiVersion).toBe(RUNTIME_PLUGIN_SUPPORTED_API_VERSION);
    expect(manifest.id).toBe('theme-plugin');
    expect(manifest.providers[0].providerId).toBe('theme');
    expect(manifest.providers[0].createProvider).toBe(factory);

    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.providers)).toBe(true);
    expect(Object.isFrozen(manifest.providers[0])).toBe(true);

    const aliases = manifest.providers[0].builtinAliases ?? [];
    expect(Object.isFrozen(aliases)).toBe(true);
    expect(Object.isFrozen(aliases[0])).toBe(true);
    expect(Object.isFrozen(aliases[0].config)).toBe(true);
  });

  it('rejects mutation of the frozen providers array and a frozen contribution', () => {
    const manifest = parseRuntimePluginManifest(SPECIFIER, validManifest());

    expect(() => {
      (manifest.providers as unknown[]).push({
        providerId: 'other',
        createProvider: () => null,
      });
    }).toThrow(TypeError);

    expect(() => {
      (manifest.providers[0] as { providerId: string }).providerId = 'mutated';
    }).toThrow(TypeError);
  });
  it('freezes alias config data nested inside builtinAliases', () => {
    const manifest = parseRuntimePluginManifest(SPECIFIER, {
      apiVersion: 1,
      id: 'nested-plugin',
      providers: [
        {
          providerId: 'nested',
          createProvider: () => null,
          builtinAliases: [
            {
              alias: 'nested-alias',
              config: {
                baseProvider: 'nested',
                staticModels: [{ id: 'model-a', name: 'Model A' }],
                providerConfig: { nested: { deep: true } },
              },
            },
          ],
        },
      ],
    });

    const alias = manifest.providers[0].builtinAliases?.[0];
    if (!alias) {
      throw new Error('expected a contributed alias');
    }
    const staticModels = alias.config.staticModels;
    const nestedProviderConfig = alias.config.providerConfig?.['nested'];
    if (!staticModels || typeof nestedProviderConfig !== 'object') {
      throw new Error('expected the contributed alias config to be populated');
    }

    // A plugin must not be able to mutate its own validated manifest after
    // parsing, including between alias refreshes.
    expect(() => {
      staticModels.push({ id: 'injected', name: 'Injected' });
    }).toThrow(TypeError);
    expect(() => {
      staticModels[0].id = 'mutated';
    }).toThrow(TypeError);
    expect(() => {
      (nestedProviderConfig as { deep: boolean }).deep = false;
    }).toThrow(TypeError);
    expect(staticModels.map((model) => model.id)).toEqual(['model-a']);
  });

  it('rejects apiVersion 2 as an incompatible plugin naming observed and supported versions and the specifier', () => {
    const error = captureError(() =>
      parseRuntimePluginManifest(SPECIFIER, {
        apiVersion: 2,
        id: 'next-plugin',
        providers: [{ providerId: 'next', createProvider: () => null }],
      }),
    );

    expect(error).toBeInstanceOf(RuntimePluginIncompatibleError);
    expect(error.message).toContain(SPECIFIER);
    expect(error.message).toContain('2');
    expect(error.message).toContain(
      String(RUNTIME_PLUGIN_SUPPORTED_API_VERSION),
    );
    if (!(error instanceof RuntimePluginIncompatibleError)) {
      throw error;
    }
    expect(error.observedVersion).toBe(2);
    expect(error.supportedVersion).toBe(RUNTIME_PLUGIN_SUPPORTED_API_VERSION);
    expect(error.specifier).toBe(SPECIFIER);
  });

  it('rejects a manifest without apiVersion as malformed, naming the specifier', () => {
    const { apiVersion: _apiVersion, ...withoutVersion } = validManifest();
    const error = captureError(() =>
      parseRuntimePluginManifest(SPECIFIER, withoutVersion),
    );

    expect(error).toBeInstanceOf(RuntimePluginMalformedError);
    expect(error.message).toContain(SPECIFIER);
    expect(error.message).toContain('apiVersion');
  });

  it('rejects an empty id as malformed', () => {
    const error = captureError(() =>
      parseRuntimePluginManifest(SPECIFIER, { ...validManifest(), id: '' }),
    );

    expect(error).toBeInstanceOf(RuntimePluginMalformedError);
    expect(error.message).toContain(SPECIFIER);
  });

  it('rejects an empty providers array as malformed', () => {
    const error = captureError(() =>
      parseRuntimePluginManifest(SPECIFIER, {
        ...validManifest(),
        providers: [],
      }),
    );

    expect(error).toBeInstanceOf(RuntimePluginMalformedError);
    expect(error.message).toContain(SPECIFIER);
    expect(error.message).toContain('providers');
  });

  it('rejects a contribution with a non-function createProvider as malformed', () => {
    const error = captureError(() =>
      parseRuntimePluginManifest(SPECIFIER, {
        ...validManifest(),
        providers: [{ providerId: 'theme', createProvider: 'not-a-function' }],
      }),
    );

    expect(error).toBeInstanceOf(RuntimePluginMalformedError);
    expect(error.message).toContain(SPECIFIER);
  });

  it('rejects a contribution with an empty providerId as malformed', () => {
    const error = captureError(() =>
      parseRuntimePluginManifest(SPECIFIER, {
        ...validManifest(),
        providers: [{ providerId: '', createProvider: () => null }],
      }),
    );

    expect(error).toBeInstanceOf(RuntimePluginMalformedError);
    expect(error.message).toContain(SPECIFIER);
  });

  it('rejects a builtinAliases entry missing baseProvider as malformed', () => {
    const error = captureError(() =>
      parseRuntimePluginManifest(SPECIFIER, {
        ...validManifest(),
        providers: [
          {
            providerId: 'theme',
            createProvider: () => null,
            builtinAliases: [
              {
                alias: 'theme-alias',
                config: { description: 'no base provider' },
              },
            ],
          },
        ],
      }),
    );

    expect(error).toBeInstanceOf(RuntimePluginMalformedError);
    expect(error.message).toContain(SPECIFIER);
    // A plugin author needs to know WHICH field is wrong, not just that
    // something is. Guards against the message degrading to 'Invalid input'.
    expect(error.message).toContain('baseProvider');
    expect(error.message).toContain('builtinAliases');
  });

  it('includes the Zod issue path in the malformed error message', () => {
    const error = captureError(() =>
      parseRuntimePluginManifest(SPECIFIER, {
        ...validManifest(),
        providers: [
          { providerId: 'theme', createProvider: 'nope', builtinAliases: [] },
        ],
      }),
    );

    expect(error).toBeInstanceOf(RuntimePluginMalformedError);
    expect(error.message).toContain('providers');
    expect(error.message).toContain('createProvider');
  });

  it('rejects unknown keys on the manifest and contributions as malformed (strict)', () => {
    const unknownManifestKey = captureError(() =>
      parseRuntimePluginManifest(SPECIFIER, {
        ...validManifest(),
        extraSetting: 'surprise',
      }),
    );
    expect(unknownManifestKey).toBeInstanceOf(RuntimePluginMalformedError);

    const unknownContributionKey = captureError(() =>
      parseRuntimePluginManifest(SPECIFIER, {
        ...validManifest(),
        providers: [
          {
            providerId: 'theme',
            createProvider: () => null,
            unexpectedField: 42,
          },
        ],
      }),
    );
    expect(unknownContributionKey).toBeInstanceOf(RuntimePluginMalformedError);
  });
});
