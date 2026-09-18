/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Emit-only stand-in for the slice of the host runtime-plugin contract
 * (`@vybestack/llxprt-code-providers/composition.js`) that this package's
 * source compiles against.
 *
 * `bun run typecheck` does NOT use this file: it maps host specifiers to the
 * real host source via tsconfig paths, so any drift between the host
 * contract and this stand-in fails typecheck in CI. This file exists only so
 * `bun run build` can emit dist without host source inside the emit program;
 * host types still resolve through the built host (root node_modules links
 * into the packages' dist output), which is why CI and release build the
 * base first.
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

/** Mirrors providers/src/composition/providerAliases.ts (subset used here). */
export interface ProviderAliasConfig {
  name?: string;
  baseProvider: string;
  'base-url'?: string;
  defaultModel?: string;
  description?: string;
  apiKeyEnv?: string;
  modelsDevProviderId?: string | null;
}

/** Mirrors providers/src/composition/providerAliases.ts. */
export interface ProviderAliasEntry {
  alias: string;
  config: ProviderAliasConfig;
  filePath: string;
}

/** Mirrors providers/src/composition/runtimePlugins/types.ts. */
export interface ProviderFactoryContext {
  readonly openaiApiKey: string | undefined;
  readonly openaiBaseUrl: string | undefined;
  readonly oauthManager: unknown;
  readonly config: Config | undefined;
  readonly authOnlyEnabled: boolean;
}

/** Mirrors providers/src/composition/runtimePlugins/types.ts. */
export type ProviderAliasFactory = (
  entry: ProviderAliasEntry,
  context: ProviderFactoryContext,
) => unknown;

/** Mirrors providers/src/composition/runtimePlugins/types.ts. */
export interface RuntimeContributedAlias {
  readonly alias: string;
  readonly config: ProviderAliasConfig;
}

/** Mirrors providers/src/composition/runtimePlugins/types.ts. */
export interface RuntimePluginManifest {
  readonly apiVersion: 1;
  readonly id: string;
  readonly providers: readonly {
    readonly providerId: string;
    readonly createProvider: ProviderAliasFactory;
    readonly builtinAliases?: readonly RuntimeContributedAlias[];
  }[];
}

/**
 * Host alias-construction helpers (provider-agnostic) that the Gemini factory
 * consumes. Signatures mirror providers/src/composition/aliasProviderFactory.ts.
 */
export declare function resolveAliasEnvApiKey(
  entry: ProviderAliasEntry,
  authOnlyEnabled: boolean,
): string | undefined;
export declare function enforceAliasAuthOnly(
  provider: unknown,
  authOnlyEnabled: boolean,
): void;
export declare function overrideAliasDefaultModel(
  provider: unknown,
  entry: ProviderAliasEntry,
): void;
export declare function bindProviderAliasIdentity(
  provider: unknown,
  alias: string,
): void;
export declare function bindAliasMediaTransportCapabilities(
  provider: unknown,
  entry: ProviderAliasEntry,
): void;
