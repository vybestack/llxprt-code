/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  OAuthCredentials,
  OAuthToken,
  TokenStorage,
} from './token-storage/index.js';
import type { MCPOAuthToken, MCPOAuthCredentials } from './token-store.js';

export type { MCPOAuthToken, MCPOAuthCredentials } from './token-store.js';

const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

function isInvalidExpiry(expiresAt: unknown): boolean {
  if (expiresAt === undefined) {
    return true;
  }
  if (expiresAt === null) {
    return true;
  }
  if (expiresAt === false) {
    return true;
  }
  if (expiresAt === '') {
    return true;
  }
  if (expiresAt === 0) {
    return true;
  }
  if (typeof expiresAt === 'number' && Number.isNaN(expiresAt)) {
    return true;
  }
  return false;
}

export class MCPOAuthTokenStorage implements TokenStorage {
  constructor(private readonly storage: TokenStorage) {}

  /**
   * Determine whether a token is expired (with a buffer to avoid clock skew).
   */
  static isTokenExpired(token: MCPOAuthToken): boolean {
    const expiresAt = token.expiresAt as unknown;
    if (isInvalidExpiry(expiresAt)) {
      return false;
    }
    return Date.now() + EXPIRY_BUFFER_MS >= (expiresAt as number);
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
      updatedAt: (credentials.updatedAt as number | undefined) ?? Date.now(),
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
    if (typeof token !== 'object') {
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
