/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { OAuthToken, OAuthTokenSchema } from './types.js';

/**
 * Legacy token format from Google OAuth implementation
 */
interface LegacyGoogleCredentials {
  access_token?: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  id_token?: string;
  scope?: string;
}

/**
 * Legacy Qwen token format
 */
interface LegacyQwenCredentials {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
}

/**
 * Configuration for legacy token locations
 */
interface LegacyTokenLocation {
  path: string;
  format: 'google' | 'qwen' | 'generic';
  description: string;
}

/**
 * Migration result for a single provider
 */
interface MigrationResult {
  provider: string;
  success: boolean;
  migrated: boolean;
  error?: string;
  legacyPath?: string;
}

/**
 * Service for migrating OAuth tokens from legacy storage locations
 * to the new standardized ~/.llxprt/oauth/[provider].json format
 */
export class LegacyMigrationService {
  private readonly newBasePath: string;
  private readonly legacyLocations: Map<string, LegacyTokenLocation[]>;

  constructor() {
    this.newBasePath = join(homedir(), '.llxprt', 'oauth');
    this.legacyLocations = new Map([
      [
        'gemini',
        [
          {
            path: join(homedir(), '.llxprt', 'oauth_creds.json'),
            format: 'google',
            description: 'Legacy Google OAuth credentials file',
          },
          {
            path: join(homedir(), '.llxprt', 'google_accounts.json'),
            format: 'google',
            description: 'Legacy Google accounts file',
          },
        ],
      ],
      [
        'qwen',
        [
          {
            path: join(homedir(), '.qwen', 'oauth_creds.json'),
            format: 'qwen',
            description: 'Legacy Qwen OAuth credentials file',
          },
        ],
      ],
      [
        'anthropic',
        [
          // No documented legacy locations for Anthropic
        ],
      ],
    ]);
  }

  /**
   * Detect all legacy token files that exist on the system
   * @returns Array of providers that have legacy tokens
   */
  async detectLegacyTokens(): Promise<string[]> {
    const providersWithLegacyTokens: string[] = [];

    for (const [provider, locations] of this.legacyLocations) {
      for (const location of locations) {
        try {
          await fs.access(location.path);
          // File exists
          if (!providersWithLegacyTokens.includes(provider)) {
            providersWithLegacyTokens.push(provider);
          }
        } catch {
          // File doesn't exist, continue
        }
      }
    }

    return providersWithLegacyTokens;
  }

  /**
   * Migrate a single provider's tokens from legacy locations
   * @param provider - The provider name (e.g., 'gemini', 'qwen', 'anthropic')
   * @returns Migration result
   */
  async migrateProvider(provider: string): Promise<MigrationResult> {
    const result: MigrationResult = {
      provider,
      success: false,
      migrated: false,
    };

    try {
      // Check if new token already exists
      const newTokenPath = join(this.newBasePath, `${provider}.json`);
      try {
        await fs.access(newTokenPath);
        // New token exists, skip migration
        result.success = true;
        result.migrated = false;
        return result;
      } catch {
        // New token doesn't exist, proceed with migration
      }

      // Get legacy locations for this provider
      const locations = this.legacyLocations.get(provider) ?? [];
      if (locations.length === 0) {
        // No legacy locations configured for this provider
        result.success = true;
        result.migrated = false;
        return result;
      }

      // Try to migrate from each legacy location
      for (const location of locations) {
        try {
          const legacyToken = await this.loadLegacyToken(location);
          if (legacyToken) {
            // Successfully loaded legacy token, migrate it
            await this.saveMigratedToken(provider, legacyToken);
            result.success = true;
            result.migrated = true;
            result.legacyPath = location.path;
            return result;
          }
        } catch (error) {
          // Failed to load from this location, try next one
          console.debug(`Failed to migrate from ${location.path}:`, error);
        }
      }

      // No legacy tokens found
      result.success = true;
      result.migrated = false;
    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : String(error);
    }

    return result;
  }

  /**
   * Migrate all providers with legacy tokens
   * @returns Array of migration results for each provider
   */
  async migrateAllProviders(): Promise<MigrationResult[]> {
    const results: MigrationResult[] = [];
    const providersWithLegacyTokens = await this.detectLegacyTokens();

    // Also check providers even if no legacy tokens detected
    // in case they have new tokens that need validation
    const allProviders = Array.from(this.legacyLocations.keys());
    const providersToCheck = Array.from(
      new Set([...providersWithLegacyTokens, ...allProviders]),
    );

    for (const provider of providersToCheck) {
      const result = await this.migrateProvider(provider);
      results.push(result);
    }

    return results;
  }

  /**
   * Validate that migration was successful for a provider
   * @param provider - The provider name
   * @returns True if valid token exists in new location
   */
  async validateMigration(provider: string): Promise<boolean> {
    try {
      const tokenPath = join(this.newBasePath, `${provider}.json`);
      const content = await fs.readFile(tokenPath, 'utf8');
      const parsed = JSON.parse(content);

      // Validate token structure using schema
      OAuthTokenSchema.parse(parsed);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean up legacy token files after successful migration
   * @param provider - The provider name
   * @param dryRun - If true, only log what would be deleted without actually deleting
   * @returns Array of files that were (or would be) deleted
   */
  async cleanupLegacyTokens(
    provider: string,
    dryRun: boolean = false,
  ): Promise<string[]> {
    const deletedFiles: string[] = [];
    const locations = this.legacyLocations.get(provider) ?? [];

    for (const location of locations) {
      try {
        await fs.access(location.path);
        // File exists
        if (dryRun) {
          console.log(`Would delete legacy token file: ${location.path}`);
        } else {
          await fs.unlink(location.path);
          console.log(`Deleted legacy token file: ${location.path}`);
        }
        deletedFiles.push(location.path);
      } catch {
        // File doesn't exist, skip
      }
    }

    return deletedFiles;
  }

  /**
   * Handle rollback if migration fails
   * @param provider - The provider name
   * @param backupPath - Path to backup of original token (if any)
   */
  async rollbackMigration(
    provider: string,
    backupPath?: string,
  ): Promise<void> {
    try {
      // Remove the new token file if it exists
      const newTokenPath = join(this.newBasePath, `${provider}.json`);
      try {
        await fs.unlink(newTokenPath);
        console.log(`Removed failed migration token: ${newTokenPath}`);
      } catch {
        // File might not exist
      }

      // Restore backup if provided
      if (backupPath) {
        try {
          await fs.access(backupPath);
          // Backup exists, but since we're dealing with legacy files,
          // we don't need to restore them as they should still be in place
          console.log(`Legacy tokens remain at original locations`);
        } catch {
          // Backup doesn't exist
        }
      }
    } catch (error) {
      console.error('Failed to rollback migration:', error);
      throw error;
    }
  }

  /**
   * Load a legacy token from a specific location
   * @param location - The legacy token location configuration
   * @returns Parsed OAuth token or null if not found/invalid
   */
  private async loadLegacyToken(
    location: LegacyTokenLocation,
  ): Promise<OAuthToken | null> {
    try {
      const content = await fs.readFile(location.path, 'utf8');
      const parsed = JSON.parse(content);

      switch (location.format) {
        case 'google':
          return this.convertGoogleCredentialsToOAuthToken(
            parsed as LegacyGoogleCredentials,
          );
        case 'qwen':
          return this.convertQwenCredentialsToOAuthToken(
            parsed as LegacyQwenCredentials,
          );
        case 'generic':
          // Try to parse as generic OAuth token
          return OAuthTokenSchema.parse(parsed);
        default:
          throw new Error(`Unsupported legacy format: ${location.format}`);
      }
    } catch {
      return null;
    }
  }

  /**
   * Save a migrated token to the new standardized location
   * @param provider - The provider name
   * @param token - The OAuth token to save
   */
  private async saveMigratedToken(
    provider: string,
    token: OAuthToken,
  ): Promise<void> {
    // Ensure directory exists
    await fs.mkdir(this.newBasePath, { recursive: true, mode: 0o700 });

    // Set secure permissions on directory
    if (process.platform !== 'win32') {
      await fs.chmod(this.newBasePath, 0o700);
    }

    // Write token file
    const tokenPath = join(this.newBasePath, `${provider}.json`);
    const tempPath = `${tokenPath}.tmp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    try {
      await fs.writeFile(tempPath, JSON.stringify(token, null, 2), {
        mode: 0o600,
      });

      // Set secure permissions
      if (process.platform !== 'win32') {
        await fs.chmod(tempPath, 0o600);
      }

      // Atomic rename
      await fs.rename(tempPath, tokenPath);
    } catch (error) {
      // Cleanup temp file
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Convert legacy Google credentials to standardized OAuth token format
   * @param creds - Legacy Google credentials
   * @returns Standardized OAuth token
   */
  private convertGoogleCredentialsToOAuthToken(
    creds: LegacyGoogleCredentials,
  ): OAuthToken | null {
    if (!creds.access_token && !creds.refresh_token) {
      return null;
    }

    const token: OAuthToken = {
      access_token: creds.access_token ?? '',
      token_type: 'Bearer' as const,
      scope: creds.scope,
      expiry: creds.expiry_date
        ? Math.floor(creds.expiry_date / 1000)
        : Math.floor(Date.now() / 1000) + 3600,
    };

    if (creds.refresh_token) {
      token.refresh_token = creds.refresh_token;
    }

    return token;
  }

  /**
   * Convert legacy Qwen credentials to standardized OAuth token format
   * @param creds - Legacy Qwen credentials
   * @returns Standardized OAuth token
   */
  private convertQwenCredentialsToOAuthToken(
    creds: LegacyQwenCredentials,
  ): OAuthToken | null {
    if (!creds.access_token) {
      return null;
    }

    const token: OAuthToken = {
      access_token: creds.access_token,
      token_type: 'Bearer' as const,
      scope: creds.scope,
      expiry: creds.expires_in
        ? Math.floor(Date.now() / 1000) + creds.expires_in
        : Math.floor(Date.now() / 1000) + 3600,
    };

    if (creds.refresh_token) {
      token.refresh_token = creds.refresh_token;
    }

    return token;
  }

  /**
   * Get summary of migration status for all providers
   * @returns Migration status summary
   */
  async getMigrationStatus(): Promise<{
    totalProviders: number;
    providersWithLegacyTokens: number;
    providersMigrated: number;
    providersWithNewTokens: number;
  }> {
    const allProviders = Array.from(this.legacyLocations.keys());
    const providersWithLegacyTokens = await this.detectLegacyTokens();

    let providersMigrated = 0;
    let providersWithNewTokens = 0;

    for (const provider of allProviders) {
      const hasNewToken = await this.validateMigration(provider);
      if (hasNewToken) {
        providersWithNewTokens++;
        if (providersWithLegacyTokens.includes(provider)) {
          providersMigrated++;
        }
      }
    }

    return {
      totalProviders: allProviders.length,
      providersWithLegacyTokens: providersWithLegacyTokens.length,
      providersMigrated,
      providersWithNewTokens,
    };
  }
}
