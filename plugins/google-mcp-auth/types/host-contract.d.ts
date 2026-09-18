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

/** Mirrors providers/src/composition/runtimePlugins/types.ts. */
export type ProviderAliasFactory = (entry: never, context: never) => never;

/** Mirrors providers/src/composition/runtimePlugins/types.ts. */
export interface RuntimePluginManifest {
  readonly apiVersion: 1;
  readonly id: string;
  readonly providers: readonly {
    readonly providerId: string;
    readonly createProvider: ProviderAliasFactory;
  }[];
}
