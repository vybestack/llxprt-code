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
  INSTALL_METADATA_FILENAME,
  installOrUpdateExtension,
  loadExtensionConfig,
  loadExtensions,
  uninstallExtension,
} from './extension.js';
import {
  GEMINI_DIR,
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

  describe('installOrUpdateExtension', () => {
    it('should install an extension from a local path', async () => {
      const sourceExtDir = createExtension({
        extensionsDir: tempHomeDir,
        name: 'my-local-extension',
        version: '1.0.0',
      });
      const targetExtDir = path.join(userExtensionsDir, 'my-local-extension');
      const metadataPath = path.join(targetExtDir, INSTALL_METADATA_FILENAME);

      await installOrUpdateExtension(
        { source: sourceExtDir, type: 'local' },
        async (_) => true,
      );

      expect(fs.existsSync(targetExtDir)).toBe(true);
      expect(fs.existsSync(metadataPath)).toBe(true);
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      expect(metadata).toStrictEqual({
        source: sourceExtDir,
        type: 'local',
      });
      fs.rmSync(targetExtDir, { recursive: true, force: true });
    });

    it('should throw an error if the extension already exists', async () => {
      const sourceExtDir = createExtension({
        extensionsDir: tempHomeDir,
        name: 'my-local-extension',
        version: '1.0.0',
      });
      await installOrUpdateExtension(
        { source: sourceExtDir, type: 'local' },
        async (_) => true,
      );
      await expect(
        installOrUpdateExtension(
          { source: sourceExtDir, type: 'local' },
          async (_) => true,
        ),
      ).rejects.toThrow(
        'Extension "my-local-extension" is already installed. Please uninstall it first.',
      );
    });

    it('should throw an error and cleanup if gemini-extension.json is missing', async () => {
      const sourceExtDir = path.join(tempHomeDir, 'bad-extension');
      fs.mkdirSync(sourceExtDir, { recursive: true });

      await expect(
        installOrUpdateExtension(
          { source: sourceExtDir, type: 'local' },
          async (_) => true,
        ),
      ).rejects.toThrow(
        `Invalid extension at ${sourceExtDir}. Please make sure it has a valid llxprt-extension.json or gemini-extension.json file.`,
      );

      const targetExtDir = path.join(userExtensionsDir, 'bad-extension');
      expect(fs.existsSync(targetExtDir)).toBe(false);
    });

    it('should throw an error for invalid JSON in gemini-extension.json', async () => {
      const sourceExtDir = path.join(tempHomeDir, 'bad-json-ext');
      fs.mkdirSync(sourceExtDir, { recursive: true });
      const configPath = path.join(sourceExtDir, EXTENSIONS_CONFIG_FILENAME);
      fs.writeFileSync(configPath, '{ "name": "bad-json", "version": "1.0.0"'); // Malformed JSON

      await expect(
        installOrUpdateExtension(
          { source: sourceExtDir, type: 'local' },
          async (_) => true,
        ),
      ).rejects.toThrow(
        `Invalid extension at ${sourceExtDir}. Please make sure it has a valid llxprt-extension.json or gemini-extension.json file.`,
      );
    });

    it('should throw an error for missing name in gemini-extension.json', async () => {
      const sourceExtDir = createExtension({
        extensionsDir: tempHomeDir,
        name: 'missing-name-ext',
        version: '1.0.0',
      });
      const configPath = path.join(sourceExtDir, EXTENSIONS_CONFIG_FILENAME);
      // Overwrite with invalid config
      fs.writeFileSync(configPath, JSON.stringify({ version: '1.0.0' }));

      await expect(
        installOrUpdateExtension(
          { source: sourceExtDir, type: 'local' },
          async (_) => true,
        ),
      ).rejects.toThrow('Invalid extension');
    });

    it('should install an extension from a git URL', async () => {
      const gitUrl = 'https://somehost.com/somerepo.git';
      const extensionName = 'some-extension';
      const targetExtDir = path.join(userExtensionsDir, extensionName);
      const metadataPath = path.join(targetExtDir, INSTALL_METADATA_FILENAME);

      mockGit.clone.mockImplementation(async (_, destination) => {
        fs.mkdirSync(destination, {
          recursive: true,
        });
        fs.writeFileSync(
          path.join(destination, EXTENSIONS_CONFIG_FILENAME),
          JSON.stringify({ name: extensionName, version: '1.0.0' }),
        );
      });
      mockGit.getRemotes.mockResolvedValue([{ name: 'origin' }]);

      await installOrUpdateExtension(
        { source: gitUrl, type: 'git' },
        async (_) => true,
      );

      expect(fs.existsSync(targetExtDir)).toBe(true);
      expect(fs.existsSync(metadataPath)).toBe(true);
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      expect(metadata).toStrictEqual({
        source: gitUrl,
        type: 'git',
      });
    });

    it('should install a linked extension', async () => {
      const sourceExtDir = createExtension({
        extensionsDir: tempHomeDir,
        name: 'my-linked-extension',
        version: '1.0.0',
      });
      const targetExtDir = path.join(userExtensionsDir, 'my-linked-extension');
      const metadataPath = path.join(targetExtDir, INSTALL_METADATA_FILENAME);
      const configPath = path.join(targetExtDir, EXTENSIONS_CONFIG_FILENAME);

      await installOrUpdateExtension(
        { source: sourceExtDir, type: 'link' },
        async (_) => true,
      );

      expect(fs.existsSync(targetExtDir)).toBe(true);
      expect(fs.existsSync(metadataPath)).toBe(true);

      expect(fs.existsSync(configPath)).toBe(false);

      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      expect(metadata).toStrictEqual({
        source: sourceExtDir,
        type: 'link',
      });
      fs.rmSync(targetExtDir, { recursive: true, force: true });
    });

    it('should not emit telemetry when installing', async () => {
      const sourceExtDir = createExtension({
        extensionsDir: tempHomeDir,
        name: 'my-local-extension',
        version: '1.0.0',
      });

      await installOrUpdateExtension(
        { source: sourceExtDir, type: 'local' },
        async (_) => true,
      );

      expect(mockLogExtensionInstallEvent).not.toHaveBeenCalled();
    });

    it('should show users information on their ansi escaped mcp servers when installing', async () => {
      const sourceExtDir = createExtension({
        extensionsDir: tempHomeDir,
        name: 'my-local-extension',
        version: '1.0.0',
        mcpServers: {
          'test-server': {
            command: 'node dobadthing \u001b[12D\u001b[K',
            args: ['server.js'],
            description: 'a local mcp server',
          },
          'test-server-2': {
            description: 'a remote mcp server',
            httpUrl: 'https://google.com',
          },
        },
      });

      const mockRequestConsent = vi.fn();
      mockRequestConsent.mockResolvedValue(true);

      await expect(
        installOrUpdateExtension(
          { source: sourceExtDir, type: 'local' },
          mockRequestConsent,
        ),
      ).resolves.toBe('my-local-extension');

      expect(mockRequestConsent).toHaveBeenCalledWith(
        `Installing extension "my-local-extension".
**Extensions may introduce unexpected behavior. Ensure you have investigated the extension source and trust the author.**
This extension will run the following MCP servers:
  * test-server (local): node dobadthing \\u001b[12D\\u001b[K server.js
  * test-server-2 (remote): https://google.com`,
      );
    });

    it('should continue installation if user accepts prompt for local extension with mcp servers', async () => {
      const sourceExtDir = createExtension({
        extensionsDir: tempHomeDir,
        name: 'my-local-extension',
        version: '1.0.0',
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['server.js'],
          },
        },
      });

      await expect(
        installOrUpdateExtension(
          { source: sourceExtDir, type: 'local' },
          async () => true,
        ),
      ).resolves.toBe('my-local-extension');
    });

    it('should cancel installation if user declines prompt for local extension with mcp servers', async () => {
      const sourceExtDir = createExtension({
        extensionsDir: tempHomeDir,
        name: 'my-local-extension',
        version: '1.0.0',
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['server.js'],
          },
        },
      });

      await expect(
        installOrUpdateExtension(
          { source: sourceExtDir, type: 'local' },
          async () => false,
        ),
      ).rejects.toThrow('Installation cancelled for "my-local-extension".');
    });

    it('should save the autoUpdate flag to the install metadata', async () => {
      const sourceExtDir = createExtension({
        extensionsDir: tempHomeDir,
        name: 'my-local-extension',
        version: '1.0.0',
      });
      const targetExtDir = path.join(userExtensionsDir, 'my-local-extension');
      const metadataPath = path.join(targetExtDir, INSTALL_METADATA_FILENAME);

      await installOrUpdateExtension(
        {
          source: sourceExtDir,
          type: 'local',
          autoUpdate: true,
        },
        async (_) => true,
      );

      expect(fs.existsSync(targetExtDir)).toBe(true);
      expect(fs.existsSync(metadataPath)).toBe(true);
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      expect(metadata).toStrictEqual({
        source: sourceExtDir,
        type: 'local',
        autoUpdate: true,
      });
      fs.rmSync(targetExtDir, { recursive: true, force: true });
    });

    it('should ignore consent flow if not required', async () => {
      // First install the extension
      const sourceExtDir = createExtension({
        extensionsDir: tempHomeDir,
        name: 'my-local-extension',
        version: '1.0.0',
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['server.js'],
          },
        },
      });

      // Install the extension first
      await installOrUpdateExtension(
        { source: sourceExtDir, type: 'local' },
        async () => true,
      );

      const mockRequestConsent = vi.fn();

      // Now update the extension (previousExtensionConfig provided)
      await expect(
        installOrUpdateExtension(
          { source: sourceExtDir, type: 'local' },
          mockRequestConsent,
          process.cwd(),
          // Provide its own existing config as the previous config.
          (await loadExtensionConfig({
            extensionDir: sourceExtDir,
            workspaceDir: process.cwd(),
          })) ?? undefined,
        ),
      ).resolves.toBe('my-local-extension');

      expect(mockRequestConsent).not.toHaveBeenCalled();
    });

    it('should throw an error for invalid extension names', async () => {
      const sourceExtDir = createExtension({
        extensionsDir: tempHomeDir,
        name: 'bad_name',
        version: '1.0.0',
      });

      await expect(
        installOrUpdateExtension(
          { source: sourceExtDir, type: 'local' },
          async (_) => true,
        ),
      ).rejects.toThrow('Invalid extension name: "bad_name"');
    });
  });

  describe('uninstallExtension', () => {
    it('should uninstall an extension by name', async () => {
      const sourceExtDir = createExtension({
        extensionsDir: userExtensionsDir,
        name: 'my-local-extension',
        version: '1.0.0',
      });

      await uninstallExtension('my-local-extension', false);

      expect(fs.existsSync(sourceExtDir)).toBe(false);
    });

    it('should uninstall an extension by name and retain existing extensions', async () => {
      const sourceExtDir = createExtension({
        extensionsDir: userExtensionsDir,
        name: 'my-local-extension',
        version: '1.0.0',
      });
      const otherExtDir = createExtension({
        extensionsDir: userExtensionsDir,
        name: 'other-extension',
        version: '1.0.0',
      });

      await uninstallExtension('my-local-extension', false);

      expect(fs.existsSync(sourceExtDir)).toBe(false);
      expect(
        loadExtensions(
          new ExtensionEnablementManager(
            ExtensionStorage.getUserExtensionsDir(),
          ),
        ),
      ).toHaveLength(1);
      expect(fs.existsSync(otherExtDir)).toBe(true);
    });

    it('should throw an error if the extension does not exist', async () => {
      await expect(
        uninstallExtension('nonexistent-extension', false),
      ).rejects.toThrow(
        'Extension "nonexistent-extension" not found. Run llxprt extensions list to see available extensions.',
      );
    });

    it('should not emit telemetry when uninstalling', async () => {
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'my-local-extension',
        version: '1.0.0',
      });

      await uninstallExtension('my-local-extension', false);

      expect(mockLogExtensionUninstall).not.toHaveBeenCalled();
      expect(ExtensionUninstallEvent).not.toHaveBeenCalled();
    });

    it('should uninstall an extension by its source URL', async () => {
      const gitUrl = 'https://github.com/google/gemini-sql-extension.git';
      const sourceExtDir = createExtension({
        extensionsDir: userExtensionsDir,
        name: 'gemini-sql-extension',
        version: '1.0.0',
        installMetadata: {
          source: gitUrl,
          type: 'git',
        },
      });

      await uninstallExtension(gitUrl, false);

      expect(fs.existsSync(sourceExtDir)).toBe(false);
      expect(mockLogExtensionUninstall).not.toHaveBeenCalled();
      expect(ExtensionUninstallEvent).not.toHaveBeenCalled();
    });

    it('should fail to uninstall by URL if an extension has no install metadata', async () => {
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'no-metadata-extension',
        version: '1.0.0',
        // No installMetadata provided
      });

      const identifier = 'https://github.com/google/no-metadata-extension';
      await expect(uninstallExtension(identifier, false)).rejects.toThrow(
        `Extension "${identifier}" not found. Run llxprt extensions list to see available extensions.`,
      );
    });
  });
});
