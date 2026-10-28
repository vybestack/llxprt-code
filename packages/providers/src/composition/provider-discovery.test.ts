/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { listProviderAliasNames } from './aliasProviderFactory.js';
import { buildProviderContributionRegistry } from './runtimePlugins/registry.js';
import type { ProviderAliasEntry } from './providerAliases.js';

function alias(alias: string, baseProvider = 'openai'): ProviderAliasEntry {
  return {
    alias,
    config: { baseProvider },
    filePath: `/providers/${alias}.config`,
    source: 'user',
  };
}

describe('provider discovery from canonical alias data', () => {
  it('retains registration order and normalized names without duplicate provider identities', () => {
    const names = listProviderAliasNames([
      alias(' first '),
      alias('second', 'anthropic'),
      alias('first'),
    ]);
    expect(names).toStrictEqual(['first', 'second']);
    expect(Reflect.set(names, 0, 'changed')).toBe(false);
    expect(names[0]).toBe('first');
  });

  it('validates every alias before collapsing repeated identities', () => {
    expect(() =>
      listProviderAliasNames([
        alias('same'),
        alias('same', 'unsupported-provider'),
      ]),
    ).toThrow("requests base provider 'unsupported-provider'");
  });

  it('keeps file precedence over contributed aliases without invoking provider factories', () => {
    const registry = buildProviderContributionRegistry([
      {
        specifier: 'data-only-plugin',
        manifest: {
          apiVersion: 1,
          id: 'data-only-plugin',
          providers: [
            {
              providerId: 'data-only',
              createProvider: () => {
                throw new Error('Discovery cannot acquire provider resources');
              },
              builtinAliases: [
                { alias: 'FILE', config: { baseProvider: 'unsupported' } },
                { alias: 'contributed', config: { baseProvider: 'data-only' } },
              ],
            },
          ],
        },
      },
    ]);
    expect(listProviderAliasNames([alias('file')], registry)).toStrictEqual([
      'file',
      'contributed',
    ]);
  });
});
