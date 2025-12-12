/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { type OAuthToken, OAuthTokenSchema } from './types.js';

/**
 * Interface for multi-provider OAuth token storage
 */
export interface TokenStore {
  /**
   * Save an OAuth token for a specific provider
   * @param provider - The provider name (e.g., 'gemini', 'qwen')
   * @param token - The OAuth token to save
   */
  saveToken(provider: string, token: OAuthToken): Promise<void>;

  /**
   * Retrieve an OAuth token for a specific provider
   * @param provider - The provider name
   * @returns The token if found, null otherwise
   */
  getToken(provider: string): Promise<OAuthToken | null>;

  /**
   * Remove an OAuth token for a specific provider
   * @param provider - The provider name
   */
  removeToken(provider: string): Promise<void>;

  /**
   * List all providers that have stored tokens
   * @returns Array of provider names with stored tokens
   */
  listProviders(): Promise<string[]>;
}

/**
 * Implementation of multi-provider token storage
 * Stores tokens securely in ~/.llxprt/oauth/ directory
 */
export class MultiProviderTokenStore implements TokenStore {
  private readonly basePath: string;

  constructor() {
    this.basePath = join(homedir(), '.llxprt', 'oauth');
  }

  /**
   * Save an OAuth token for a specific provider
   */
  async saveToken(provider: string, token: OAuthToken): Promise<void> {
    // Validate provider name
    if (!provider || provider.trim() === '') {
      throw new Error('Provider name cannot be empty');
    }

    // Validate token structure
    const validatedToken = OAuthTokenSchema.parse(token);

    // Ensure directory exists with secure permissions
    await this.ensureDirectory();

    // Generate file paths
    const tokenPath = this.getTokenPath(provider);
    const tempPath = `${tokenPath}.tmp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    try {
      // Write to temporary file first (atomic operation)
      await fs.writeFile(tempPath, JSON.stringify(validatedToken, null, 2), {
        mode: 0o600,
      });

      // Set secure permissions explicitly (skip on Windows)
      if (process.platform !== 'win32') {
        await fs.chmod(tempPath, 0o600);
      }

      // Atomic rename to final location
      await fs.rename(tempPath, tokenPath);
    } catch (error) {
      // Cleanup temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Retrieve an OAuth token for a specific provider
   */
  async getToken(provider: string): Promise<OAuthToken | null> {
    try {
      const tokenPath = this.getTokenPath(provider);
      const content = await fs.readFile(tokenPath, 'utf8');
      const parsed = JSON.parse(content);

      // Validate token structure
      const validatedToken = OAuthTokenSchema.parse(parsed);
      return validatedToken;
    } catch (_error) {
      // Token not found
      return null;
    }
  }

  /**
   * Remove an OAuth token for a specific provider
   */
  async removeToken(provider: string): Promise<void> {
    try {
      const tokenPath = this.getTokenPath(provider);
      await fs.unlink(tokenPath);
    } catch (error) {
      // Check if error is because file doesn't exist
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        // File doesn't exist - operation succeeds silently
        return;
      }
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * List all providers that have stored tokens
   */
  async listProviders(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.basePath);
      const providers = files
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.replace('.json', ''))
        .sort();
      return providers;
    } catch (error) {
      // If directory doesn't exist, return empty array
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Ensure the OAuth directory exists with secure permissions
   */
  private async ensureDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.basePath, { recursive: true, mode: 0o700 });

      // Ensure permissions are correct even if directory already existed (skip on Windows)
      if (process.platform !== 'win32') {
        await fs.chmod(this.basePath, 0o700);

        // Also ensure parent .llxprt directory has secure permissions
        const parentDir = join(homedir(), '.llxprt');
        await fs.chmod(parentDir, 0o700);
      }
    } catch (error) {
      // If chmod fails because directory doesn't exist, that's fine
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
  }

  /**
   * Generate secure file path for a provider token
   * Uses path.join to prevent path traversal attacks
   */
  private getTokenPath(provider: string): string {
    return join(this.basePath, `${provider}.json`);
  }
}
