/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  MCPOAuthTokenStorage,
  type McpOAuthBinding,
  type OAuthCredentials,
} from '@vybestack/llxprt-code-mcp';

export function createTestOAuthBinding(): McpOAuthBinding {
  let credentials = new Map<string, OAuthCredentials>();
  return {
    openBrowser: async () => {
      throw new Error('Browser was not configured for this test');
    },
    tokenStorage: new MCPOAuthTokenStorage({
      getCredentials: async (name) => credentials.get(name) ?? null,
      setCredentials: async (value) => {
        credentials = new Map(credentials).set(value.serverName, value);
      },
      deleteCredentials: async (name) => {
        credentials = new Map(
          [...credentials].filter(([serverName]) => serverName !== name),
        );
      },
      listServers: async () => [...credentials.keys()],
      getAllCredentials: async () => new Map(credentials),
      clearAll: async () => {
        credentials = new Map();
      },
    }),
  };
}
