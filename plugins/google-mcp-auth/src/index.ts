/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Google MCP auth runtime plugin (#2764).
 *
 * Hosts the Google ADC (`google_credentials`) and service-account
 * impersonation (`service_account_impersonation`) MCP auth providers that
 * used to live in `packages/mcp`. Base installs no longer carry
 * `google-auth-library`: a server selecting one of these authProviderType
 * values requires this plugin, and selecting them without it fails with an
 * actionable install hint rather than falling back to standard OAuth.
 */
import { AuthProviderType } from '@vybestack/llxprt-code-auth/mcp-auth-provider-type.js';
import type { RuntimePluginManifest } from '@vybestack/llxprt-code-providers/composition.js';
import { GoogleCredentialProvider } from './google-auth-provider.js';
import { ServiceAccountImpersonationProvider } from './sa-impersonation-provider.js';

export const llxprtRuntimePlugin = {
  apiVersion: 1,
  id: '@vybestack/llxprt-plugin-google-mcp-auth',
  providers: [],
  mcpAuthFactories: [
    {
      authProviderType: AuthProviderType.GOOGLE_CREDENTIALS,
      createAuthProvider: (config) => new GoogleCredentialProvider(config),
    },
    {
      authProviderType: AuthProviderType.SERVICE_ACCOUNT_IMPERSONATION,
      createAuthProvider: (config) =>
        new ServiceAccountImpersonationProvider(config),
    },
  ],
} satisfies RuntimePluginManifest;
