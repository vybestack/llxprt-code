/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import { AuthProviderType } from '@vybestack/llxprt-code-auth/mcp-auth-provider-type.js';
import type { MCPServerConfig } from '@vybestack/llxprt-code-mcp/config/mcpServerConfig.js';

// One shared mock assigned as an instance field keeps getClient prototype-like:
// every MockGoogleAuth instance resolves the same client object.
const mockGetClient = vi.fn<() => Promise<unknown>>();
const { MockGoogleAuth } = (() => {
  class MockGoogleAuth {
    getClient = mockGetClient;
    constructor(..._args: unknown[]) {
      // Construction args are covered by the provider tests.
    }
  }
  return { MockGoogleAuth };
})();

void vi.mock('google-auth-library', () => ({
  GoogleAuth: MockGoogleAuth,
}));

import {
  buildMcpAuthFactoryRegistry,
  createTransport,
} from '@vybestack/llxprt-code-mcp';
import { createTestOAuthBinding } from '@vybestack/llxprt-code-mcp/test-support/oauth.js';
import {
  buildProviderContributionRegistry,
  parseRuntimePluginManifest,
} from '@vybestack/llxprt-code-providers/composition.js';
import { GoogleCredentialProvider } from './google-auth-provider.js';
import { llxprtRuntimePlugin } from './index.js';

// The transport stores these under private fields; reading them the same way
// the host test helpers do keeps the e2e assertions behavioral (what the
// transport would send) without exporting test-only surface.
function transportAuthProvider(transport: unknown): unknown {
  return (transport as { _authProvider?: unknown })._authProvider;
}

function transportHeaders(transport: unknown): Record<string, string> {
  return (
    (transport as { _requestInit?: { headers?: Record<string, string> } })
      ._requestInit?.headers ?? {}
  );
}

describe('google-mcp-auth host composition', () => {
  it('threads the plugin manifest into the MCP factory registry used by createTransport', async () => {
    const manifest = parseRuntimePluginManifest(
      llxprtRuntimePlugin.id,
      llxprtRuntimePlugin,
    );
    const registry = buildProviderContributionRegistry([
      { specifier: llxprtRuntimePlugin.id, manifest },
    ]);

    expect(registry.getProviderFactory('google-mcp-auth')).toBeUndefined();
    const contributions = registry
      .getMcpAuthFactories()
      .map((factory) => factory.contribution);
    expect(contributions.map((c) => c.authProviderType)).toStrictEqual([
      AuthProviderType.GOOGLE_CREDENTIALS,
      AuthProviderType.SERVICE_ACCOUNT_IMPERSONATION,
    ]);

    const authFactories = buildMcpAuthFactoryRegistry(contributions);
    expect(authFactories.listAuthProviderTypes()).toStrictEqual([
      AuthProviderType.GOOGLE_CREDENTIALS,
      AuthProviderType.SERVICE_ACCOUNT_IMPERSONATION,
    ]);

    const mockClient = {
      getAccessToken: vi
        .fn<() => Promise<{ token: string }>>()
        .mockResolvedValue({ token: 'adc-token' }),
      credentials: {},
      quotaProjectId: 'quota-project-id',
    };
    mockGetClient.mockResolvedValue(mockClient);

    const config: MCPServerConfig = {
      url: 'https://example.com/mcp',
      authProviderType: AuthProviderType.GOOGLE_CREDENTIALS,
      oauth: { scopes: ['scope1'] },
    };

    const binding = createTestOAuthBinding();
    const transport = await createTransport(
      binding.tokenStorage,
      'google-server',
      config,
      false,
      undefined,
      (type) => authFactories.getAuthProviderFactory(type),
    );
    expect(transportAuthProvider(transport)).toBeInstanceOf(
      GoogleCredentialProvider,
    );
    expect(transportHeaders(transport)).toMatchObject({
      'X-Goog-User-Project': 'quota-project-id',
    });
  });
});
