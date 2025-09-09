/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileTokenStore } from './file-token-store.js';
import {
  BaseTokenStore,
  MCPOAuthToken,
  MCPOAuthCredentials,
} from './token-store.js';

// Re-export types for backward compatibility
export type { MCPOAuthToken, MCPOAuthCredentials };

/**
 * Class for managing MCP OAuth token storage and retrieval.
 * This class provides backward compatibility with the existing API while
 * delegating to the new BaseTokenStore architecture.
 */
export class MCPOAuthTokenStorage {
  private static tokenStore: BaseTokenStore = new FileTokenStore();

  /**
   * Set a custom token store implementation.
   * This allows for dependency injection and testing with mock implementations.
   *
   * @param store The token store to use
   */
  static setTokenStore(store: BaseTokenStore): void {
    this.tokenStore = store;
  }

  /**
   * Get the current token store implementation.
   *
   * @returns The current token store
   */
  static getTokenStore(): BaseTokenStore {
    return this.tokenStore;
  }

  /**
   * Load all stored MCP OAuth tokens.
   *
   * @returns A map of server names to credentials
   */
  static async loadTokens(): Promise<Map<string, MCPOAuthCredentials>> {
    return this.tokenStore.loadTokens();
  }

  /**
   * Save a token for a specific MCP server.
   *
   * @param serverName The name of the MCP server
   * @param token The OAuth token to save
   * @param clientId Optional client ID used for this token
   * @param tokenUrl Optional token URL used for this token
   * @param mcpServerUrl Optional MCP server URL
   */
  static async saveToken(
    serverName: string,
    token: MCPOAuthToken,
    clientId?: string,
    tokenUrl?: string,
    mcpServerUrl?: string,
  ): Promise<void> {
    return this.tokenStore.saveToken(
      serverName,
      token,
      clientId,
      tokenUrl,
      mcpServerUrl,
    );
  }

  /**
   * Get a token for a specific MCP server.
   *
   * @param serverName The name of the MCP server
   * @returns The stored credentials or null if not found
   */
  static async getToken(
    serverName: string,
  ): Promise<MCPOAuthCredentials | null> {
    return this.tokenStore.getToken(serverName);
  }

  /**
   * Remove a token for a specific MCP server.
   *
   * @param serverName The name of the MCP server
   */
  static async removeToken(serverName: string): Promise<void> {
    return this.tokenStore.removeToken(serverName);
  }

  /**
   * Check if a token is expired.
   *
   * @param token The token to check
   * @returns True if the token is expired
   */
  static isTokenExpired(token: MCPOAuthToken): boolean {
    return BaseTokenStore.isTokenExpired(token);
  }

  /**
   * Clear all stored MCP OAuth tokens.
   */
  static async clearAllTokens(): Promise<void> {
    return this.tokenStore.clearAllTokens();
  }
}
