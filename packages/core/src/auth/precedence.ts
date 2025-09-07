/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Authentication precedence utility for providers
 *
 * Implements the authentication precedence chain:
 * 1. /key command key
 * 2. /keyfile command keyfile
 * 3. --key CLI argument
 * 4. --keyfile CLI argument
 * 5. Environment variables
 * 6. OAuth (if enabled)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { getSettingsService } from '../settings/settingsServiceInstance.js';

export interface AuthPrecedenceConfig {
  // Environment variable names to check
  envKeyNames?: string[];

  // OAuth configuration
  isOAuthEnabled?: boolean;
  supportsOAuth?: boolean;
  oauthProvider?: string;
}

import { OAuthToken } from './types.js';

export interface OAuthManager {
  getToken(provider: string): Promise<string | null>;
  isAuthenticated(provider: string): Promise<boolean>;
  getOAuthToken?(provider: string): Promise<OAuthToken | null>;
}

export class AuthPrecedenceResolver {
  private config: AuthPrecedenceConfig;
  private oauthManager?: OAuthManager;

  constructor(config: AuthPrecedenceConfig, oauthManager?: OAuthManager) {
    this.config = config;
    this.oauthManager = oauthManager;
  }

  /**
   * Resolves authentication using the full precedence chain
   * Returns the first available authentication method or null if none found
   */
  async resolveAuthentication(): Promise<string | null> {
    const settingsService = getSettingsService();

    // 1. Check /key command key (highest priority) - stored in SettingsService
    const authKey = settingsService.get('auth-key');
    if (authKey && typeof authKey === 'string' && authKey.trim() !== '') {
      return authKey;
    }

    // 2. Check /keyfile command keyfile - stored in SettingsService
    const authKeyfile = settingsService.get('auth-keyfile');
    if (authKeyfile && typeof authKeyfile === 'string') {
      try {
        const keyFromFile = await this.readKeyFile(authKeyfile);
        if (keyFromFile) {
          return keyFromFile;
        }
      } catch (error) {
        if (process.env.DEBUG) {
          console.warn(
            `Failed to read keyfile from SettingsService ${authKeyfile}:`,
            error,
          );
        }
      }
    }

    // 3. Check environment variables
    if (this.config.envKeyNames && this.config.envKeyNames.length > 0) {
      for (const envVarName of this.config.envKeyNames) {
        const envValue = process.env[envVarName];
        if (envValue && envValue.trim() !== '') {
          return envValue;
        }
      }
    }

    // 4. OAuth (if enabled and supported)
    if (
      this.config.isOAuthEnabled &&
      this.config.supportsOAuth &&
      this.oauthManager &&
      this.config.oauthProvider
    ) {
      try {
        const token = await this.oauthManager.getToken(
          this.config.oauthProvider,
        );
        if (token) {
          return token;
        }
      } catch (error) {
        if (process.env.DEBUG) {
          console.warn(
            `Failed to get OAuth token for ${this.config.oauthProvider}:`,
            error,
          );
        }
      }
    }

    // No authentication method available
    return null;
  }

  /**
   * Check if any authentication method is available without triggering OAuth
   */
  async hasNonOAuthAuthentication(): Promise<boolean> {
    // Check all precedence levels except OAuth
    const tempConfig = { ...this.config, isOAuthEnabled: false };
    const tempResolver = new AuthPrecedenceResolver(tempConfig, undefined);
    const auth = await tempResolver.resolveAuthentication();
    return auth !== null;
  }

  /**
   * Check if OAuth is the only available authentication method
   */
  async isOAuthOnlyAvailable(): Promise<boolean> {
    const hasNonOAuth = await this.hasNonOAuthAuthentication();
    return (
      !hasNonOAuth &&
      this.config.isOAuthEnabled === true &&
      this.config.supportsOAuth === true
    );
  }

  /**
   * Get authentication method name for debugging/logging
   */
  async getAuthMethodName(): Promise<string | null> {
    const settingsService = getSettingsService();

    // Check precedence levels and return method name
    const authKey = settingsService.get('auth-key');
    if (authKey && typeof authKey === 'string' && authKey.trim() !== '') {
      return 'command-key';
    }

    const authKeyfile = settingsService.get('auth-keyfile');
    if (authKeyfile && typeof authKeyfile === 'string') {
      try {
        const keyFromFile = await this.readKeyFile(authKeyfile);
        if (keyFromFile) {
          return 'command-keyfile';
        }
      } catch {
        // Ignore errors for method detection
      }
    }

    if (this.config.envKeyNames && this.config.envKeyNames.length > 0) {
      for (const envVarName of this.config.envKeyNames) {
        const envValue = process.env[envVarName];
        if (envValue && envValue.trim() !== '') {
          return `env-${envVarName.toLowerCase()}`;
        }
      }
    }

    if (
      this.config.isOAuthEnabled &&
      this.config.supportsOAuth &&
      this.oauthManager &&
      this.config.oauthProvider
    ) {
      try {
        const isAuthenticated = await this.oauthManager.isAuthenticated(
          this.config.oauthProvider,
        );
        if (isAuthenticated) {
          return `oauth-${this.config.oauthProvider}`;
        }
      } catch {
        // Ignore errors for method detection
      }
    }

    return null;
  }

  /**
   * Reads API key from a file path, handling tilde expansion, absolute and relative paths
   */
  private async readKeyFile(filePath: string): Promise<string | null> {
    try {
      // Handle tilde expansion for home directory
      const expandedPath = filePath.startsWith('~')
        ? path.join(os.homedir(), filePath.slice(1))
        : filePath;

      // Handle relative paths from current working directory
      const resolvedPath = path.isAbsolute(expandedPath)
        ? expandedPath
        : path.resolve(process.cwd(), expandedPath);

      const content = await fs.readFile(resolvedPath, 'utf-8');
      const key = content.trim();

      if (key === '') {
        if (process.env.DEBUG) {
          console.warn(`Key file ${filePath} is empty`);
        }
        return null;
      }

      return key;
    } catch (error) {
      if (process.env.DEBUG) {
        console.warn(`Failed to read key file ${filePath}:`, error);
      }
      return null;
    }
  }

  /**
   * Updates the configuration
   */
  updateConfig(newConfig: Partial<AuthPrecedenceConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Updates the OAuth manager
   */
  updateOAuthManager(oauthManager: OAuthManager): void {
    this.oauthManager = oauthManager;
  }
}
