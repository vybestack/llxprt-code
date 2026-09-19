/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Factory contributions for custom `authProviderType` auth providers (#2764).
 *
 * `mcp` sits below `providers` in the dependency graph and cannot reach the
 * runtime-plugin composition registry. Following the `registerMcpHostServices`
 * precedent (#3305), this module inverts the dependency: the transport looks
 * up factories in a registry the host populates once during startup from the
 * loaded runtime plugins. Built-in auth (standard OAuth, static headers) never
 * consults this registry; only a server that selects a custom
 * `authProviderType` does.
 */

import type { MCPServerConfig } from '../config/mcpServerConfig.js';
import type { McpAuthProvider } from './auth-provider.js';

/**
 * Constructs the auth provider for one `authProviderType`.
 *
 * A factory that cannot build a provider MUST throw with an actionable
 * message; the transport turns that failure into a terminal error.
 */
export type McpAuthProviderFactory = (
  config: MCPServerConfig,
) => McpAuthProvider;

/** A factory contribution keyed by the config's `authProviderType` string. */
export interface McpAuthFactoryContribution {
  readonly authProviderType: string;
  readonly createAuthProvider: McpAuthProviderFactory;
}

/** Immutable, case-insensitive lookup of factories by `authProviderType`. */
export interface McpAuthFactoryRegistry {
  getAuthProviderFactory(
    authProviderType: string,
  ): McpAuthProviderFactory | undefined;
  listAuthProviderTypes(): readonly string[];
}

const EMPTY_REGISTRY: McpAuthFactoryRegistry = Object.freeze({
  getAuthProviderFactory: (_authProviderType: string) => undefined,
  listAuthProviderTypes: () => Object.freeze([]),
});

/**
 * Builds an immutable registry from factory contributions. Keys are the
 * lowercased `authProviderType` strings, matching the provider registry's
 * case-insensitive convention. A duplicate type is rejected at build time
 * naming the type rather than silently overwriting an earlier factory.
 */
export function buildMcpAuthFactoryRegistry(
  contributions: readonly McpAuthFactoryContribution[],
): McpAuthFactoryRegistry {
  const factories = new Map<string, McpAuthProviderFactory>();
  const orderedTypes: string[] = [];
  for (const contribution of contributions) {
    const key = contribution.authProviderType.toLowerCase();
    if (factories.has(key)) {
      throw new Error(
        `Duplicate McpAuthProvider factory for authProviderType '${contribution.authProviderType}'.`,
      );
    }
    factories.set(key, contribution.createAuthProvider);
    orderedTypes.push(contribution.authProviderType);
  }
  return Object.freeze({
    getAuthProviderFactory: (authProviderType: string) =>
      factories.get(authProviderType.toLowerCase()),
    listAuthProviderTypes: () => Object.freeze([...orderedTypes]),
  });
}

let registered: McpAuthFactoryRegistry | undefined;

/**
 * Registers the process-wide factory set, replacing any previously
 * registered one.
 *
 * Replacement rather than merge mirrors the `registerMcpHostServices` seam:
 * startup can run repeatedly in one process (the CLI test suites invoke
 * `main()` many times), and each run re-wires the factories from the
 * currently loaded plugins.
 */
export function registerMcpAuthFactories(
  contributions: readonly McpAuthFactoryContribution[],
): void {
  registered = buildMcpAuthFactoryRegistry(contributions);
}

/**
 * The registered factory registry. Empty until the host registers factories,
 * so an unregistered process keeps exactly the built-in auth behavior.
 */
export function getRegisteredMcpAuthFactoryRegistry(): McpAuthFactoryRegistry {
  return registered ?? EMPTY_REGISTRY;
}

/** Restores the unregistered state. Intended for test isolation. */
export function resetRegisteredMcpAuthFactories(): void {
  registered = undefined;
}
