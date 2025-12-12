/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { Storage } from '../config/storage.js';
import { getErrorMessage } from '../utils/errors.js';
import {
  BaseTokenStore,
  type MCPOAuthToken,
  type MCPOAuthCredentials,
} from './token-store.js';

const safeOsHostname = (): string => {
  try {
    return os.hostname();
  } catch (error) {
    console.warn('Failed to resolve hostname, falling back to default', error);
    return 'unknown-host';
  }
};

const safeOsUsername = (): string => {
  try {
    return os.userInfo().username;
  } catch (error) {
    const fallback = process.env.USER || process.env.USERNAME || 'unknown-user';
    console.warn('Failed to resolve username, using fallback value', error);
    return fallback;
  }
};

/**
 * File-based implementation of the BaseTokenStore.
 * Stores MCP OAuth tokens in a JSON file in the user's configuration directory.
 */
export class FileTokenStore extends BaseTokenStore {
  private readonly tokenFilePath: string;
  private readonly encryptionKey: Buffer;
  private readonly serviceName: string;

  constructor(
    tokenFilePath?: string,
    options: {
      serviceName?: string;
      encryptionKey?: Buffer;
    } = {},
  ) {
    super();
    this.tokenFilePath = tokenFilePath || Storage.getMcpOAuthTokensPath();
    this.serviceName = options.serviceName ?? 'llxprt-cli-mcp-oauth';
    this.encryptionKey =
      options.encryptionKey ?? this.deriveEncryptionKey(this.serviceName);
  }

  /**
   * Ensure the config directory exists.
   */
  private async ensureConfigDir(): Promise<void> {
    const configDir = path.dirname(this.tokenFilePath);
    try {
      await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
    } catch (error) {
      console.error(
        `Failed to create config directory ${configDir}: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * Derive an encryption key for securing stored tokens.
   */
  private deriveEncryptionKey(serviceName: string): Buffer {
    const hostname = safeOsHostname();
    const username = safeOsUsername();
    const salt = `${hostname}:${username}:${serviceName}`;
    return crypto.scryptSync('llxprt-cli-oauth', salt, 32);
  }

  /**
   * Encrypt token payload with AES-256-GCM.
   */
  private encrypt(payload: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);

    let encrypted = cipher.update(payload, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return [iv.toString('hex'), authTag.toString('hex'), encrypted].join(':');
  }

  /**
   * Decrypt stored payload. Falls back to plaintext for backward compatibility.
   */
  private decrypt(payload: string): string {
    const trimmed = payload.trim();
    const encryptedPattern = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

    if (!encryptedPattern.test(trimmed)) {
      return payload;
    }

    const [ivHex, authTagHex, encryptedHex] = trimmed.split(':');

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      iv,
    );

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  private async readTokenPayload(): Promise<string | null> {
    try {
      return await fs.readFile(this.tokenFilePath, 'utf-8');
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return null;
      }

      console.error(
        `Failed to read MCP OAuth tokens from ${this.tokenFilePath}: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  private async writeTokenPayload(
    tokens: MCPOAuthCredentials[],
  ): Promise<void> {
    await this.ensureConfigDir();

    const payload = JSON.stringify(tokens, null, 2);
    const encrypted = this.encrypt(payload);

    await fs.writeFile(this.tokenFilePath, encrypted, { mode: 0o600 });
  }

  /**
   * Load all stored MCP OAuth tokens.
   *
   * @returns A map of server names to credentials
   */
  async loadTokens(): Promise<Map<string, MCPOAuthCredentials>> {
    const tokenMap = new Map<string, MCPOAuthCredentials>();

    try {
      const payload = await this.readTokenPayload();
      if (!payload) {
        return tokenMap;
      }

      const decrypted = this.decrypt(payload);
      const tokens = JSON.parse(decrypted) as MCPOAuthCredentials[];

      // Validate the loaded data structure
      if (!Array.isArray(tokens)) {
        console.warn('Token file contains invalid data structure, ignoring');
        return tokenMap;
      }

      for (const credential of tokens) {
        if (this.isValidCredentials(credential)) {
          tokenMap.set(credential.serverName, credential);
        } else {
          console.warn(
            `Skipping invalid credential entry for server: ${(credential as { serverName?: string })?.serverName || 'unknown'}`,
          );
        }
      }
    } catch (error) {
      console.error(
        `Failed to load MCP OAuth tokens from ${this.tokenFilePath}: ${getErrorMessage(error)}`,
      );
    }

    return tokenMap;
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
  async saveToken(
    serverName: string,
    token: MCPOAuthToken,
    clientId?: string,
    tokenUrl?: string,
    mcpServerUrl?: string,
  ): Promise<void> {
    const tokens = await this.loadTokens();
    const credential = this.createCredentials(
      serverName,
      token,
      clientId,
      tokenUrl,
      mcpServerUrl,
    );

    tokens.set(serverName, credential);

    try {
      await this.writeTokenPayload(Array.from(tokens.values()));

      // Token saved successfully
    } catch (error) {
      console.error(
        `Failed to save MCP OAuth token for ${serverName}: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * Get a token for a specific MCP server.
   *
   * @param serverName The name of the MCP server
   * @returns The stored credentials or null if not found
   */
  async getToken(serverName: string): Promise<MCPOAuthCredentials | null> {
    this.validateServerName(serverName);

    const tokens = await this.loadTokens();
    const credential = tokens.get(serverName) || null;

    // Return credential if found

    return credential;
  }

  /**
   * Remove a token for a specific MCP server.
   *
   * @param serverName The name of the MCP server
   */
  async removeToken(serverName: string): Promise<void> {
    this.validateServerName(serverName);

    const tokens = await this.loadTokens();

    if (tokens.delete(serverName)) {
      try {
        if (tokens.size === 0) {
          // Remove file if no tokens left
          await fs.unlink(this.tokenFilePath);
          // Token file removed successfully
        } else {
          await this.writeTokenPayload(Array.from(tokens.values()));
          // Token removed successfully
        }
      } catch (error) {
        console.error(
          `Failed to remove MCP OAuth token for ${serverName}: ${getErrorMessage(error)}`,
        );
        // Don't throw - removal from memory map succeeded
      }
    } else {
      // No token found to remove
    }
  }

  /**
   * Clear all stored MCP OAuth tokens.
   */
  async clearAllTokens(): Promise<void> {
    try {
      await fs.unlink(this.tokenFilePath);
      // All tokens cleared successfully
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // No token file to clear
      } else {
        console.error(
          `Failed to clear MCP OAuth tokens: ${getErrorMessage(error)}`,
        );
      }
    }
  }

  /**
   * Validate that credentials object has the required structure.
   *
   * @param credentials The credentials to validate
   * @returns True if valid, false otherwise
   */
  private isValidCredentials(
    credentials: unknown,
  ): credentials is MCPOAuthCredentials {
    if (!credentials || typeof credentials !== 'object') {
      return false;
    }

    const cred = credentials as Record<string, unknown>;

    // Check required fields
    if (!cred.serverName || typeof cred.serverName !== 'string') {
      return false;
    }

    if (!cred.token || typeof cred.token !== 'object') {
      return false;
    }

    const token = cred.token as Record<string, unknown>;
    if (!token.accessToken || typeof token.accessToken !== 'string') {
      return false;
    }

    if (!token.tokenType || typeof token.tokenType !== 'string') {
      return false;
    }

    if (typeof cred.updatedAt !== 'number') {
      return false;
    }

    return true;
  }
}
