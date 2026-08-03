/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BunTestWorkspaceEntry } from './bun-test-manifest.ts';

export const MCP_MANIFEST_ENTRY: BunTestWorkspaceEntry = {
  workspace: 'mcp',
  preload: 'test-setup-storage-isolation.ts',
  files: [
    'src/auth/file-token-store.test.ts',
    'src/auth/oauth-provider.authenticate.test.ts',
    'src/auth/oauth-provider.token.test.ts',
    'src/auth/oauth-status.behavior.test.ts',
    'src/auth/oauth-utils.test.ts',
    'src/auth/oauth-provider-utils.test.ts',
    'src/auth/sa-impersonation-provider.test.ts',
    'src/auth/google-auth-provider.test.ts',
    'src/auth/oauth-token-storage.test.ts',
    'src/auth/token-storage/file-token-storage.test.ts',
    'src/auth/token-storage/keychain-token-storage.test.ts',
    'src/auth/token-storage/file-token-storage.behavior.test.ts',
    'src/auth/token-storage/keychain-token-storage.missing-keytar.test.ts',
    'src/auth/token-storage/base-token-storage.test.ts',
    'src/auth/token-storage/hybrid-token-storage.test.ts',
    'src/auth/token-store.test.ts',
    'src/__tests__/no-eslint-directives.test.ts',
    'src/fake/fakeMcpDiscovery.authorization.test.ts',
    'src/client/mcp-client-manager.fake-discovery.test.ts',
    'src/client/mcp-client.lifecycle.test.ts',
    'src/client/retryable-client-disconnections.test.ts',
    'src/client/mcp-client.discover-rollback.test.ts',
    'src/client/mcp-client.transport.test.ts',
    'src/client/mcp-public-api.test.ts',
    'src/client/trust-revocation-errors.test.ts',
    'src/client/mcp-tool.confirm.test.ts',
    'src/client/mcp-client.disconnect-cleanup.test.ts',
    'src/client/mcp-client.oauth.test.ts',
    'src/client/mcp-client.stale-error.test.ts',
    'src/client/mcp-client-manager.status-failure.test.ts',
    'src/client/mcp-client.discovery.test.ts',
    'src/client/mcp-client.publication-authorization.test.ts',
    'src/client/mcp-client.tools.test.ts',
    'src/client/mcp-oauth-helpers.test.ts',
    'src/client/mcp-tool.execute.test.ts',
    'src/client/mcp-client-manager-helpers.test.ts',
    'src/client/mcp-client-manager.test.ts',
    'src/client/mcp-client.resource-refresh.test.ts',
    'src/client/mcp-discovery.authorization.test.ts',
    'src/client/neutral-types.test.ts',
    'src/client/mcp-client-manager.trust.test.ts',
    'src/client/mcp-client-manager.partial-failure.test.ts',
    'src/client/mcp-client-manager.restart.test.ts',
  ],
};
