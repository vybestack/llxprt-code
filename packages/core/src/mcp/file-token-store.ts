/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { Storage } from '../config/storage.js';
import { getErrorMessage } from '../utils/errors.js';
import {
  BaseTokenStore,
  MCPOAuthToken,
  MCPOAuthCredentials,
} from './token-store.js';

/**
 * File-based implementation of the BaseTokenStore.
 * Stores MCP OAuth tokens in a JSON file in the user's configuration directory.
 */
export class FileTokenStore extends BaseTokenStore {
  private readonly tokenFilePath: string;

  constructor(tokenFilePath?: string) {
    super();
    this.tokenFilePath = tokenFilePath || Storage.getMcpOAuthTokensPath();
  }

  /**
   * Ensure the config directory exists.
   */
  private async ensureConfigDir(): Promise<void> {
    const configDir = path.dirname(this.tokenFilePath);
    try {
      await fs.mkdir(configDir, { recursive: true });
    } catch (error) {
      console.error(`Failed to create config directory ${configDir}: ${getErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Load all stored MCP OAuth tokens.
   *
   * @returns A map of server names to credentials
   */
  async loadTokens(): Promise<Map<string, MCPOAuthCredentials>> {
    const tokenMap = new Map<string, MCPOAuthCredentials>();

    try {
      const data = await fs.readFile(this.tokenFilePath, 'utf-8');
      const tokens = JSON.parse(data) as MCPOAuthCredentials[];

      // Validate the loaded data structure
      if (!Array.isArray(tokens)) {
        console.warn('Token file contains invalid data structure, ignoring');
        return tokenMap;
      }

      for (const credential of tokens) {
        if (this.isValidCredentials(credential)) {
          tokenMap.set(credential.serverName, credential);
        } else {
          console.warn(`Skipping invalid credential entry for server: ${(credential as any)?.serverName || 'unknown'}`);
        }
      }
    } catch (error) {
      // File doesn't exist or is invalid, return empty map
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error(`Failed to load MCP OAuth tokens from ${this.tokenFilePath}: ${getErrorMessage(error)}`);
      }
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
    await this.ensureConfigDir();

    const tokens = await this.loadTokens();
    const credential = this.createCredentials(
      serverName,
      token,
      clientId,
      tokenUrl,
      mcpServerUrl,
    );

    tokens.set(serverName, credential);

    const tokenArray = Array.from(tokens.values());

    try {
      await fs.writeFile(
        this.tokenFilePath,
        JSON.stringify(tokenArray, null, 2),
        { mode: 0o600 }, // Restrict file permissions for security
      );

      // Token saved successfully
    } catch (error) {
      console.error(`Failed to save MCP OAuth token for ${serverName}: ${getErrorMessage(error)}`);
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
      const tokenArray = Array.from(tokens.values());

      try {
        if (tokenArray.length === 0) {
          // Remove file if no tokens left
          await fs.unlink(this.tokenFilePath);
          // Token file removed successfully
        } else {
          await fs.writeFile(
            this.tokenFilePath,
            JSON.stringify(tokenArray, null, 2),
            { mode: 0o600 },
          );
          // Token removed successfully
        }
      } catch (error) {
        console.error(`Failed to remove MCP OAuth token for ${serverName}: ${getErrorMessage(error)}`);
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
        console.error(`Failed to clear MCP OAuth tokens: ${getErrorMessage(error)}`);
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
