/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Immutable custom-auth contributions are built and injected by each host owner. */

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
