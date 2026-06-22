/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  EXTENSIONS_CONFIG_FILENAME,
  ExtensionStorage,
  annotateActiveExtensions,
  installOrUpdateExtension,
} from './extension.js';
import {
  GEMINI_DIR,
  type GeminiCLIExtension,
  ExtensionUninstallEvent,
  ExtensionDisableEvent,
  ExtensionEnableEvent,
} from '@vybestack/llxprt-code-core';
import { execSync } from 'node:child_process';
import { isWorkspaceTrusted } from './trustedFolders.js';
import { createExtension } from '../test-utils/createExtension.js';
import { ExtensionEnablementManager } from './extensions/extensionEnablement.js';

const mockGit = {
  clone: vi.fn(),
  getRemotes: vi.fn(),
  fetch: vi.fn(),
  checkout: vi.fn(),
  listRemote: vi.fn(),
  revparse: vi.fn(),
  // Not a part of the actual API, but we need to use this to do the correct
  // file system interactions.
  path: vi.fn(),
};

vi.mock('simple-git', () => ({
  simpleGit: vi.fn((path?: string) => {
    if (path) {
      mockGit.path.mockReturnValue(path);
    }
    return mockGit;
  }),
}));

vi.mock('os', async (importOriginal) => {
  const mockedOs = await importOriginal<typeof os>();
  return {
    ...mockedOs,
    homedir: vi.fn(),
  };
});

vi.mock('./trustedFolders.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./trustedFolders.js')>();
  return {
    ...actual,
    isWorkspaceTrusted: vi.fn(),
  };
});

const mockLogExtensionEnable = vi.hoisted(() => vi.fn());
const mockLogExtensionInstallEvent = vi.hoisted(() => vi.fn());
const mockLogExtensionUninstall = vi.hoisted(() => vi.fn());
const mockLogExtensionDisable = vi.hoisted(() => vi.fn());
vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-settings')>();
  return {
    ...actual,

    logExtensionEnable: mockLogExtensionEnable,
    logExtensionInstallEvent: mockLogExtensionInstallEvent,
    logExtensionUninstall: mockLogExtensionUninstall,
    logExtensionDisable: mockLogExtensionDisable,
    ExtensionEnableEvent: vi.fn(),
    ExtensionInstallEvent: vi.fn(),
    ExtensionUninstallEvent: vi.fn(),
    ExtensionDisableEvent: vi.fn(),
  };
});

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execSync: vi.fn(),
  };
});

const mockLoadSettings = vi.hoisted(() => vi.fn());

vi.mock('./settings.js', () => ({
  loadSettings: mockLoadSettings,
  SettingScope: {
    User: 'User',
    Workspace: 'Workspace',
  },
}));

const EXTENSIONS_DIRECTORY_NAME = path.join(GEMINI_DIR, 'extensions');

describe('extension tests', () => {
  let tempHomeDir: string;
  let tempWorkspaceDir: string;
  let userExtensionsDir: string;

  beforeEach(() => {
    tempHomeDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'gemini-cli-test-home-'),
    );
    tempWorkspaceDir = fs.mkdtempSync(
      path.join(tempHomeDir, 'gemini-cli-test-workspace-'),
    );
    userExtensionsDir = path.join(tempHomeDir, EXTENSIONS_DIRECTORY_NAME);
    fs.mkdirSync(userExtensionsDir, { recursive: true });

    vi.mocked(os.homedir).mockReturnValue(tempHomeDir);
    vi.mocked(isWorkspaceTrusted).mockReturnValue(true);
    vi.spyOn(process, 'cwd').mockReturnValue(tempWorkspaceDir);
    vi.mocked(execSync).mockClear();
    Object.values(mockGit).forEach((fn) => fn.mockReset());
    mockLogExtensionInstallEvent.mockReset();
    mockLogExtensionUninstall.mockReset();
    mockLogExtensionEnable.mockReset();
    mockLogExtensionDisable.mockReset();
    vi.mocked(ExtensionUninstallEvent).mockClear();
    vi.mocked(ExtensionDisableEvent).mockClear();
    vi.mocked(ExtensionEnableEvent).mockClear();
    // Default: extensions are enabled with extensionConfig enabled for tests
    mockLoadSettings.mockReturnValue({
      merged: {
        admin: {
          extensions: {
            enabled: true,
          },
        },
        experimental: {
          extensionConfig: true,
        },
      },
    });
  });

  afterEach(() => {
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
    fs.rmSync(tempWorkspaceDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('annotateActiveExtensions', () => {
    const extensions: GeminiCLIExtension[] = [
      {
        path: '/path/to/ext1',
        name: 'ext1',
        version: '1.0.0',
        contextFiles: [],
        isActive: true,
      },
      {
        path: '/path/to/ext2',
        name: 'ext2',
        version: '1.0.0',
        contextFiles: [],
        isActive: true,
      },
      {
        path: '/path/to/ext3',
        name: 'ext3',
        version: '1.0.0',
        contextFiles: [],
        isActive: true,
      },
    ];

    it('should mark all extensions as active if no enabled extensions are provided', () => {
      const activeExtensions = annotateActiveExtensions(
        extensions,
        '/path/to/workspace',
        new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      );
      expect(activeExtensions).toHaveLength(3);
      expect(activeExtensions.every((e) => e.isActive)).toBe(true);
    });

    it('should mark only the enabled extensions as active', () => {
      const activeExtensions = annotateActiveExtensions(
        extensions,
        '/path/to/workspace',
        new ExtensionEnablementManager(
          ExtensionStorage.getUserExtensionsDir(),
          ['ext1', 'ext3'],
        ),
      );
      expect(activeExtensions).toHaveLength(3);
      expect(activeExtensions.find((e) => e.name === 'ext1')?.isActive).toBe(
        true,
      );
      expect(activeExtensions.find((e) => e.name === 'ext2')?.isActive).toBe(
        false,
      );
      expect(activeExtensions.find((e) => e.name === 'ext3')?.isActive).toBe(
        true,
      );
    });

    it('should mark all extensions as inactive when "none" is provided', () => {
      const activeExtensions = annotateActiveExtensions(
        extensions,
        '/path/to/workspace',
        new ExtensionEnablementManager(
          ExtensionStorage.getUserExtensionsDir(),
          ['none'],
        ),
      );
      expect(activeExtensions).toHaveLength(3);
      expect(activeExtensions.every((e) => !e.isActive)).toBe(true);
    });

    it('should handle case-insensitivity', () => {
      const activeExtensions = annotateActiveExtensions(
        extensions,
        '/path/to/workspace',
        new ExtensionEnablementManager(
          ExtensionStorage.getUserExtensionsDir(),
          ['EXT1'],
        ),
      );
      expect(activeExtensions.find((e) => e.name === 'ext1')?.isActive).toBe(
        true,
      );
    });

    it('should emit feedback for unknown extensions', async () => {
      const { coreEvents } = await import('@vybestack/llxprt-code-core');
      const feedbackSpy = vi.spyOn(coreEvents, 'emitFeedback');
      annotateActiveExtensions(
        extensions,
        '/path/to/workspace',
        new ExtensionEnablementManager(
          ExtensionStorage.getUserExtensionsDir(),
          ['ext4'],
        ),
      );
      expect(feedbackSpy).toHaveBeenCalledWith(
        'error',
        'Extension not found: ext4',
      );
      feedbackSpy.mockRestore();
    });

    describe('autoUpdate', () => {
      it('should be false if autoUpdate is not set in install metadata', () => {
        const activeExtensions = annotateActiveExtensions(
          extensions,
          tempHomeDir,
          new ExtensionEnablementManager(
            ExtensionStorage.getUserExtensionsDir(),
          ),
        );
        expect(
          activeExtensions.every(
            (e) => e.installMetadata?.autoUpdate === false,
          ),
        ).toBe(false);
      });

      it('should be true if autoUpdate is true in install metadata', () => {
        const extensionsWithAutoUpdate: GeminiCLIExtension[] = extensions.map(
          (e) => ({
            ...e,
            installMetadata: {
              ...e.installMetadata!,
              autoUpdate: true,
            },
          }),
        );
        const activeExtensions = annotateActiveExtensions(
          extensionsWithAutoUpdate,
          tempHomeDir,
          new ExtensionEnablementManager(
            ExtensionStorage.getUserExtensionsDir(),
          ),
        );
        expect(
          activeExtensions.every((e) => e.installMetadata?.autoUpdate === true),
        ).toBe(true);
      });

      it('should respect the per-extension settings from install metadata', () => {
        const extensionsWithAutoUpdate: GeminiCLIExtension[] = [
          {
            path: '/path/to/ext1',
            name: 'ext1',
            version: '1.0.0',
            contextFiles: [],
            installMetadata: {
              source: 'test',
              type: 'local',
              autoUpdate: true,
            },
            isActive: true,
          },
          {
            path: '/path/to/ext2',
            name: 'ext2',
            version: '1.0.0',
            contextFiles: [],
            installMetadata: {
              source: 'test',
              type: 'local',
              autoUpdate: false,
            },
            isActive: true,
          },
          {
            path: '/path/to/ext3',
            name: 'ext3',
            version: '1.0.0',
            contextFiles: [],
            isActive: true,
          },
        ];
        const activeExtensions = annotateActiveExtensions(
          extensionsWithAutoUpdate,
          tempHomeDir,
          new ExtensionEnablementManager(
            ExtensionStorage.getUserExtensionsDir(),
          ),
        );
        expect(
          activeExtensions.find((e) => e.name === 'ext1')?.installMetadata
            ?.autoUpdate,
        ).toBe(true);
        expect(
          activeExtensions.find((e) => e.name === 'ext2')?.installMetadata
            ?.autoUpdate,
        ).toBe(false);
        expect(
          activeExtensions.find((e) => e.name === 'ext3')?.installMetadata
            ?.autoUpdate,
        ).toBe(undefined);
      });
    });
  });

  describe('hook schema and validation', () => {
    it('should reject invalid hook names', async () => {
      const invalidNames = [
        '../evil',
        '',
        '   ',
        'hook; rm -rf /',
        'my hook', // spaces
        'my\thook', // tabs
        'my\nhook', // newlines
      ];

      for (const hookName of invalidNames) {
        const sourceExtDir = path.join(tempHomeDir, 'bad-hook-name-ext');
        fs.mkdirSync(sourceExtDir, { recursive: true });
        const configPath = path.join(sourceExtDir, EXTENSIONS_CONFIG_FILENAME);
        fs.writeFileSync(
          configPath,
          JSON.stringify({
            name: 'bad-hook-name-ext',
            version: '1.0.0',
            hooks: {
              [hookName]: { command: 'echo test' },
            },
          }),
        );

        await expect(
          installOrUpdateExtension(
            { source: sourceExtDir, type: 'local' },
            async (_) => true,
          ),
        ).rejects.toThrow(/Hook name/);

        fs.rmSync(sourceExtDir, { recursive: true, force: true });
      }
    });

    it('should reject reserved keys in hook names', async () => {
      const reservedKeys = ['__proto__', 'constructor', 'prototype'];

      for (const hookName of reservedKeys) {
        const sourceExtDir = path.join(tempHomeDir, 'reserved-key-ext');
        fs.mkdirSync(sourceExtDir, { recursive: true });
        const configPath = path.join(sourceExtDir, EXTENSIONS_CONFIG_FILENAME);
        fs.writeFileSync(
          configPath,
          JSON.stringify({
            name: 'reserved-key-ext',
            version: '1.0.0',
            hooks: {
              [hookName]: { command: 'echo test' },
            },
          }),
        );

        await expect(
          installOrUpdateExtension(
            { source: sourceExtDir, type: 'local' },
            async (_) => true,
          ),
        ).rejects.toThrow(/reserved/);

        fs.rmSync(sourceExtDir, { recursive: true, force: true });
      }
    });

    it('should reject non-object hook definitions', async () => {
      const sourceExtDir = path.join(tempHomeDir, 'non-object-hook-ext');
      fs.mkdirSync(sourceExtDir, { recursive: true });
      const configPath = path.join(sourceExtDir, EXTENSIONS_CONFIG_FILENAME);
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          name: 'non-object-hook-ext',
          version: '1.0.0',
          hooks: {
            'my-hook': 'not-an-object',
          },
        }),
      );

      await expect(
        installOrUpdateExtension(
          { source: sourceExtDir, type: 'local' },
          async (_) => true,
        ),
      ).rejects.toThrow(/Invalid extension/);

      fs.rmSync(sourceExtDir, { recursive: true, force: true });
    });

    it('should reject oversized hook payloads', async () => {
      const longHookName = 'a'.repeat(129); // > 128 chars
      const sourceExtDir = path.join(tempHomeDir, 'oversized-hook-ext');
      fs.mkdirSync(sourceExtDir, { recursive: true });
      const configPath = path.join(sourceExtDir, EXTENSIONS_CONFIG_FILENAME);
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          name: 'oversized-hook-ext',
          version: '1.0.0',
          hooks: {
            [longHookName]: { command: 'echo test' },
          },
        }),
      );

      await expect(
        installOrUpdateExtension(
          { source: sourceExtDir, type: 'local' },
          async (_) => true,
        ),
      ).rejects.toThrow(/cannot exceed 128/);

      fs.rmSync(sourceExtDir, { recursive: true, force: true });
    });

    it('should accept valid hook names and structure', async () => {
      const sourceExtDir = path.join(tempHomeDir, 'valid-hook-ext');
      fs.mkdirSync(sourceExtDir, { recursive: true });
      const configPath = path.join(sourceExtDir, EXTENSIONS_CONFIG_FILENAME);
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          name: 'valid-hook-ext',
          version: '1.0.0',
          hooks: {
            'pre-commit': { command: 'lint' },
            'post-install': { command: 'setup' },
          },
        }),
      );

      await expect(
        installOrUpdateExtension(
          { source: sourceExtDir, type: 'local' },
          async (_) => true,
        ),
      ).resolves.toBe('valid-hook-ext');

      fs.rmSync(sourceExtDir, { recursive: true, force: true });
      fs.rmSync(path.join(userExtensionsDir, 'valid-hook-ext'), {
        recursive: true,
        force: true,
      });
    });

    it('should throw on invalid hooks (hard-fail validation)', async () => {
      const sourceExtDir = path.join(tempHomeDir, 'invalid-hook-ext');
      fs.mkdirSync(sourceExtDir, { recursive: true });
      const configPath = path.join(sourceExtDir, EXTENSIONS_CONFIG_FILENAME);
      fs.writeFileSync(
        configPath,
        JSON.stringify({
          name: 'invalid-hook-ext',
          version: '1.0.0',
          hooks: {
            '../evil': { command: 'rm -rf /' },
          },
        }),
      );

      // Should throw, not return null or false
      await expect(
        installOrUpdateExtension(
          { source: sourceExtDir, type: 'local' },
          async (_) => true,
        ),
      ).rejects.toThrow(/Hook name/);

      fs.rmSync(sourceExtDir, { recursive: true, force: true });
    });
  });

  describe('hook lifecycle coverage', () => {
    it('should prompt for hook consent when hooks exist during install', async () => {
      const sourceExtDir = createExtension({
        extensionsDir: tempHomeDir,
        name: 'hooks-ext',
        version: '1.0.0',
      });
      const configPath = path.join(sourceExtDir, EXTENSIONS_CONFIG_FILENAME);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      config.hooks = { 'pre-commit': { command: 'lint' } };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const mockConsent = vi.fn().mockResolvedValue(true);

      await installOrUpdateExtension(
        { source: sourceExtDir, type: 'local' },
        mockConsent,
      );

      // Should have called consent function
      expect(mockConsent).toHaveBeenCalled();

      fs.rmSync(path.join(userExtensionsDir, 'hooks-ext'), {
        recursive: true,
        force: true,
      });
    });

    it('should abort install when hook consent declined', async () => {
      const sourceExtDir = createExtension({
        extensionsDir: tempHomeDir,
        name: 'hooks-declined-ext',
        version: '1.0.0',
      });
      const configPath = path.join(sourceExtDir, EXTENSIONS_CONFIG_FILENAME);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      config.hooks = { 'pre-commit': { command: 'lint' } };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const mockConsent = vi.fn().mockResolvedValue(false);

      await expect(
        installOrUpdateExtension(
          { source: sourceExtDir, type: 'local' },
          mockConsent,
        ),
      ).rejects.toThrow(/declined|cancelled/);
    });

    it('should trigger consent on update with new hooks', async () => {
      // First install without hooks
      const sourceExtDir = createExtension({
        extensionsDir: tempHomeDir,
        name: 'update-hooks-ext',
        version: '1.0.0',
      });

      await installOrUpdateExtension(
        { source: sourceExtDir, type: 'local' },
        async (_) => true,
      );

      // Now add hooks and update
      const configPath = path.join(sourceExtDir, EXTENSIONS_CONFIG_FILENAME);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      config.hooks = { 'pre-commit': { command: 'lint' } };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const mockConsent = vi.fn().mockResolvedValue(true);

      // Update should trigger consent
      await installOrUpdateExtension(
        { source: sourceExtDir, type: 'local' },
        mockConsent,
        process.cwd(),
        (await import('./extension.js').then((m) =>
          m.loadExtensionConfig({
            extensionDir: path.join(userExtensionsDir, 'update-hooks-ext'),
            workspaceDir: process.cwd(),
          }),
        )) ?? undefined,
      );

      expect(mockConsent).toHaveBeenCalled();

      fs.rmSync(path.join(userExtensionsDir, 'update-hooks-ext'), {
        recursive: true,
        force: true,
      });
    });

    it('should preserve previous version when update declined (rollback)', async () => {
      // Install version 1.0.0 with no hooks
      const sourceExtDir = createExtension({
        extensionsDir: tempHomeDir,
        name: 'rollback-ext',
        version: '1.0.0',
      });

      await installOrUpdateExtension(
        { source: sourceExtDir, type: 'local' },
        async (_) => true,
      );

      // Update config to add hooks and bump version
      const configPath = path.join(sourceExtDir, EXTENSIONS_CONFIG_FILENAME);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      config.version = '2.0.0';
      config.hooks = { 'pre-commit': { command: 'lint' } };
      fs.writeFileSync(configPath, JSON.stringify(config));

      const mockConsent = vi.fn().mockResolvedValue(false);

      // Update should be declined
      await expect(
        installOrUpdateExtension(
          { source: sourceExtDir, type: 'local' },
          mockConsent,
          process.cwd(),
          (await import('./extension.js').then((m) =>
            m.loadExtensionConfig({
              extensionDir: path.join(userExtensionsDir, 'rollback-ext'),
              workspaceDir: process.cwd(),
            }),
          )) ?? undefined,
        ),
      ).rejects.toThrow(/declined|cancelled/);

      // Check that version is still 1.0.0
      const installedConfig = JSON.parse(
        fs.readFileSync(
          path.join(
            userExtensionsDir,
            'rollback-ext',
            EXTENSIONS_CONFIG_FILENAME,
          ),
          'utf-8',
        ),
      );
      expect(installedConfig.version).toBe('1.0.0');

      fs.rmSync(path.join(userExtensionsDir, 'rollback-ext'), {
        recursive: true,
        force: true,
      });
    });
  });
});
