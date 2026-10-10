/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { MCPOAuthTokenStorage } from '../../auth/index.js';
import type { OAuthCredentials } from '../../auth/token-storage/index.js';
import type { McpOAuthBinding } from '../../auth/index.js';
import {
  bindMcpOAuthCapabilities,
  type McpOAuthCapabilities,
} from '../mcp-oauth-helpers.js';

export function createTestOAuthBinding(): McpOAuthBinding {
  const credentials = new Map<string, OAuthCredentials>();
  return {
    openBrowser: async () => {
      throw new Error('Browser was not configured for this test');
    },
    tokenStorage: new MCPOAuthTokenStorage({
      getCredentials: async (name) => credentials.get(name) ?? null,
      setCredentials: async (value) => {
        credentials.set(value.serverName, value);
      },
      deleteCredentials: async (name) => {
        credentials.delete(name);
      },
      listServers: async () => [...credentials.keys()],
      getAllCredentials: async () => new Map(credentials),
      clearAll: async () => {
        credentials.clear();
      },
    }),
  };
}

export function createTestOAuthCapabilities(): McpOAuthCapabilities {
  return bindMcpOAuthCapabilities(createTestOAuthBinding());
}
