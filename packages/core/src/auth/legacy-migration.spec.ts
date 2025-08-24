/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { LegacyMigrationService } from './legacy-migration.js';
import { OAuthToken } from './types.js';

describe('LegacyMigrationService', () => {
  let service: LegacyMigrationService;
  let testHomeDir: string;
  let _originalHomedir: typeof import('os').homedir;

  beforeEach(async () => {
    // Create temporary directory structure
    testHomeDir = await fs.mkdtemp(join(tmpdir(), 'legacy-migration-test-'));

    // Mock homedir to return our test directory
    _originalHomedir = (await import('os')).homedir;
    vi.mock('os', async () => {
      const actual = await vi.importActual('os');
      return {
        ...(actual as object),
        homedir: () => testHomeDir,
      };
    });

    // Create fresh instance after mocking
    service = new LegacyMigrationService();
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await fs.rm(testHomeDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }

    // Restore homedir mock
    vi.clearAllMocks();
  });

  describe('detectLegacyTokens', () => {
    it('should detect no legacy tokens when none exist', async () => {
      const providers = await service.detectLegacyTokens();
      expect(providers).toEqual([]);
    });

    it('should detect Gemini legacy tokens in oauth_creds.json', async () => {
      // Create legacy Gemini token file
      const llxprtDir = join(testHomeDir, '.llxprt');
      await fs.mkdir(llxprtDir, { recursive: true });
      await fs.writeFile(
        join(llxprtDir, 'oauth_creds.json'),
        JSON.stringify({
          access_token: 'legacy_access_token',
          refresh_token: 'legacy_refresh_token',
          expiry_date: Date.now() + 3600000,
        }),
      );

      const providers = await service.detectLegacyTokens();
      expect(providers).toContain('gemini');
    });

    it('should detect Gemini legacy tokens in google_accounts.json', async () => {
      // Create legacy Google accounts file
      const llxprtDir = join(testHomeDir, '.llxprt');
      await fs.mkdir(llxprtDir, { recursive: true });
      await fs.writeFile(
        join(llxprtDir, 'google_accounts.json'),
        JSON.stringify({
          accounts: [{ email: 'test@example.com', tokens: {} }],
        }),
      );

      const providers = await service.detectLegacyTokens();
      expect(providers).toContain('gemini');
    });

    it('should detect Qwen legacy tokens in ~/.qwen/oauth_creds.json', async () => {
      // Create legacy Qwen token file
      const qwenDir = join(testHomeDir, '.qwen');
      await fs.mkdir(qwenDir, { recursive: true });
      await fs.writeFile(
        join(qwenDir, 'oauth_creds.json'),
        JSON.stringify({
          access_token: 'qwen_access_token',
          refresh_token: 'qwen_refresh_token',
          expires_in: 3600,
        }),
      );

      const providers = await service.detectLegacyTokens();
      expect(providers).toContain('qwen');
    });

    it('should detect multiple providers with legacy tokens', async () => {
      // Create both Gemini and Qwen legacy tokens
      const llxprtDir = join(testHomeDir, '.llxprt');
      const qwenDir = join(testHomeDir, '.qwen');
      await fs.mkdir(llxprtDir, { recursive: true });
      await fs.mkdir(qwenDir, { recursive: true });

      await fs.writeFile(
        join(llxprtDir, 'oauth_creds.json'),
        JSON.stringify({ access_token: 'gemini_token' }),
      );
      await fs.writeFile(
        join(qwenDir, 'oauth_creds.json'),
        JSON.stringify({ access_token: 'qwen_token' }),
      );

      const providers = await service.detectLegacyTokens();
      expect(providers).toContain('gemini');
      expect(providers).toContain('qwen');
    });
  });

  describe('migrateProvider', () => {
    it('should skip migration if new token already exists', async () => {
      // Create new token file
      const oauthDir = join(testHomeDir, '.llxprt', 'oauth');
      await fs.mkdir(oauthDir, { recursive: true });
      const existingToken: OAuthToken = {
        access_token: 'existing_token',
        token_type: 'Bearer',
      };
      await fs.writeFile(
        join(oauthDir, 'gemini.json'),
        JSON.stringify(existingToken),
      );

      const result = await service.migrateProvider('gemini');
      expect(result.success).toBe(true);
      expect(result.migrated).toBe(false);
    });

    it('should successfully migrate Gemini tokens from oauth_creds.json', async () => {
      // Create legacy Gemini token
      const llxprtDir = join(testHomeDir, '.llxprt');
      await fs.mkdir(llxprtDir, { recursive: true });
      const legacyToken = {
        access_token: 'legacy_access_token',
        refresh_token: 'legacy_refresh_token',
        expiry_date: Date.now() + 3600000,
        token_type: 'Bearer',
      };
      await fs.writeFile(
        join(llxprtDir, 'oauth_creds.json'),
        JSON.stringify(legacyToken),
      );

      const result = await service.migrateProvider('gemini');
      expect(result.success).toBe(true);
      expect(result.migrated).toBe(true);
      expect(result.legacyPath).toBe(join(llxprtDir, 'oauth_creds.json'));

      // Verify new token file was created
      const newTokenPath = join(testHomeDir, '.llxprt', 'oauth', 'gemini.json');
      const newTokenContent = await fs.readFile(newTokenPath, 'utf8');
      const newToken = JSON.parse(newTokenContent);
      expect(newToken.access_token).toBe('legacy_access_token');
      expect(newToken.refresh_token).toBe('legacy_refresh_token');
      expect(newToken.token_type).toBe('Bearer');
      expect(newToken.expires_at).toBeDefined();
    });

    it('should successfully migrate Qwen tokens from legacy location', async () => {
      // Create legacy Qwen token
      const qwenDir = join(testHomeDir, '.qwen');
      await fs.mkdir(qwenDir, { recursive: true });
      const legacyToken = {
        access_token: 'qwen_access_token',
        refresh_token: 'qwen_refresh_token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'read write',
      };
      await fs.writeFile(
        join(qwenDir, 'oauth_creds.json'),
        JSON.stringify(legacyToken),
      );

      const result = await service.migrateProvider('qwen');
      expect(result.success).toBe(true);
      expect(result.migrated).toBe(true);
      expect(result.legacyPath).toBe(join(qwenDir, 'oauth_creds.json'));

      // Verify new token file was created
      const newTokenPath = join(testHomeDir, '.llxprt', 'oauth', 'qwen.json');
      const newTokenContent = await fs.readFile(newTokenPath, 'utf8');
      const newToken = JSON.parse(newTokenContent);
      expect(newToken.access_token).toBe('qwen_access_token');
      expect(newToken.refresh_token).toBe('qwen_refresh_token');
      expect(newToken.token_type).toBe('Bearer');
      expect(newToken.scope).toBe('read write');
      expect(newToken.expires_at).toBeDefined();
    });

    it('should handle corrupted legacy token gracefully', async () => {
      // Create corrupted legacy token file
      const llxprtDir = join(testHomeDir, '.llxprt');
      await fs.mkdir(llxprtDir, { recursive: true });
      await fs.writeFile(
        join(llxprtDir, 'oauth_creds.json'),
        'invalid json content',
      );

      const result = await service.migrateProvider('gemini');
      expect(result.success).toBe(true);
      expect(result.migrated).toBe(false);
    });

    it('should handle provider with no legacy locations configured', async () => {
      const result = await service.migrateProvider('anthropic');
      expect(result.success).toBe(true);
      expect(result.migrated).toBe(false);
    });

    it('should handle missing access_token in legacy token', async () => {
      // Create legacy token without access_token
      const llxprtDir = join(testHomeDir, '.llxprt');
      await fs.mkdir(llxprtDir, { recursive: true });
      const legacyToken = {
        refresh_token: 'only_refresh',
        token_type: 'Bearer',
      };
      await fs.writeFile(
        join(llxprtDir, 'oauth_creds.json'),
        JSON.stringify(legacyToken),
      );

      const result = await service.migrateProvider('gemini');
      expect(result.success).toBe(true);
      expect(result.migrated).toBe(false);
    });
  });

  describe('migrateAllProviders', () => {
    it('should migrate all providers with legacy tokens', async () => {
      // Create legacy tokens for multiple providers
      const llxprtDir = join(testHomeDir, '.llxprt');
      const qwenDir = join(testHomeDir, '.qwen');
      await fs.mkdir(llxprtDir, { recursive: true });
      await fs.mkdir(qwenDir, { recursive: true });

      await fs.writeFile(
        join(llxprtDir, 'oauth_creds.json'),
        JSON.stringify({
          access_token: 'gemini_token',
          token_type: 'Bearer',
        }),
      );
      await fs.writeFile(
        join(qwenDir, 'oauth_creds.json'),
        JSON.stringify({
          access_token: 'qwen_token',
          token_type: 'Bearer',
        }),
      );

      const results = await service.migrateAllProviders();

      const geminiResult = results.find((r) => r.provider === 'gemini');
      const qwenResult = results.find((r) => r.provider === 'qwen');
      const anthropicResult = results.find((r) => r.provider === 'anthropic');

      expect(geminiResult?.success).toBe(true);
      expect(geminiResult?.migrated).toBe(true);
      expect(qwenResult?.success).toBe(true);
      expect(qwenResult?.migrated).toBe(true);
      expect(anthropicResult?.success).toBe(true);
      expect(anthropicResult?.migrated).toBe(false);
    });
  });

  describe('validateMigration', () => {
    it('should return true for valid migrated token', async () => {
      // Create new token file
      const oauthDir = join(testHomeDir, '.llxprt', 'oauth');
      await fs.mkdir(oauthDir, { recursive: true });
      const token: OAuthToken = {
        access_token: 'valid_token',
        token_type: 'Bearer',
      };
      await fs.writeFile(join(oauthDir, 'gemini.json'), JSON.stringify(token));

      const isValid = await service.validateMigration('gemini');
      expect(isValid).toBe(true);
    });

    it('should return false for missing token file', async () => {
      const isValid = await service.validateMigration('gemini');
      expect(isValid).toBe(false);
    });

    it('should return false for invalid token format', async () => {
      // Create invalid token file
      const oauthDir = join(testHomeDir, '.llxprt', 'oauth');
      await fs.mkdir(oauthDir, { recursive: true });
      await fs.writeFile(
        join(oauthDir, 'gemini.json'),
        JSON.stringify({ invalid: 'token' }),
      );

      const isValid = await service.validateMigration('gemini');
      expect(isValid).toBe(false);
    });
  });

  describe('cleanupLegacyTokens', () => {
    it('should delete legacy token files in dry run mode', async () => {
      // Create legacy token files
      const llxprtDir = join(testHomeDir, '.llxprt');
      await fs.mkdir(llxprtDir, { recursive: true });
      await fs.writeFile(
        join(llxprtDir, 'oauth_creds.json'),
        JSON.stringify({ access_token: 'test' }),
      );
      await fs.writeFile(
        join(llxprtDir, 'google_accounts.json'),
        JSON.stringify({ accounts: [] }),
      );

      const deletedFiles = await service.cleanupLegacyTokens('gemini', true);
      expect(deletedFiles.length).toBe(2);
      expect(deletedFiles).toContain(join(llxprtDir, 'oauth_creds.json'));
      expect(deletedFiles).toContain(join(llxprtDir, 'google_accounts.json'));

      // Files should still exist (dry run)
      await expect(
        fs.access(join(llxprtDir, 'oauth_creds.json')),
      ).resolves.toBeUndefined();
    });

    it('should actually delete legacy token files when not in dry run mode', async () => {
      // Create legacy token files
      const llxprtDir = join(testHomeDir, '.llxprt');
      await fs.mkdir(llxprtDir, { recursive: true });
      await fs.writeFile(
        join(llxprtDir, 'oauth_creds.json'),
        JSON.stringify({ access_token: 'test' }),
      );

      const deletedFiles = await service.cleanupLegacyTokens('gemini', false);
      expect(deletedFiles.length).toBe(1);

      // File should be deleted
      await expect(
        fs.access(join(llxprtDir, 'oauth_creds.json')),
      ).rejects.toThrow();
    });

    it('should handle missing legacy files gracefully', async () => {
      const deletedFiles = await service.cleanupLegacyTokens('gemini', false);
      expect(deletedFiles).toEqual([]);
    });
  });

  describe('rollbackMigration', () => {
    it('should remove new token file on rollback', async () => {
      // Create new token file that would be rolled back
      const oauthDir = join(testHomeDir, '.llxprt', 'oauth');
      await fs.mkdir(oauthDir, { recursive: true });
      await fs.writeFile(
        join(oauthDir, 'gemini.json'),
        JSON.stringify({ access_token: 'failed_migration' }),
      );

      await service.rollbackMigration('gemini');

      // New token file should be deleted
      await expect(fs.access(join(oauthDir, 'gemini.json'))).rejects.toThrow();
    });

    it('should handle missing new token file during rollback', async () => {
      // Should not throw even if file doesn't exist
      await expect(
        service.rollbackMigration('gemini'),
      ).resolves.toBeUndefined();
    });
  });

  describe('getMigrationStatus', () => {
    it('should return correct migration status summary', async () => {
      // Create mix of legacy and new tokens
      const llxprtDir = join(testHomeDir, '.llxprt');
      const oauthDir = join(llxprtDir, 'oauth');
      const qwenDir = join(testHomeDir, '.qwen');

      await fs.mkdir(oauthDir, { recursive: true });
      await fs.mkdir(qwenDir, { recursive: true });

      // Legacy token for Gemini
      await fs.writeFile(
        join(llxprtDir, 'oauth_creds.json'),
        JSON.stringify({ access_token: 'gemini_legacy' }),
      );

      // New token for Gemini (migrated)
      await fs.writeFile(
        join(oauthDir, 'gemini.json'),
        JSON.stringify({ access_token: 'gemini_new', token_type: 'Bearer' }),
      );

      // Legacy token for Qwen (not yet migrated)
      await fs.writeFile(
        join(qwenDir, 'oauth_creds.json'),
        JSON.stringify({ access_token: 'qwen_legacy' }),
      );

      const status = await service.getMigrationStatus();
      expect(status.totalProviders).toBe(3); // gemini, qwen, anthropic
      expect(status.providersWithLegacyTokens).toBe(2); // gemini, qwen
      expect(status.providersWithNewTokens).toBe(1); // gemini
      expect(status.providersMigrated).toBe(1); // gemini
    });

    it('should handle no tokens scenario', async () => {
      const status = await service.getMigrationStatus();
      expect(status.totalProviders).toBe(3);
      expect(status.providersWithLegacyTokens).toBe(0);
      expect(status.providersWithNewTokens).toBe(0);
      expect(status.providersMigrated).toBe(0);
    });
  });

  describe('concurrent migration attempts', () => {
    it('should handle concurrent migration attempts safely', async () => {
      // Create legacy token
      const llxprtDir = join(testHomeDir, '.llxprt');
      await fs.mkdir(llxprtDir, { recursive: true });
      await fs.writeFile(
        join(llxprtDir, 'oauth_creds.json'),
        JSON.stringify({
          access_token: 'concurrent_test',
          token_type: 'Bearer',
        }),
      );

      // Run multiple migrations concurrently
      const migrations = await Promise.all([
        service.migrateProvider('gemini'),
        service.migrateProvider('gemini'),
        service.migrateProvider('gemini'),
      ]);

      // Only one should report successful migration
      const successfulMigrations = migrations.filter((m) => m.migrated);
      expect(successfulMigrations.length).toBeLessThanOrEqual(1);

      // All should report success (no errors)
      migrations.forEach((result) => {
        expect(result.success).toBe(true);
      });

      // Token should exist and be valid
      const isValid = await service.validateMigration('gemini');
      expect(isValid).toBe(true);
    });
  });
});
