/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Interface for MCP OAuth tokens.
 */
export interface MCPOAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  scope?: string;
}

/**
 * Interface for stored MCP OAuth credentials.
 */
export interface MCPOAuthCredentials {
  serverName: string;
  token: MCPOAuthToken;
  clientId?: string;
  tokenUrl?: string;
  mcpServerUrl?: string;
  updatedAt: number;
}

/**
 * Abstract base class for MCP OAuth token storage.
 * This provides a provider-agnostic interface for storing and retrieving
 * MCP OAuth tokens that can be used across different AI providers.
 */
export abstract class BaseTokenStore {
  /**
   * Load all stored MCP OAuth tokens.
   *
   * @returns A map of server names to credentials
   */
  abstract loadTokens(): Promise<Map<string, MCPOAuthCredentials>>;

  /**
   * Save a token for a specific MCP server.
   *
   * @param serverName The name of the MCP server
   * @param token The OAuth token to save
   * @param clientId Optional client ID used for this token
   * @param tokenUrl Optional token URL used for this token
   * @param mcpServerUrl Optional MCP server URL
   */
  abstract saveToken(
    serverName: string,
    token: MCPOAuthToken,
    clientId?: string,
    tokenUrl?: string,
    mcpServerUrl?: string,
  ): Promise<void>;

  /**
   * Get a token for a specific MCP server.
   *
   * @param serverName The name of the MCP server
   * @returns The stored credentials or null if not found
   */
  abstract getToken(serverName: string): Promise<MCPOAuthCredentials | null>;

  /**
   * Remove a token for a specific MCP server.
   *
   * @param serverName The name of the MCP server
   */
  abstract removeToken(serverName: string): Promise<void>;

  /**
   * Clear all stored MCP OAuth tokens.
   */
  abstract clearAllTokens(): Promise<void>;

  /**
   * Check if a token is expired.
   * This is a utility method that can be used by implementations.
   *
   * @param token The token to check
   * @returns True if the token is expired
   */
  static isTokenExpired(token: MCPOAuthToken): boolean {
    if (!token.expiresAt) {
      return false; // No expiry, assume valid
    }

    // Add a 5-minute buffer to account for clock skew
    const bufferMs = 5 * 60 * 1000;
    return Date.now() + bufferMs >= token.expiresAt;
  }

  /**
   * Validate that a token has the required fields.
   *
   * @param token The token to validate
   * @throws Error if the token is invalid
   */
  protected validateToken(token: MCPOAuthToken): void {
    if (!token.accessToken || typeof token.accessToken !== 'string') {
      throw new Error('Token must have a valid accessToken');
    }
    if (!token.tokenType || typeof token.tokenType !== 'string') {
      throw new Error('Token must have a valid tokenType');
    }
  }

  /**
   * Validate that server name is valid.
   *
   * @param serverName The server name to validate
   * @throws Error if the server name is invalid
   */
  protected validateServerName(serverName: string): void {
    if (
      !serverName ||
      typeof serverName !== 'string' ||
      serverName.trim().length === 0
    ) {
      throw new Error('Server name must be a non-empty string');
    }
  }

  /**
   * Create a credentials object from the provided parameters.
   *
   * @param serverName The name of the MCP server
   * @param token The OAuth token
   * @param clientId Optional client ID
   * @param tokenUrl Optional token URL
   * @param mcpServerUrl Optional MCP server URL
   * @returns The credentials object
   */
  protected createCredentials(
    serverName: string,
    token: MCPOAuthToken,
    clientId?: string,
    tokenUrl?: string,
    mcpServerUrl?: string,
  ): MCPOAuthCredentials {
    this.validateServerName(serverName);
    this.validateToken(token);

    return {
      serverName,
      token,
      clientId,
      tokenUrl,
      mcpServerUrl,
      updatedAt: Date.now(),
    };
  }
}
