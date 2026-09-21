/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AuthProviderType } from '@vybestack/llxprt-code-auth/mcp-auth-provider-type.js';
import type { MCPServerConfig } from '@vybestack/llxprt-code-mcp/config/mcpServerConfig.js';

// google-auth-library is the one external dependency of the moved providers;
// mocking it at the module boundary keeps construction assertions hermetic.
const { MockGoogleAuth } = (() => {
  class MockGoogleAuth {
    getClient = vi.fn<() => Promise<unknown>>();
    constructor(..._args: unknown[]) {
      // Intentionally empty: construction behavior is asserted via
      // MockGoogleAuth.mockConstructor in the provider tests.
    }
  }
  return { MockGoogleAuth };
})();

void vi.mock('google-auth-library', () => ({
  GoogleAuth: MockGoogleAuth,
}));

import { parseRuntimePluginManifest } from '@vybestack/llxprt-code-providers/composition.js';
import { GoogleCredentialProvider } from './google-auth-provider.js';
import { ServiceAccountImpersonationProvider } from './sa-impersonation-provider.js';
import { llxprtRuntimePlugin } from './index.js';

interface PluginManifest {
  name?: string;
  version?: string;
  llxprt?: { runtimePlugin?: boolean };
}

const packageJson = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../package.json', import.meta.url)),
    'utf8',
  ),
) as PluginManifest;

const ADC_CONFIG = {
  url: 'https://example.com/mcp',
  oauth: { scopes: ['scope1'] },
} as MCPServerConfig;

const IMPERSONATION_CONFIG = {
  url: 'https://example.com/mcp',
  targetAudience: 'my-audience',
  targetServiceAccount: 'my-sa',
} as MCPServerConfig;

describe('@vybestack/llxprt-plugin-google-mcp-auth manifest', () => {
  it('declares the runtime plugin marker the host discovery scans for', () => {
    expect(packageJson.llxprt).toStrictEqual({ runtimePlugin: true });
  });

  it('exports a manifest v1 whose id is the package name', () => {
    expect(llxprtRuntimePlugin.apiVersion).toBe(1);
    expect(packageJson.name).toBe(llxprtRuntimePlugin.id);
  });

  it('passes host manifest validation', () => {
    const manifest = parseRuntimePluginManifest(
      llxprtRuntimePlugin.id,
      llxprtRuntimePlugin,
    );
    expect(manifest.id).toBe(llxprtRuntimePlugin.id);
    expect(Object.isFrozen(manifest)).toBe(true);
  });

  it('contributes no providers, only the two MCP auth factories', () => {
    expect(llxprtRuntimePlugin.providers).toStrictEqual([]);
    expect(
      llxprtRuntimePlugin.mcpAuthFactories?.map(
        (factory) => factory.authProviderType,
      ),
    ).toStrictEqual([
      AuthProviderType.GOOGLE_CREDENTIALS,
      AuthProviderType.SERVICE_ACCOUNT_IMPERSONATION,
    ]);
  });

  it('constructs a GoogleCredentialProvider for google_credentials', () => {
    const factory = llxprtRuntimePlugin.mcpAuthFactories?.find(
      (candidate) =>
        candidate.authProviderType === AuthProviderType.GOOGLE_CREDENTIALS,
    );
    expect(factory).toBeDefined();
    expect(factory?.createAuthProvider(ADC_CONFIG)).toBeInstanceOf(
      GoogleCredentialProvider,
    );
  });

  it('constructs a ServiceAccountImpersonationProvider for service_account_impersonation', () => {
    const factory = llxprtRuntimePlugin.mcpAuthFactories?.find(
      (candidate) =>
        candidate.authProviderType ===
        AuthProviderType.SERVICE_ACCOUNT_IMPERSONATION,
    );
    expect(factory).toBeDefined();
    expect(factory?.createAuthProvider(IMPERSONATION_CONFIG)).toBeInstanceOf(
      ServiceAccountImpersonationProvider,
    );
  });
});
