/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { buildMcpAuthFactoryRegistry } from '@vybestack/llxprt-code-mcp/auth/mcp-auth-factory.js';
import {
  buildProviderContributionRegistry,
  type ProviderContributionRegistry,
  type LoadedRuntimePlugin,
  type RuntimeMcpAuthFactoryContribution,
} from '@vybestack/llxprt-code-providers/composition.js';

function composeFactories(
  registry: ProviderContributionRegistry,
): ReturnType<typeof buildMcpAuthFactoryRegistry> {
  return buildMcpAuthFactoryRegistry(
    registry.getMcpAuthFactories().map((entry) => entry.contribution),
  );
}

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

describe('owner-local MCP auth factory composition', () => {
  it('threads plugin-contributed MCP auth factories into the registered registry', () => {
    const googleCredentials = contribution('google_credentials');
    const impersonation = contribution('service_account_impersonation');
    const registry = buildProviderContributionRegistry([
      pluginWithMcpAuthFactories(googleCredentials, impersonation),
    ]);

    const registered = composeFactories(registry);
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
    const registered = composeFactories(buildProviderContributionRegistry([]));
    expect(registered.listAuthProviderTypes()).toStrictEqual([]);
    expect(
      registered.getAuthProviderFactory('google_credentials'),
    ).toBeUndefined();
  });

  it('keeps earlier owners independent when a later plugin set is composed', () => {
    const alpha = contribution('alpha_auth');
    const first = composeFactories(
      buildProviderContributionRegistry([pluginWithMcpAuthFactories(alpha)]),
    );

    const beta = contribution('beta_auth');
    const registered = composeFactories(
      buildProviderContributionRegistry([pluginWithMcpAuthFactories(beta)]),
    );

    expect(registered.listAuthProviderTypes()).toStrictEqual(['beta_auth']);
    expect(registered.getAuthProviderFactory('beta_auth')).toBe(
      beta.createAuthProvider,
    );
    expect(registered.getAuthProviderFactory('alpha_auth')).toBeUndefined();
    expect(first.listAuthProviderTypes()).toStrictEqual(['alpha_auth']);
    expect(first.getAuthProviderFactory('beta_auth')).toBeUndefined();
    expect(first.getAuthProviderFactory('alpha_auth')).toBe(
      alpha.createAuthProvider,
    );
  });
});
