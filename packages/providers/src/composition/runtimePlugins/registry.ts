/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  ContributedAliasRegistration,
  LoadedRuntimePlugin,
  ProviderAliasFactory,
  ProviderContributionOrigin,
  ProviderContributionRegistry,
  RuntimeContributedAlias,
  RuntimeProviderContribution,
} from './types.js';
import { createBuiltinProviderContributions } from './builtinContributions.js';

interface RegisteredProvider {
  readonly contribution: RuntimeProviderContribution;
  readonly origin: ProviderContributionOrigin;
}

/**
 * Wraps the internal maps in the immutable public registry surface. The maps are
 * captured by closure and never exposed, so callers cannot mutate the registry.
 */
function freezeRegistry(
  providers: ReadonlyMap<string, RegisteredProvider>,
  orderedProviderIds: readonly string[],
  contributedAliases: readonly ContributedAliasRegistration[],
): ProviderContributionRegistry {
  return Object.freeze({
    getProviderFactory(providerId: string): ProviderAliasFactory | undefined {
      return providers.get(providerId.toLowerCase())?.contribution
        .createProvider;
    },
    getProviderOrigin(
      providerId: string,
    ): ProviderContributionOrigin | undefined {
      return providers.get(providerId.toLowerCase())?.origin;
    },
    listProviderIds(): readonly string[] {
      return Object.freeze([...orderedProviderIds]);
    },
    getContributedAliases(): readonly ContributedAliasRegistration[] {
      return Object.freeze([...contributedAliases]);
    },
  });
}

/**
 * Builds an immutable provider contribution registry containing exactly the built-in
 * provider contributions.
 */
export function createBuiltinProviderContributionRegistry(): ProviderContributionRegistry {
  return buildProviderContributionRegistry([]);
}

/**
 * Builds an immutable provider contribution registry from loaded runtime plugins.
 * Built-in contributions come first (in their declaration order), then plugin
 * contributions in plugin order (import order). Every collision class is rejected
 * with an error naming the colliding ids and the contributing plugins or specifiers.
 * Provider id lookups and collisions are case-insensitive, matching the existing
 * `entry.config.baseProvider.toLowerCase()` dispatch.
 */
export function buildProviderContributionRegistry(
  plugins: readonly LoadedRuntimePlugin[],
): ProviderContributionRegistry {
  const providers = new Map<string, RegisteredProvider>();
  const orderedProviderIds: string[] = [];

  for (const contribution of createBuiltinProviderContributions()) {
    const key = contribution.providerId.toLowerCase();
    if (providers.has(key)) {
      // The registry's contract is that a collision throws. Silently
      // overwriting would also desynchronise providers from
      // orderedProviderIds.
      throw new Error(
        `Duplicate built-in provider id '${contribution.providerId}'.`,
      );
    }
    providers.set(key, {
      contribution,
      origin: Object.freeze({ kind: 'builtin' }),
    });
    orderedProviderIds.push(contribution.providerId);
  }

  const pluginIdBySpecifier = new Map<string, string>();
  for (const plugin of plugins) {
    const existingSpecifier = pluginIdBySpecifier.get(plugin.manifest.id);
    if (existingSpecifier !== undefined) {
      throw new Error(
        `Duplicate runtime plugin id '${plugin.manifest.id}' is declared by both ` +
          `'${existingSpecifier}' and '${plugin.specifier}'.`,
      );
    }
    pluginIdBySpecifier.set(plugin.manifest.id, plugin.specifier);
  }

  for (const plugin of plugins) {
    for (const contribution of plugin.manifest.providers) {
      registerPluginContribution(
        providers,
        orderedProviderIds,
        contribution,
        plugin.manifest.id,
        plugin.specifier,
      );
    }
  }

  const contributedAliases = collectPluginAliases(plugins, providers);

  return freezeRegistry(providers, orderedProviderIds, contributedAliases);
}

function collectPluginAliases(
  plugins: readonly LoadedRuntimePlugin[],
  providers: ReadonlyMap<string, RegisteredProvider>,
): ContributedAliasRegistration[] {
  const contributedAliases: ContributedAliasRegistration[] = [];
  const aliasOwnerByLower = new Map<string, string>();
  for (const plugin of plugins) {
    for (const alias of contributedAliasesForPlugin(plugin)) {
      const aliasKey = alias.alias.toLowerCase();
      const owner = aliasOwnerByLower.get(aliasKey);
      if (owner !== undefined) {
        throw new Error(
          `Duplicate contributed alias '${alias.alias}' is contributed by both ` +
            `plugin '${owner}' and plugin '${plugin.manifest.id}'.`,
        );
      }
      if (providers.has(aliasKey)) {
        // ProviderManager keys providers by name, so an alias that shadows a
        // provider id would replace that provider outright.
        throw new Error(
          `Contributed alias '${alias.alias}' from plugin ` +
            `'${plugin.manifest.id}' collides with provider id ` +
            `'${alias.alias}'.`,
        );
      }
      aliasOwnerByLower.set(aliasKey, plugin.manifest.id);
      contributedAliases.push(
        Object.freeze({
          alias: alias.alias,
          config: alias.config,
          pluginId: plugin.manifest.id,
        }),
      );
    }
  }
  return contributedAliases;
}

function contributedAliasesForPlugin(
  plugin: LoadedRuntimePlugin,
): readonly RuntimeContributedAlias[] {
  return plugin.manifest.providers.flatMap(
    (contribution) => contribution.builtinAliases ?? [],
  );
}

function registerPluginContribution(
  providers: Map<string, RegisteredProvider>,
  orderedProviderIds: string[],
  contribution: RuntimeProviderContribution,
  pluginId: string,
  specifier: string,
): void {
  const key = contribution.providerId.toLowerCase();
  const existing = providers.get(key);
  if (existing === undefined) {
    providers.set(key, {
      contribution,
      origin: Object.freeze({
        kind: 'plugin' as const,
        pluginId,
        specifier,
      }),
    });
    orderedProviderIds.push(contribution.providerId);
    return;
  }
  if (existing.origin.kind === 'builtin') {
    throw new Error(
      `Contributed provider id '${contribution.providerId}' collides with the ` +
        `built-in provider '${existing.contribution.providerId}'.`,
    );
  }
  if (existing.origin.pluginId === pluginId) {
    throw new Error(
      `Duplicate provider id '${contribution.providerId}' within plugin '${pluginId}'.`,
    );
  }
  throw new Error(
    `Duplicate provider id '${contribution.providerId}' is contributed by both ` +
      `plugin '${existing.origin.pluginId}' and plugin '${pluginId}'.`,
  );
}
