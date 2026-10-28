/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { MCPServerConfig } from '../config/mcpServerConfig.js';
import type { McpAuthProvider } from './auth-provider.js';
import type { McpAuthFactoryContribution } from './mcp-auth-factory.js';
import { buildMcpAuthFactoryRegistry } from './mcp-auth-factory.js';

const FAKE_CLIENT_METADATA: OAuthClientMetadata = {
  client_name: 'test (fake)',
  redirect_uris: [],
  grant_types: [],
  response_types: [],
  token_endpoint_auth_method: 'none',
};

/** Minimal McpAuthProvider double; the seam only stores and calls factories. */
class FakeAuthProvider implements McpAuthProvider {
  readonly redirectUrl = '';
  readonly clientMetadata = FAKE_CLIENT_METADATA;
  constructor(readonly config?: MCPServerConfig) {}
  clientInformation() {
    return undefined;
  }
  saveClientInformation() {}
  async tokens() {
    return undefined;
  }
  saveTokens() {}
  redirectToAuthorization() {}
  saveCodeVerifier() {}
  codeVerifier() {
    return '';
  }
  async getRequestHeaders() {
    return { 'x-fake': 'header' };
  }
}

function contribution(
  authProviderType: string,
  provider?: FakeAuthProvider,
): McpAuthFactoryContribution {
  const instance = provider ?? new FakeAuthProvider();
  return {
    authProviderType,
    createAuthProvider: (config) => {
      (instance as { config?: MCPServerConfig }).config = config;
      return instance;
    },
  };
}

describe('buildMcpAuthFactoryRegistry', () => {
  it('resolves a contributed factory by authProviderType', () => {
    const factory = (config: MCPServerConfig): McpAuthProvider =>
      new FakeAuthProvider(config);
    const registry = buildMcpAuthFactoryRegistry([
      { authProviderType: 'custom_auth', createAuthProvider: factory },
    ]);

    expect(registry.getAuthProviderFactory('custom_auth')).toBe(factory);
  });

  it('resolves authProviderType case-insensitively', () => {
    const registry = buildMcpAuthFactoryRegistry([contribution('Custom_Auth')]);

    expect(registry.getAuthProviderFactory('CUSTOM_AUTH')).toBeTypeOf(
      'function',
    );
    expect(registry.getAuthProviderFactory('custom_auth')).toBeTypeOf(
      'function',
    );
  });

  it('returns undefined for an unknown authProviderType', () => {
    const registry = buildMcpAuthFactoryRegistry([contribution('known')]);

    expect(registry.getAuthProviderFactory('unknown')).toBeUndefined();
  });

  it('rejects a duplicate authProviderType, case-insensitively, naming the type', () => {
    expect(() =>
      buildMcpAuthFactoryRegistry([
        contribution('google_credentials'),
        contribution('GOOGLE_CREDENTIALS'),
      ]),
    ).toThrow(/google_credentials/i);
  });

  it('returns an immutable registry with a frozen type list', () => {
    const registry = buildMcpAuthFactoryRegistry([
      contribution('a'),
      contribution('b'),
    ]);

    expect(Object.isFrozen(registry)).toBe(true);
    const types = registry.listAuthProviderTypes();
    expect(Object.isFrozen(types)).toBe(true);
    expect(() => {
      (types as string[]).push('injected');
    }).toThrow(TypeError);
    expect(registry.listAuthProviderTypes()).toStrictEqual(['a', 'b']);
  });
});
