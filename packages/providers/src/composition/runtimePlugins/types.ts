/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core';
import type { OAuthManager } from '../../auth/index.js';
import type { IProvider } from '../../IProvider.js';
import type { IProviderConfig } from '../../types/IProviderConfig.js';
import type {
  ProviderAliasConfig,
  ProviderAliasEntry,
} from '../providerAliases.js';

/**
 * Inputs a provider alias factory receives when the CLI asks it to construct a
 * provider for a resolved alias entry. Carries exactly what the built-in alias
 * factories consume.
 */
export interface ProviderFactoryContext {
  readonly openaiApiKey: string | undefined;
  readonly openaiBaseUrl: string | undefined;
  readonly openaiProviderConfig: IProviderConfig;
  readonly oauthManager: OAuthManager;
  readonly config: Config | undefined;
  readonly authOnlyEnabled: boolean;
}

/**
 * A factory that constructs a provider for an alias whose base provider is either a
 * built-in id or a provider id contributed by a runtime plugin. It may return null
 * when no provider can be built (the single documented exception is the built-in
 * OpenAI-family factories returning null when no base URL is available).
 */
export type ProviderAliasFactory = (
  entry: ProviderAliasEntry,
  context: ProviderFactoryContext,
) => IProvider | null;

/**
 * An alias entry a plugin contributes for one of its own provider ids. The config is
 * a plugin-declared subset of the file-based {@link ProviderAliasConfig}.
 */
export interface RuntimeContributedAlias {
  readonly alias: string;
  readonly config: ProviderAliasConfig;
}

/**
 * A contributed alias as the registry reports it: the manifest-declared alias
 * plus the id of the plugin that contributed it. Alias construction needs the
 * owning plugin id so a plugin-sourced {@link ProviderAliasEntry} can record an
 * honest origin instead of a fabricated on-disk path.
 */
export interface ContributedAliasRegistration {
  readonly alias: string;
  readonly config: ProviderAliasConfig;
  readonly pluginId: string;
}

/**
 * A provider contribution declared by a runtime plugin manifest.
 */
export interface RuntimeProviderContribution {
  readonly providerId: string;
  readonly createProvider: ProviderAliasFactory;
  readonly builtinAliases?: readonly RuntimeContributedAlias[];
}

/**
 * A validated runtime plugin manifest (manifest v1).
 */
export interface RuntimePluginManifest {
  readonly apiVersion: 1;
  readonly id: string;
  readonly providers: readonly RuntimeProviderContribution[];
}

/**
 * Where a provider factory in the registry came from: a built-in contribution or a
 * loaded runtime plugin (with its plugin id and the specifier it was imported from).
 */
export type ProviderContributionOrigin =
  | { readonly kind: 'builtin' }
  | {
      readonly kind: 'plugin';
      readonly pluginId: string;
      readonly specifier: string;
    };

/**
 * A runtime plugin after a successful import and manifest validation.
 */
export interface LoadedRuntimePlugin {
  readonly specifier: string;
  readonly manifest: RuntimePluginManifest;
}

/**
 * The local, immutable provider contribution registry handed down the composition chain.
 * It carries built-in provider factories followed by plugin-contributed factories,
 * keyed case-insensitively by provider id, plus the ordered contributed aliases.
 */
export interface ProviderContributionRegistry {
  getProviderFactory(providerId: string): ProviderAliasFactory | undefined;
  getProviderOrigin(providerId: string): ProviderContributionOrigin | undefined;
  listProviderIds(): readonly string[];
  getContributedAliases(): readonly ContributedAliasRegistration[];
}
