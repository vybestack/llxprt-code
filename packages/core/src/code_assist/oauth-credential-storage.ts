/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type Credentials } from 'google-auth-library';
import { HybridTokenStorage } from '../mcp/token-storage/hybrid-token-storage.js';
import { OAUTH_FILE, Storage } from '../config/storage.js';
import type { OAuthCredentials } from '../mcp/token-storage/types.js';
import * as path from 'node:path';
import * as os from 'node:os';
import { promises as fs } from 'node:fs';
import { coreEvents } from '../utils/events.js';

const KEYCHAIN_SERVICE_NAME = 'llxprt-code-oauth';
const MAIN_ACCOUNT_KEY = 'main-account';

function getLegacyCredentialPaths(): string[] {
  const legacyPaths = [Storage.getOAuthCredsPath()];
  const homeDir = os.homedir();
  if (homeDir) {
    legacyPaths.push(path.join(homeDir, '.gemini', OAUTH_FILE));
  }
  return Array.from(new Set(legacyPaths));
}

export class OAuthCredentialStorage {
  constructor(
    private readonly storage: HybridTokenStorage = new HybridTokenStorage(
      KEYCHAIN_SERVICE_NAME,
    ),
  ) {}

  /**
   * Load cached OAuth credentials
   */
  async loadCredentials(): Promise<Credentials | null> {
    try {
      const credentials = await this.storage.getCredentials(MAIN_ACCOUNT_KEY);

      if (credentials?.token) {
        const { accessToken, refreshToken, expiresAt, tokenType, scope } =
          credentials.token;
        // Convert from OAuthCredentials format to Google Credentials format
        const googleCreds: Credentials = {
          access_token: accessToken,
          refresh_token: refreshToken || undefined,
          token_type: tokenType || undefined,
          scope: scope || undefined,
        };

        if (expiresAt) {
          googleCreds.expiry_date = expiresAt;
        }

        return googleCreds;
      }

      // Fallback: Try to migrate from old file-based storage
      return await this.migrateFromFileStorage();
    } catch (error: unknown) {
      coreEvents.emitFeedback(
        'error',
        'Failed to load OAuth credentials',
        error,
      );
      throw error instanceof Error
        ? error
        : new Error('Failed to load OAuth credentials');
    }
  }

  /**
   * Save OAuth credentials
   */
  async saveCredentials(credentials: Credentials): Promise<void> {
    if (!credentials.access_token) {
      throw new Error('Attempted to save credentials without an access token.');
    }

    // Convert Google Credentials to OAuthCredentials format
    const mcpCredentials: OAuthCredentials = {
      serverName: MAIN_ACCOUNT_KEY,
      token: {
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token || undefined,
        tokenType: credentials.token_type || 'Bearer',
        scope: credentials.scope || undefined,
        expiresAt: credentials.expiry_date || undefined,
      },
      updatedAt: Date.now(),
    };

    await this.storage.setCredentials(mcpCredentials);
  }

  /**
   * Clear cached OAuth credentials
   */
  async clearCredentials(): Promise<void> {
    try {
      await this.storage.deleteCredentials(MAIN_ACCOUNT_KEY);

      // Also try to remove the old file if it exists
      await Promise.all(
        getLegacyCredentialPaths().map((legacyPath) =>
          fs.rm(legacyPath, { force: true }).catch(() => {}),
        ),
      );
    } catch (error: unknown) {
      coreEvents.emitFeedback(
        'error',
        'Failed to clear OAuth credentials',
        error,
      );
      throw error instanceof Error
        ? error
        : new Error('Failed to clear OAuth credentials');
    }
  }

  /**
   * Migrate credentials from old file-based storage to keychain
   */
  private async migrateFromFileStorage(): Promise<Credentials | null> {
    for (const legacyPath of getLegacyCredentialPaths()) {
      let credsJson: string;
      try {
        credsJson = await fs.readFile(legacyPath, 'utf-8');
      } catch (error: unknown) {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          (error as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          continue;
        }
        throw error;
      }

      const credentials = JSON.parse(credsJson) as Credentials;
      await this.saveCredentials(credentials);
      await fs.rm(legacyPath, { force: true }).catch(() => {});
      return credentials;
    }

    return null;
  }
}
