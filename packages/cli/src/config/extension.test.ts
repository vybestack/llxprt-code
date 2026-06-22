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
  disableExtension,
  installOrUpdateExtension,
  loadExtension,
  loadExtensions,
} from './extension.js';
import {
  GEMINI_DIR,
  ExtensionUninstallEvent,
  ExtensionDisableEvent,
  ExtensionEnableEvent,
} from '@vybestack/llxprt-code-core';
import { execSync } from 'node:child_process';
import { SettingScope } from './settings.js';
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

  describe('loadExtensions', () => {
    it('should include extension path in loaded extension', () => {
      const extensionDir = path.join(userExtensionsDir, 'test-extension');
      fs.mkdirSync(extensionDir, { recursive: true });

      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'test-extension',
        version: '1.0.0',
      });

      const extensions = loadExtensions(
        new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      );
      expect(extensions).toHaveLength(1);
      expect(extensions[0].path).toBe(extensionDir);
      expect(extensions[0].name).toBe('test-extension');
    });

    it('should load context file path when LLXPRT.md is present', () => {
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'ext1',
        version: '1.0.0',
        addContextFile: true,
      });
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'ext2',
        version: '2.0.0',
      });

      const extensions = loadExtensions(
        new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      );

      expect(extensions).toHaveLength(2);
      const ext1 = extensions.find((e) => e.name === 'ext1');
      const ext2 = extensions.find((e) => e.name === 'ext2');
      expect(ext1?.contextFiles).toStrictEqual([
        path.join(userExtensionsDir, 'ext1', 'LLXPRT.md'),
      ]);
      expect(ext2?.contextFiles).toStrictEqual([]);
    });

    it('should load context file path from the extension config', () => {
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'ext1',
        version: '1.0.0',
        addContextFile: false,
        contextFileName: 'my-context-file.md',
      });

      const extensions = loadExtensions(
        new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      );

      expect(extensions).toHaveLength(1);
      const ext1 = extensions.find((e) => e.name === 'ext1');
      expect(ext1?.contextFiles).toStrictEqual([
        path.join(userExtensionsDir, 'ext1', 'my-context-file.md'),
      ]);
    });

    it('should filter out disabled extensions', () => {
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'disabled-extension',
        version: '1.0.0',
      });
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'enabled-extension',
        version: '2.0.0',
      });
      disableExtension(
        'disabled-extension',
        SettingScope.User,
        tempWorkspaceDir,
      );
      const manager = new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
      );
      const extensions = loadExtensions(manager);
      const activeExtensions = annotateActiveExtensions(
        extensions,
        tempWorkspaceDir,
        manager,
      ).filter((e) => e.isActive);
      expect(activeExtensions).toHaveLength(1);
      expect(activeExtensions[0].name).toBe('enabled-extension');
    });

    it('should hydrate variables', () => {
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'test-extension',
        version: '1.0.0',
        addContextFile: false,
        contextFileName: undefined,
        mcpServers: {
          'test-server': {
            cwd: '${extensionPath}${/}server',
          },
        },
      });

      const extensions = loadExtensions(
        new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      );
      expect(extensions).toHaveLength(1);
      const expectedCwd = path.join(
        userExtensionsDir,
        'test-extension',
        'server',
      );
      expect(extensions[0].mcpServers?.['test-server'].cwd).toBe(expectedCwd);
    });

    it('should load a linked extension correctly', async () => {
      const sourceExtDir = createExtension({
        extensionsDir: tempWorkspaceDir,
        name: 'my-linked-extension',
        version: '1.0.0',
        contextFileName: 'context.md',
      });
      fs.writeFileSync(path.join(sourceExtDir, 'context.md'), 'linked context');

      const extensionName = await installOrUpdateExtension(
        {
          source: sourceExtDir,
          type: 'link',
        },
        async (_) => true,
      );

      expect(extensionName).toStrictEqual('my-linked-extension');
      const extensions = loadExtensions(
        new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      );
      expect(extensions).toHaveLength(1);

      const linkedExt = extensions[0];
      expect(linkedExt.name).toBe('my-linked-extension');

      expect(linkedExt.path).toBe(sourceExtDir);
      expect(linkedExt.installMetadata).toStrictEqual({
        source: sourceExtDir,
        type: 'link',
      });
      expect(linkedExt.contextFiles).toStrictEqual([
        path.join(sourceExtDir, 'context.md'),
      ]);
    });

    it('should hydrate ${extensionPath} correctly for linked extensions', async () => {
      const sourceExtDir = createExtension({
        extensionsDir: tempWorkspaceDir,
        name: 'my-linked-extension-with-path',
        version: '1.0.0',
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['${extensionPath}${/}server${/}index.js'],
            cwd: '${extensionPath}${/}server',
          },
        },
      });

      await installOrUpdateExtension(
        {
          source: sourceExtDir,
          type: 'link',
        },
        async (_) => true,
      );

      const extensions = loadExtensions(
        new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      );
      expect(extensions).toHaveLength(1);
      expect(extensions[0].mcpServers?.['test-server'].cwd).toBe(
        path.join(sourceExtDir, 'server'),
      );
      expect(extensions[0].mcpServers?.['test-server'].args).toStrictEqual([
        path.join(sourceExtDir, 'server', 'index.js'),
      ]);
    });

    it('should resolve environment variables in extension configuration', () => {
      process.env['TEST_API_KEY'] = 'test-api-key-123';
      process.env['TEST_DB_URL'] = 'postgresql://localhost:5432/testdb';

      try {
        const userExtensionsDir = path.join(
          tempHomeDir,
          EXTENSIONS_DIRECTORY_NAME,
        );
        fs.mkdirSync(userExtensionsDir, { recursive: true });

        const extDir = path.join(userExtensionsDir, 'test-extension');
        fs.mkdirSync(extDir);

        // Write config to a separate file for clarity and good practices
        const configPath = path.join(extDir, EXTENSIONS_CONFIG_FILENAME);
        const extensionConfig = {
          name: 'test-extension',
          version: '1.0.0',
          mcpServers: {
            'test-server': {
              command: 'node',
              args: ['server.js'],
              env: {
                API_KEY: '$TEST_API_KEY',
                DATABASE_URL: '${TEST_DB_URL}',
                STATIC_VALUE: 'no-substitution',
              },
            },
          },
        };
        fs.writeFileSync(configPath, JSON.stringify(extensionConfig));

        const extensions = loadExtensions(
          new ExtensionEnablementManager(
            ExtensionStorage.getUserExtensionsDir(),
          ),
        );

        expect(extensions).toHaveLength(1);
        const extension = extensions[0];
        expect(extension.name).toBe('test-extension');
        expect(extension.mcpServers).toBeDefined();

        const serverConfig = extension.mcpServers?.['test-server'];
        expect(serverConfig).toBeDefined();
        expect(serverConfig?.env).toBeDefined();
        expect(serverConfig?.env?.['API_KEY']).toBe('test-api-key-123');
        expect(serverConfig?.env?.['DATABASE_URL']).toBe(
          'postgresql://localhost:5432/testdb',
        );
        expect(serverConfig?.env?.['STATIC_VALUE']).toBe('no-substitution');
      } finally {
        delete process.env['TEST_API_KEY'];
        delete process.env['TEST_DB_URL'];
      }
    });

    it('should handle missing environment variables gracefully', () => {
      const userExtensionsDir = path.join(
        tempHomeDir,
        EXTENSIONS_DIRECTORY_NAME,
      );
      fs.mkdirSync(userExtensionsDir, { recursive: true });

      const extDir = path.join(userExtensionsDir, 'test-extension');
      fs.mkdirSync(extDir);

      const extensionConfig = {
        name: 'test-extension',
        version: '1.0.0',
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['server.js'],
            env: {
              MISSING_VAR: '$UNDEFINED_ENV_VAR',
              MISSING_VAR_BRACES: '${ALSO_UNDEFINED}',
            },
          },
        },
      };

      fs.writeFileSync(
        path.join(extDir, EXTENSIONS_CONFIG_FILENAME),
        JSON.stringify(extensionConfig),
      );

      const extensions = loadExtensions(
        new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      );

      expect(extensions).toHaveLength(1);
      const extension = extensions[0];
      const serverConfig = extension.mcpServers!['test-server'];
      expect(serverConfig.env).toBeDefined();
      expect(serverConfig.env!['MISSING_VAR']).toBe('$UNDEFINED_ENV_VAR');
      expect(serverConfig.env!['MISSING_VAR_BRACES']).toBe('${ALSO_UNDEFINED}');
    });

    it('should skip extensions with invalid JSON and log a warning', () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Good extension
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'good-ext',
        version: '1.0.0',
      });

      // Bad extension
      const badExtDir = path.join(userExtensionsDir, 'bad-ext');
      fs.mkdirSync(badExtDir);
      const badConfigPath = path.join(badExtDir, EXTENSIONS_CONFIG_FILENAME);
      fs.writeFileSync(badConfigPath, '{ "name": "bad-ext"'); // Malformed

      const extensions = loadExtensions(
        new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      );

      expect(extensions).toHaveLength(1);
      expect(extensions[0].name).toBe('good-ext');
      expect(consoleSpy).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining(
          `Warning: Skipping extension in ${badExtDir}: Expected`,
        ),
      );
    });

    it('should skip extensions with missing name and log a warning', () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Good extension
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'good-ext',
        version: '1.0.0',
      });

      // Bad extension
      const badExtDir = path.join(userExtensionsDir, 'bad-ext-no-name');
      fs.mkdirSync(badExtDir);
      const badConfigPath = path.join(badExtDir, EXTENSIONS_CONFIG_FILENAME);
      fs.writeFileSync(badConfigPath, JSON.stringify({ version: '1.0.0' }));

      const extensions = loadExtensions(
        new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      );

      expect(extensions).toHaveLength(1);
      expect(extensions[0].name).toBe('good-ext');
      expect(consoleSpy).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining(
          `Invalid extension config in ${badConfigPath}: missing name or version.`,
        ),
      );
    });

    it('should filter trust out of mcp servers', () => {
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'test-extension',
        version: '1.0.0',
        mcpServers: {
          'test-server': {
            command: 'node',
            args: ['server.js'],
            trust: true,
          },
        },
      });

      const extensions = loadExtensions(
        new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      );
      expect(extensions).toHaveLength(1);
      expect(extensions[0].mcpServers?.['test-server'].trust).toBeUndefined();
    });

    it('should return empty array when admin disables extensions', () => {
      // Create a test extension
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'test-extension',
        version: '1.0.0',
      });

      // Mock loadSettings to return admin.extensions.enabled = false
      mockLoadSettings.mockReturnValueOnce({
        merged: {
          admin: {
            extensions: {
              enabled: false,
            },
          },
        },
      });

      const extensions = loadExtensions(
        new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      );

      expect(extensions).toHaveLength(0);
    });

    it('should load extensions normally when admin.extensions.enabled is true', () => {
      // Create a test extension
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'test-extension',
        version: '1.0.0',
      });

      // The default mock returns admin.extensions.enabled = true
      const extensions = loadExtensions(
        new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      );

      expect(extensions).toHaveLength(1);
      expect(extensions[0].name).toBe('test-extension');
    });

    it('should load extensions normally when admin.extensions.enabled is undefined', () => {
      // Create a test extension
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'test-extension',
        version: '1.0.0',
      });

      // Mock loadSettings without admin.extensions setting (undefined)
      mockLoadSettings.mockReturnValueOnce({
        merged: {},
      });

      const extensions = loadExtensions(
        new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      );

      expect(extensions).toHaveLength(1);
      expect(extensions[0].name).toBe('test-extension');
    });

    it('should throw an error for invalid extension names', () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const badExtDir = createExtension({
        extensionsDir: userExtensionsDir,
        name: 'bad_name',
        version: '1.0.0',
      });

      const extension = loadExtension({
        extensionDir: badExtDir,
        workspaceDir: tempWorkspaceDir,
      });

      expect(extension).toBeNull();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Invalid extension name: "bad_name"'),
      );
    });
  });
});
