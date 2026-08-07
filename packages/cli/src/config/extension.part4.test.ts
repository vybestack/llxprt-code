/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  vi,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  type Mock,
} from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ExtensionStorage,
  INSTALL_METADATA_FILENAME,
  annotateActiveExtensions,
  disableExtension,
  enableExtension,
  loadExtension,
  loadExtensions,
  performWorkspaceExtensionMigration,
} from './extension.js';
import {
  LLXPRT_CONFIG_DIR,
  type LlxprtExtension,
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

void vi.mock('simple-git', () => ({
  simpleGit: vi.fn((path?: string) => {
    if (path) {
      mockGit.path.mockReturnValue(path);
    }
    return mockGit;
  }),
}));

const mockedOs = { ...(await import('os')) };
void vi.mock('os', () => ({
  ...mockedOs,
  homedir: vi.fn(),
}));

const actual = { ...(await import('./trustedFolders.js')) };
void vi.mock('./trustedFolders.js', () => ({
  ...actual,
  isWorkspaceTrusted: vi.fn(),
}));

const mockLogExtensionEnable = vi.fn();
const mockLogExtensionInstallEvent = vi.fn();
const mockLogExtensionUninstall = vi.fn();
const mockLogExtensionDisable = vi.fn();
const actualActual = { ...(await import('@vybestack/llxprt-code-core')) };
void vi.mock('@vybestack/llxprt-code-core', () => ({
  ...actualActual,

  logExtensionEnable: mockLogExtensionEnable,
  logExtensionInstallEvent: mockLogExtensionInstallEvent,
  logExtensionUninstall: mockLogExtensionUninstall,
  logExtensionDisable: mockLogExtensionDisable,
  ExtensionEnableEvent: vi.fn(),
  ExtensionInstallEvent: vi.fn(),
  ExtensionUninstallEvent: vi.fn(),
  ExtensionDisableEvent: vi.fn(),
}));

const actualActual2 = { ...(await import('child_process')) };
void vi.mock('child_process', () => ({
  ...actualActual2,
  execSync: vi.fn(),
}));

const mockLoadSettings = vi.fn();

void vi.mock('./settings.js', () => ({
  loadSettings: mockLoadSettings,
  SettingScope: {
    User: 'User',
    Workspace: 'Workspace',
  },
}));

// Canonical user-extensions directory name under the data-category dir
// (Storage.getUserExtensionsDir() => <dataHome>/extensions). Tests redirect
// LLXPRT_DATA_HOME to tempHomeDir, so fixtures land at <tempHome>/extensions.
const USER_EXTENSIONS_DIRECTORY_NAME = 'extensions';
// Workspace-local extensions remain under <workspace>/.llxprt/extensions.
const WORKSPACE_EXTENSIONS_DIRECTORY_NAME = path.join(
  LLXPRT_CONFIG_DIR,
  'extensions',
);
// Env keys that redirect Storage category dirs to the temp home.
const ENV_KEYS = [
  'LLXPRT_CONFIG_HOME',
  'LLXPRT_DATA_HOME',
  'LLXPRT_CACHE_HOME',
  'LLXPRT_LOG_HOME',
] as const;
const SAVED_ENV: Record<string, string | undefined> = {};

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
    try {
      for (const key of ENV_KEYS) {
        SAVED_ENV[key] = process.env[key];
        process.env[key] = tempHomeDir;
      }
      userExtensionsDir = path.join(
        tempHomeDir,
        USER_EXTENSIONS_DIRECTORY_NAME,
      );
      fs.mkdirSync(userExtensionsDir, { recursive: true });

      (os.homedir as Mock<typeof os.homedir>).mockReturnValue(tempHomeDir);
      (isWorkspaceTrusted as Mock<typeof isWorkspaceTrusted>).mockReturnValue(
        true,
      );
      vi.spyOn(process, 'cwd').mockReturnValue(tempWorkspaceDir);
      (execSync as Mock<typeof execSync>).mockClear();
      Object.values(mockGit).forEach((fn) => fn.mockReset());
      mockLogExtensionInstallEvent.mockReset();
      mockLogExtensionUninstall.mockReset();
      mockLogExtensionEnable.mockReset();
      mockLogExtensionDisable.mockReset();
      (
        ExtensionUninstallEvent as unknown as Mock<
          (...args: never[]) => unknown
        >
      ).mockClear();
      (
        ExtensionDisableEvent as unknown as Mock<(...args: never[]) => unknown>
      ).mockClear();
      (
        ExtensionEnableEvent as unknown as Mock<(...args: never[]) => unknown>
      ).mockClear();
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
    } catch (error) {
      for (const key of ENV_KEYS) {
        if (SAVED_ENV[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = SAVED_ENV[key];
        }
      }
      throw error;
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (SAVED_ENV[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = SAVED_ENV[key];
      }
    }
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
    fs.rmSync(tempWorkspaceDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('performWorkspaceExtensionMigration', () => {
    let workspaceExtensionsDir: string;

    beforeEach(() => {
      workspaceExtensionsDir = path.join(
        tempWorkspaceDir,
        WORKSPACE_EXTENSIONS_DIRECTORY_NAME,
      );
      fs.mkdirSync(workspaceExtensionsDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(workspaceExtensionsDir, { recursive: true, force: true });
    });

    describe('folder trust', () => {
      it('refuses to install extensions from untrusted folders when user declines trust', async () => {
        (isWorkspaceTrusted as Mock<typeof isWorkspaceTrusted>).mockReturnValue(
          false,
        );
        const ext1Path = createExtension({
          extensionsDir: workspaceExtensionsDir,
          name: 'ext1',
          version: '1.0.0',
        });

        const failed = await performWorkspaceExtensionMigration(
          [
            loadExtension({
              extensionDir: ext1Path,
              workspaceDir: tempWorkspaceDir,
            })!,
          ],
          async () => false, // User declines to trust workspace
        );

        expect(failed).toStrictEqual(['ext1']);
      });

      it('does not copy extensions to the user dir when user declines trust', async () => {
        (isWorkspaceTrusted as Mock<typeof isWorkspaceTrusted>).mockReturnValue(
          false,
        );
        const ext1Path = createExtension({
          extensionsDir: workspaceExtensionsDir,
          name: 'ext1',
          version: '1.0.0',
        });

        await performWorkspaceExtensionMigration(
          [
            loadExtension({
              extensionDir: ext1Path,
              workspaceDir: tempWorkspaceDir,
            })!,
          ],
          async (_) => false, // User declines to trust workspace
        );

        const userExtensionsDir = path.join(tempHomeDir, 'extensions');
        expect(fs.readdirSync(userExtensionsDir).length).toBe(0);
      });

      it('does not load any extensions in the workspace config when user declines trust', async () => {
        (isWorkspaceTrusted as Mock<typeof isWorkspaceTrusted>).mockReturnValue(
          false,
        );
        const ext1Path = createExtension({
          extensionsDir: workspaceExtensionsDir,
          name: 'ext1',
          version: '1.0.0',
        });

        await performWorkspaceExtensionMigration(
          [
            loadExtension({
              extensionDir: ext1Path,
              workspaceDir: tempWorkspaceDir,
            })!,
          ],
          async (_) => false, // User declines to trust workspace
        );
        const extensions = loadExtensions(
          new ExtensionEnablementManager(
            ExtensionStorage.getUserExtensionsDir(),
          ),
        );

        expect(extensions).toStrictEqual([]);
      });

      it('allows extension install when user approves trust prompt', async () => {
        (isWorkspaceTrusted as Mock<typeof isWorkspaceTrusted>).mockReturnValue(
          false,
        );
        const ext1Path = createExtension({
          extensionsDir: workspaceExtensionsDir,
          name: 'ext1',
          version: '1.0.0',
        });

        const failed = await performWorkspaceExtensionMigration(
          [
            loadExtension({
              extensionDir: ext1Path,
              workspaceDir: tempWorkspaceDir,
            })!,
          ],
          async () => true, // User approves trust prompt
        );

        // Extension should install successfully when user approves
        expect(failed).toStrictEqual([]);
      });
    });

    it('should install the extensions in the user directory', async () => {
      const ext1Path = createExtension({
        extensionsDir: workspaceExtensionsDir,
        name: 'ext1',
        version: '1.0.0',
      });
      const ext2Path = createExtension({
        extensionsDir: workspaceExtensionsDir,
        name: 'ext2',
        version: '1.0.0',
      });
      const extensionsToMigrate: LlxprtExtension[] = [
        loadExtension({
          extensionDir: ext1Path,
          workspaceDir: tempWorkspaceDir,
        })!,
        loadExtension({
          extensionDir: ext2Path,
          workspaceDir: tempWorkspaceDir,
        })!,
      ];
      const failed = await performWorkspaceExtensionMigration(
        extensionsToMigrate,
        async (_) => true,
      );

      expect(failed).toStrictEqual([]);

      const userExtensionsDir = path.join(tempHomeDir, 'extensions');
      const userExt1Path = path.join(userExtensionsDir, 'ext1');
      const extensions = loadExtensions(
        new ExtensionEnablementManager(ExtensionStorage.getUserExtensionsDir()),
      );

      expect(extensions).toHaveLength(2);
      const metadataPath = path.join(userExt1Path, INSTALL_METADATA_FILENAME);
      expect(fs.existsSync(metadataPath)).toBe(true);
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      expect(metadata).toStrictEqual({
        source: ext1Path,
        type: 'local',
      });
    });

    it('should return the names of failed installations', async () => {
      const ext1Path = createExtension({
        extensionsDir: workspaceExtensionsDir,
        name: 'ext1',
        version: '1.0.0',
      });

      const extensions: LlxprtExtension[] = [
        loadExtension({
          extensionDir: ext1Path,
          workspaceDir: tempWorkspaceDir,
        })!,
        {
          path: '/ext/path/1',
          name: 'ext2',
          version: '1.0.0',
          contextFiles: [],
          isActive: true,
        },
      ];

      const failed = await performWorkspaceExtensionMigration(
        extensions,
        async (_) => true,
      );
      expect(failed).toStrictEqual(['ext2']);
    });
  });

  describe('disableExtension', () => {
    it('should disable an extension at the user scope', () => {
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'my-extension',
        version: '1.0.0',
      });

      disableExtension('my-extension', SettingScope.User);
      expect(
        isEnabled({
          name: 'my-extension',
          configDir: userExtensionsDir,
          enabledForPath: tempWorkspaceDir,
        }),
      ).toBe(false);
    });

    it('should disable an extension at the workspace scope', () => {
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'my-extension',
        version: '1.0.0',
      });

      disableExtension(
        'my-extension',
        SettingScope.Workspace,
        tempWorkspaceDir,
      );
      expect(
        isEnabled({
          name: 'my-extension',
          configDir: userExtensionsDir,
          enabledForPath: tempHomeDir,
        }),
      ).toBe(true);
      expect(
        isEnabled({
          name: 'my-extension',
          configDir: userExtensionsDir,
          enabledForPath: tempWorkspaceDir,
        }),
      ).toBe(false);
    });

    it('should handle disabling the same extension twice', () => {
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'my-extension',
        version: '1.0.0',
      });

      disableExtension('my-extension', SettingScope.User);
      disableExtension('my-extension', SettingScope.User);
      expect(
        isEnabled({
          name: 'my-extension',
          configDir: userExtensionsDir,
          enabledForPath: tempWorkspaceDir,
        }),
      ).toBe(false);
    });

    it('should throw an error if you request system scope', () => {
      expect(() =>
        disableExtension('my-extension', SettingScope.System),
      ).toThrow('System and SystemDefaults scopes are not supported.');
    });

    it('should not emit telemetry when disabling', () => {
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'ext1',
        version: '1.0.0',
      });

      disableExtension('ext1', SettingScope.Workspace);

      expect(mockLogExtensionDisable).not.toHaveBeenCalled();
      expect(ExtensionDisableEvent).not.toHaveBeenCalled();
    });
  });

  describe('enableExtension', () => {
    afterAll(() => {
      vi.restoreAllMocks();
    });

    const getActiveExtensions = (): LlxprtExtension[] => {
      const manager = new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
      );
      const extensions = loadExtensions(manager);
      const activeExtensions = annotateActiveExtensions(
        extensions,
        tempWorkspaceDir,
        manager,
      );
      return activeExtensions.filter((e) => e.isActive);
    };

    it('should enable an extension at the user scope', () => {
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'ext1',
        version: '1.0.0',
      });
      disableExtension('ext1', SettingScope.User);
      let activeExtensions = getActiveExtensions();
      expect(activeExtensions).toHaveLength(0);

      enableExtension('ext1', SettingScope.User);
      activeExtensions = getActiveExtensions();
      expect(activeExtensions).toHaveLength(1);
      expect(activeExtensions[0].name).toBe('ext1');
    });

    it('should enable an extension at the workspace scope', () => {
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'ext1',
        version: '1.0.0',
      });
      disableExtension('ext1', SettingScope.Workspace);
      let activeExtensions = getActiveExtensions();
      expect(activeExtensions).toHaveLength(0);

      enableExtension('ext1', SettingScope.Workspace);
      activeExtensions = getActiveExtensions();
      expect(activeExtensions).toHaveLength(1);
      expect(activeExtensions[0].name).toBe('ext1');
    });

    it('should not emit telemetry when enabling', () => {
      createExtension({
        extensionsDir: userExtensionsDir,
        name: 'ext1',
        version: '1.0.0',
      });
      disableExtension('ext1', SettingScope.Workspace);
      enableExtension('ext1', SettingScope.Workspace);

      expect(mockLogExtensionEnable).not.toHaveBeenCalled();
      expect(ExtensionEnableEvent).not.toHaveBeenCalled();
    });
  });
  function isEnabled(options: {
    name: string;
    configDir: string;
    enabledForPath: string;
  }): boolean {
    const manager = new ExtensionEnablementManager(options.configDir);
    return manager.isEnabled(options.name, options.enabledForPath);
  }
});
