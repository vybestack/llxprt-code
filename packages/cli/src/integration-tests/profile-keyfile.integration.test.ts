/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ProfileManager, Profile } from '@vybestack/llxprt-code-core';
import {
  createTempDirectory,
  cleanupTempDirectory,
  createTempKeyfile,
} from './test-utils.js';

describe('Profile with Keyfile Integration Tests', () => {
  let tempDir: string;
  let profileManager: ProfileManager;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Store original HOME environment variable
    originalHome = process.env.HOME;

    // Create a temporary directory for our test
    tempDir = await createTempDirectory();

    // Set HOME to our temp directory so ProfileManager uses it
    process.env.HOME = tempDir;

    // Create a new ProfileManager instance (will use our temp HOME)
    profileManager = new ProfileManager();
  });

  afterEach(async () => {
    // Restore original HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Clean up temp directory
    await cleanupTempDirectory(tempDir);
  });

  describe('Basic Keyfile Functionality', () => {
    it('should create keyfile with proper permissions and load API key from it', async () => {
      const apiKeyContent = 'test-api-key-from-file-123456';
      const keyfilePath = await createTempKeyfile(tempDir, apiKeyContent);

      // Verify file permissions (should be 600)
      const stats = await fs.stat(keyfilePath);
      const permissions = (stats.mode & parseInt('777', 8)).toString(8);
      expect(permissions).toBe('600');

      // Create profile with keyfile reference
      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: { temperature: 0.7 },
        ephemeralSettings: {
          'auth-keyfile': keyfilePath,
        },
      };

      await profileManager.saveProfile('keyfile-test', profile);

      // Load profile and verify keyfile path is preserved
      const loaded = await profileManager.loadProfile('keyfile-test');
      expect(loaded.ephemeralSettings['auth-keyfile']).toBe(keyfilePath);

      // Verify we can read the keyfile content
      const keyContent = await fs.readFile(keyfilePath, 'utf-8');
      expect(keyContent).toBe(apiKeyContent);
    });

    it('should handle multiple keyfiles for different providers', async () => {
      // Create multiple keyfiles
      const openaiKey = 'sk-openai-test-key-123';
      const anthropicKey = 'sk-anthropic-test-key-456';
      const googleKey = 'google-api-key-789';

      const openaiKeyfile = await createTempKeyfile(tempDir, openaiKey);
      const anthropicKeyfile = path.join(tempDir, '.keys', 'anthropic-key');
      await fs.writeFile(anthropicKeyfile, anthropicKey, { mode: 0o600 });
      const googleKeyfile = path.join(tempDir, '.keys', 'google-key');
      await fs.writeFile(googleKeyfile, googleKey, { mode: 0o600 });

      // Create profiles for each provider
      const profiles: Record<string, Profile> = {
        'openai-profile': {
          version: 1,
          provider: 'openai',
          model: 'gpt-4',
          modelParams: {},
          ephemeralSettings: {
            'auth-keyfile': openaiKeyfile,
          },
        },
        'anthropic-profile': {
          version: 1,
          provider: 'anthropic',
          model: 'claude-3-opus-20240229',
          modelParams: {},
          ephemeralSettings: {
            'auth-keyfile': anthropicKeyfile,
          },
        },
        'google-profile': {
          version: 1,
          provider: 'google',
          model: 'gemini-pro',
          modelParams: {},
          ephemeralSettings: {
            'auth-keyfile': googleKeyfile,
          },
        },
      };

      // Save all profiles
      for (const [name, profile] of Object.entries(profiles)) {
        await profileManager.saveProfile(name, profile);
      }

      // Load profiles and verify keyfile paths
      for (const [name, expectedProfile] of Object.entries(profiles)) {
        const loaded = await profileManager.loadProfile(name);
        expect(loaded.ephemeralSettings['auth-keyfile']).toBe(
          expectedProfile.ephemeralSettings['auth-keyfile'],
        );

        // Verify keyfile content can be read
        const keyfilePath = loaded.ephemeralSettings['auth-keyfile'] as string;
        const content = await fs.readFile(keyfilePath, 'utf-8');
        expect(content).toBeTruthy();
      }
    });
  });

  describe('Keyfile Path Handling', () => {
    it('should handle relative and absolute keyfile paths', async () => {
      const apiKey = 'test-api-key-relative-absolute';

      // Test absolute path
      const absoluteKeyfile = path.join(tempDir, '.keys', 'absolute-key');
      await fs.mkdir(path.dirname(absoluteKeyfile), { recursive: true });
      await fs.writeFile(absoluteKeyfile, apiKey, { mode: 0o600 });

      // Test path with ~
      const homeKeyfile = '~/.keys/home-key';
      const resolvedHomeKeyfile = homeKeyfile.replace(/^~/, tempDir);
      await fs.mkdir(path.dirname(resolvedHomeKeyfile), { recursive: true });
      await fs.writeFile(resolvedHomeKeyfile, apiKey, { mode: 0o600 });

      const profiles: Record<string, Profile> = {
        'absolute-path': {
          version: 1,
          provider: 'openai',
          model: 'gpt-4',
          modelParams: {},
          ephemeralSettings: {
            'auth-keyfile': absoluteKeyfile,
          },
        },
        'home-path': {
          version: 1,
          provider: 'anthropic',
          model: 'claude-3',
          modelParams: {},
          ephemeralSettings: {
            'auth-keyfile': homeKeyfile,
          },
        },
      };

      for (const [name, profile] of Object.entries(profiles)) {
        await profileManager.saveProfile(name, profile);
        const loaded = await profileManager.loadProfile(name);

        const keyfilePath = loaded.ephemeralSettings['auth-keyfile'] as string;
        const resolvedPath = keyfilePath.replace(/^~/, tempDir);
        const content = await fs.readFile(resolvedPath, 'utf-8');
        expect(content).toBe(apiKey);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle missing keyfile gracefully', async () => {
      const nonExistentKeyfile = path.join(tempDir, 'does-not-exist.key');

      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {
          'auth-keyfile': nonExistentKeyfile,
        },
      };

      await profileManager.saveProfile('missing-keyfile', profile);
      const loaded = await profileManager.loadProfile('missing-keyfile');

      // Profile should load successfully with keyfile path
      expect(loaded.ephemeralSettings['auth-keyfile']).toBe(nonExistentKeyfile);

      // But reading the keyfile should fail
      await expect(fs.readFile(nonExistentKeyfile, 'utf-8')).rejects.toThrow();
    });

    it('should handle keyfile with wrong permissions', async () => {
      const apiKey = 'test-key-wrong-permissions';
      const keyfilePath = path.join(tempDir, '.keys', 'wrong-perms.key');
      await fs.mkdir(path.dirname(keyfilePath), { recursive: true });

      // Create keyfile with wrong permissions (644 instead of 600)
      await fs.writeFile(keyfilePath, apiKey, { mode: 0o644 });

      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {
          'auth-keyfile': keyfilePath,
        },
      };

      await profileManager.saveProfile('wrong-perms', profile);
      const loaded = await profileManager.loadProfile('wrong-perms');

      // Profile loads successfully
      expect(loaded.ephemeralSettings['auth-keyfile']).toBe(keyfilePath);

      // Verify permissions are not 600
      const stats = await fs.stat(keyfilePath);
      const permissions = (stats.mode & parseInt('777', 8)).toString(8);
      expect(permissions).not.toBe('600');

      // But we can still read the file (though in real usage this might trigger a warning)
      const content = await fs.readFile(keyfilePath, 'utf-8');
      expect(content).toBe(apiKey);
    });

    it('should handle keyfile with invalid content', async () => {
      // Test various invalid content scenarios
      const invalidContents = [
        '', // Empty file
        '\n\n\n', // Only whitespace
        'invalid\nmultiline\nkey', // Multiline content
        '   spaces-around-key   ', // Spaces that should be trimmed
      ];

      for (const [index, content] of invalidContents.entries()) {
        const keyfilePath = path.join(tempDir, '.keys', `invalid-${index}.key`);
        await fs.mkdir(path.dirname(keyfilePath), { recursive: true });
        await fs.writeFile(keyfilePath, content, { mode: 0o600 });

        const profile: Profile = {
          version: 1,
          provider: 'openai',
          model: 'gpt-4',
          modelParams: {},
          ephemeralSettings: {
            'auth-keyfile': keyfilePath,
          },
        };

        await profileManager.saveProfile(`invalid-content-${index}`, profile);
        const loaded = await profileManager.loadProfile(
          `invalid-content-${index}`,
        );

        expect(loaded.ephemeralSettings['auth-keyfile']).toBe(keyfilePath);

        // Simulate trimming as done in the actual code
        const keyContent = (await fs.readFile(keyfilePath, 'utf-8')).trim();

        // Empty or whitespace-only files result in empty string after trim
        const trimmedContent = content.trim();
        expect(keyContent).toBe(trimmedContent);
      }
    });
  });

  describe('Precedence and Conflicts', () => {
    it('should handle profile with both auth-key and auth-keyfile', async () => {
      const directApiKey = 'direct-api-key-123';
      const fileApiKey = 'file-api-key-456';
      const keyfilePath = await createTempKeyfile(tempDir, fileApiKey);

      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {
          'auth-key': directApiKey,
          'auth-keyfile': keyfilePath,
        },
      };

      await profileManager.saveProfile('both-auth-methods', profile);
      const loaded = await profileManager.loadProfile('both-auth-methods');

      // Both settings should be preserved in the profile
      expect(loaded.ephemeralSettings['auth-key']).toBe(directApiKey);
      expect(loaded.ephemeralSettings['auth-keyfile']).toBe(keyfilePath);

      // Verify we can read the keyfile
      const keyfileContent = await fs.readFile(keyfilePath, 'utf-8');
      expect(keyfileContent).toBe(fileApiKey);

      // Note: In actual usage (gemini.tsx), auth-key takes precedence over auth-keyfile
      // when both are present. This is handled by the application logic, not the profile system.
    });

    it('should update keyfile path when profile is modified', async () => {
      const apiKey1 = 'first-api-key';
      const apiKey2 = 'second-api-key';

      const keyfile1 = await createTempKeyfile(tempDir, apiKey1);
      const keyfile2 = path.join(tempDir, '.keys', 'second.key');
      await fs.writeFile(keyfile2, apiKey2, { mode: 0o600 });

      // Create initial profile
      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {
          'auth-keyfile': keyfile1,
        },
      };

      await profileManager.saveProfile('update-test', profile);

      // Load and verify initial keyfile
      let loaded = await profileManager.loadProfile('update-test');
      expect(loaded.ephemeralSettings['auth-keyfile']).toBe(keyfile1);

      // Update profile with new keyfile
      profile.ephemeralSettings['auth-keyfile'] = keyfile2;
      await profileManager.saveProfile('update-test', profile);

      // Load and verify updated keyfile
      loaded = await profileManager.loadProfile('update-test');
      expect(loaded.ephemeralSettings['auth-keyfile']).toBe(keyfile2);

      // Verify we can read the new keyfile
      const content = await fs.readFile(keyfile2, 'utf-8');
      expect(content).toBe(apiKey2);
    });
  });

  describe('Keyfile Reading Simulation', () => {
    it('should simulate the actual keyfile reading logic from gemini.tsx', async () => {
      const apiKey = 'simulated-api-key-reading';
      const keyfilePath = await createTempKeyfile(tempDir, apiKey);

      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {
          'auth-keyfile': keyfilePath,
        },
      };

      await profileManager.saveProfile('simulation-test', profile);
      const loaded = await profileManager.loadProfile('simulation-test');

      // Simulate the exact logic from gemini.tsx
      const authKey = loaded.ephemeralSettings['auth-key'] as string;
      const authKeyfile = loaded.ephemeralSettings['auth-keyfile'] as string;

      let appliedKey: string | undefined;

      if (authKey) {
        // Direct auth-key takes precedence
        appliedKey = authKey;
      } else if (authKeyfile) {
        // Load API key from file
        const resolvedPath = authKeyfile.replace(/^~/, os.homedir());
        const keyContent = (await fs.readFile(resolvedPath, 'utf-8')).trim();
        if (keyContent) {
          appliedKey = keyContent;
        }
      }

      expect(appliedKey).toBe(apiKey);
    });

    it('should handle keyfile with tilde expansion', async () => {
      const apiKey = 'tilde-expansion-test-key';

      // Create a keyfile in a path that would use ~
      const keyfileRelativePath = '.keys/tilde-test.key';
      const keyfileAbsolutePath = path.join(tempDir, keyfileRelativePath);
      await fs.mkdir(path.dirname(keyfileAbsolutePath), { recursive: true });
      await fs.writeFile(keyfileAbsolutePath, apiKey, { mode: 0o600 });

      // Save profile with ~ path
      const profile: Profile = {
        version: 1,
        provider: 'anthropic',
        model: 'claude-3',
        modelParams: {},
        ephemeralSettings: {
          'auth-keyfile': `~/${keyfileRelativePath}`,
        },
      };

      await profileManager.saveProfile('tilde-test', profile);
      const loaded = await profileManager.loadProfile('tilde-test');

      // Verify the ~ path is preserved in the profile
      expect(loaded.ephemeralSettings['auth-keyfile']).toBe(
        `~/${keyfileRelativePath}`,
      );

      // Simulate reading with tilde expansion
      const authKeyfile = loaded.ephemeralSettings['auth-keyfile'] as string;
      const resolvedPath = authKeyfile.replace(/^~/, tempDir);
      const content = await fs.readFile(resolvedPath, 'utf-8');
      expect(content.trim()).toBe(apiKey);
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle profile switching with different keyfiles', async () => {
      // Create multiple profiles with different keyfiles
      const profiles = [
        {
          name: 'dev-env',
          apiKey: 'dev-api-key-123',
          provider: 'openai',
        },
        {
          name: 'prod-env',
          apiKey: 'prod-api-key-456',
          provider: 'anthropic',
        },
        {
          name: 'test-env',
          apiKey: 'test-api-key-789',
          provider: 'google',
        },
      ];

      const createdProfiles: Record<string, string> = {};

      for (const { name, apiKey, provider } of profiles) {
        const keyfilePath = path.join(tempDir, '.keys', `${name}.key`);
        await fs.mkdir(path.dirname(keyfilePath), { recursive: true });
        await fs.writeFile(keyfilePath, apiKey, { mode: 0o600 });

        createdProfiles[name] = keyfilePath;

        const profile: Profile = {
          version: 1,
          provider: provider as Profile['provider'],
          model: 'test-model',
          modelParams: {},
          ephemeralSettings: {
            'auth-keyfile': keyfilePath,
          },
        };

        await profileManager.saveProfile(name, profile);
      }

      // Simulate switching between profiles
      for (const { name, apiKey } of profiles) {
        const loaded = await profileManager.loadProfile(name);
        const keyfilePath = loaded.ephemeralSettings['auth-keyfile'] as string;

        expect(keyfilePath).toBe(createdProfiles[name]);

        const content = await fs.readFile(keyfilePath, 'utf-8');
        expect(content).toBe(apiKey);
        // Environment setting was removed as it's not part of EphemeralSettings interface
      }
    });

    it('should handle keyfile in nested directory structure', async () => {
      const apiKey = 'nested-dir-api-key';
      const nestedPath = path.join(
        tempDir,
        '.config',
        'llxprt',
        'keys',
        'providers',
        'openai',
        'production.key',
      );

      await fs.mkdir(path.dirname(nestedPath), { recursive: true });
      await fs.writeFile(nestedPath, apiKey, { mode: 0o600 });

      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {
          'auth-keyfile': nestedPath,
        },
      };

      await profileManager.saveProfile('nested-keyfile', profile);
      const loaded = await profileManager.loadProfile('nested-keyfile');

      expect(loaded.ephemeralSettings['auth-keyfile']).toBe(nestedPath);

      const content = await fs.readFile(nestedPath, 'utf-8');
      expect(content).toBe(apiKey);
    });
  });
});
