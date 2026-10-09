/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral coverage for issue #2764 Phase 4: the CLI composition wires
 * plugin-contributed MCP auth factories into the transport's startup
 * registry, replacing any previously wired set on every wiring run, so
 * servers selecting a custom `authProviderType` resolve without
 * core-package changes. Everything below the wiring helper (registry build,
 * registration, lookup) is real — no mocks.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import {
  getRegisteredMcpAuthFactoryRegistry,
  resetRegisteredMcpAuthFactories,
} from '@vybestack/llxprt-code-mcp/auth/mcp-auth-factory.js';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition.js';
import type {
  LoadedRuntimePlugin,
  RuntimeMcpAuthFactoryContribution,
} from '@vybestack/llxprt-code-providers/composition.js';
import { wireMcpAuthFactories } from './mcpHostWiring.js';

/** A contributed factory whose provider construction is never exercised. */
function contribution(type: string): RuntimeMcpAuthFactoryContribution {
  return {
    authProviderType: type,
    createAuthProvider: () => {
      throw new Error(`provider construction not exercised: ${type}`);
    },
  };
}

function pluginWithMcpAuthFactories(
  ...mcpAuthFactories: RuntimeMcpAuthFactoryContribution[]
): LoadedRuntimePlugin {
  return {
    specifier: 'llxprt-wiring-auth-plugin',
    manifest: {
      apiVersion: 1,
      id: 'wiring-auth-plugin',
      providers: [],
      mcpAuthFactories,
    },
  };
}

describe('wireMcpAuthFactories', () => {
  afterEach(() => {
    resetRegisteredMcpAuthFactories();
  });

  it('threads plugin-contributed MCP auth factories into the registered registry', () => {
    const googleCredentials = contribution('google_credentials');
    const impersonation = contribution('service_account_impersonation');
    const registry = buildProviderContributionRegistry([
      pluginWithMcpAuthFactories(googleCredentials, impersonation),
    ]);

    wireMcpAuthFactories(registry);

    const registered = getRegisteredMcpAuthFactoryRegistry();
    expect(registered.listAuthProviderTypes()).toStrictEqual([
      'google_credentials',
      'service_account_impersonation',
    ]);
    expect(registered.getAuthProviderFactory('google_credentials')).toBe(
      googleCredentials.createAuthProvider,
    );
    expect(
      registered.getAuthProviderFactory('SERVICE_ACCOUNT_IMPERSONATION'),
    ).toBe(impersonation.createAuthProvider);
  });

  it('registers an empty factory set when no plugin contributes factories', () => {
    wireMcpAuthFactories(buildProviderContributionRegistry([]));

    const registered = getRegisteredMcpAuthFactoryRegistry();
    expect(registered.listAuthProviderTypes()).toStrictEqual([]);
    expect(
      registered.getAuthProviderFactory('google_credentials'),
    ).toBeUndefined();
  });

  it('replaces a previously wired factory set on a later wiring run', () => {
    const alpha = contribution('alpha_auth');
    wireMcpAuthFactories(
      buildProviderContributionRegistry([pluginWithMcpAuthFactories(alpha)]),
    );

    const beta = contribution('beta_auth');
    wireMcpAuthFactories(
      buildProviderContributionRegistry([pluginWithMcpAuthFactories(beta)]),
    );

    const registered = getRegisteredMcpAuthFactoryRegistry();
    expect(registered.listAuthProviderTypes()).toStrictEqual(['beta_auth']);
    expect(registered.getAuthProviderFactory('beta_auth')).toBe(
      beta.createAuthProvider,
    );
    expect(registered.getAuthProviderFactory('alpha_auth')).toBeUndefined();
  });
});
