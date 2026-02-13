/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { KeychainTokenStorage } from './token-storage/keychain-token-storage.js';
import type {
  OAuthCredentials,
  OAuthToken,
  TokenStorage,
} from './token-storage/types.js';
import type { MCPOAuthToken, MCPOAuthCredentials } from './token-store.js';

export type { MCPOAuthToken, MCPOAuthCredentials } from './token-store.js';

const DEFAULT_SERVICE_NAME = 'llxprt-cli-mcp-oauth';
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Token storage wrapper that bridges the legacy static API with the new
 * shared TokenStorage interface used across the MCP stack. By default it
 * delegates to a KeychainTokenStorage that uses SecureStore internally
 * for keychain + encrypted-file fallback.
 *
 * @plan PLAN-20260211-SECURESTORE.P09
 */
export class MCPOAuthTokenStorage implements TokenStorage {
  private static tokenStore: TokenStorage = new KeychainTokenStorage(
    DEFAULT_SERVICE_NAME,
  );

  constructor(
    private readonly storage: TokenStorage = MCPOAuthTokenStorage.tokenStore,
  ) {}

  /**
   * Swap out the underlying token store implementation. Useful for testing or
   * for embedding environments that need a custom persistence layer.
   */
  static setTokenStore(store: TokenStorage): void {
    this.tokenStore = store;
  }

  static getTokenStore(): TokenStorage {
    return this.tokenStore;
  }

  /**
   * Legacy helper that loads all stored credentials.
   */
  static async loadTokens(): Promise<Map<string, MCPOAuthCredentials>> {
    return (await this.tokenStore.getAllCredentials()) as Map<
      string,
      MCPOAuthCredentials
    >;
  }

  /**
   * Legacy helper that persists credentials for a server.
   */
  static async saveToken(
    serverName: string,
    token: MCPOAuthToken,
    clientId?: string,
    tokenUrl?: string,
    mcpServerUrl?: string,
  ): Promise<void> {
    const credentials = this.createCredentials(
      serverName,
      token,
      clientId,
      tokenUrl,
      mcpServerUrl,
    );
    await this.tokenStore.setCredentials(credentials);
  }

  /**
   * Legacy helper that retrieves credentials for a server.
   */
  static async getToken(
    serverName: string,
  ): Promise<MCPOAuthCredentials | null> {
    this.validateServerName(serverName);
    const credentials = await this.tokenStore.getCredentials(serverName);
    return credentials as MCPOAuthCredentials | null;
  }

  /**
   * Legacy helper that removes credentials for a server.
   */
  static async removeToken(serverName: string): Promise<void> {
    this.validateServerName(serverName);
    await this.tokenStore.deleteCredentials(serverName);
  }

  /**
   * Legacy helper that clears all persisted credentials.
   */
  static async clearAllTokens(): Promise<void> {
    await this.tokenStore.clearAll();
  }

  /**
   * Determine whether a token is expired (with a buffer to avoid clock skew).
   */
  static isTokenExpired(token: MCPOAuthToken): boolean {
    if (!token.expiresAt) {
      return false;
    }
    return Date.now() + EXPIRY_BUFFER_MS >= token.expiresAt;
  }

  /**
   * TokenStorage implementation - delegate all operations to the injected store.
   */
  async getCredentials(serverName: string): Promise<OAuthCredentials | null> {
    MCPOAuthTokenStorage.validateServerName(serverName);
    return this.storage.getCredentials(serverName);
  }

  async setCredentials(credentials: OAuthCredentials): Promise<void> {
    MCPOAuthTokenStorage.validateServerName(credentials.serverName);
    MCPOAuthTokenStorage.validateToken(credentials.token);
    await this.storage.setCredentials({
      ...credentials,
      updatedAt: credentials.updatedAt ?? Date.now(),
    });
  }

  async deleteCredentials(serverName: string): Promise<void> {
    MCPOAuthTokenStorage.validateServerName(serverName);
    await this.storage.deleteCredentials(serverName);
  }

  async listServers(): Promise<string[]> {
    return this.storage.listServers();
  }

  async getAllCredentials(): Promise<Map<string, OAuthCredentials>> {
    return this.storage.getAllCredentials();
  }

  async clearAll(): Promise<void> {
    await this.storage.clearAll();
  }

  /**
   * Convenience instance wrapper for legacy saveToken signature.
   */
  async saveToken(
    serverName: string,
    token: MCPOAuthToken,
    clientId?: string,
    tokenUrl?: string,
    mcpServerUrl?: string,
  ): Promise<void> {
    const credentials = MCPOAuthTokenStorage.createCredentials(
      serverName,
      token,
      clientId,
      tokenUrl,
      mcpServerUrl,
    );
    await this.storage.setCredentials(credentials);
  }

  /**
   * Convenience instance wrapper for legacy getToken signature.
   */
  async getToken(serverName: string): Promise<MCPOAuthCredentials | null> {
    const credentials = await this.getCredentials(serverName);
    return credentials as MCPOAuthCredentials | null;
  }

  async removeToken(serverName: string): Promise<void> {
    await this.deleteCredentials(serverName);
  }

  async loadTokens(): Promise<Map<string, MCPOAuthCredentials>> {
    const tokens = await this.getAllCredentials();
    return tokens as Map<string, MCPOAuthCredentials>;
  }

  private static validateServerName(serverName: string): void {
    if (!serverName || typeof serverName !== 'string') {
      throw new Error('Server name must be a non-empty string');
    }
    if (serverName.trim().length === 0) {
      throw new Error('Server name must be a non-empty string');
    }
  }

  private static validateToken(token: OAuthToken): void {
    if (!token || typeof token !== 'object') {
      throw new Error('Token must be a valid object');
    }
    if (!token.accessToken || typeof token.accessToken !== 'string') {
      throw new Error('Token must have a valid access token');
    }
    if (!token.tokenType || typeof token.tokenType !== 'string') {
      throw new Error('Token must have a valid token type');
    }
  }

  private static createCredentials(
    serverName: string,
    token: OAuthToken,
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
