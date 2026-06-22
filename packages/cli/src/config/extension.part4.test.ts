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
  GEMINI_DIR,
  type GeminiCLIExtension,
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

  describe('performWorkspaceExtensionMigration', () => {
    let workspaceExtensionsDir: string;

    beforeEach(() => {
      workspaceExtensionsDir = path.join(
        tempWorkspaceDir,
        EXTENSIONS_DIRECTORY_NAME,
      );
      fs.mkdirSync(workspaceExtensionsDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(workspaceExtensionsDir, { recursive: true, force: true });
    });

    describe('folder trust', () => {
      it('refuses to install extensions from untrusted folders when user declines trust', async () => {
        vi.mocked(isWorkspaceTrusted).mockReturnValue(false);
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
        vi.mocked(isWorkspaceTrusted).mockReturnValue(false);
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

        const userExtensionsDir = path.join(
          tempHomeDir,
          GEMINI_DIR,
          'extensions',
        );
        expect(fs.readdirSync(userExtensionsDir).length).toBe(0);
      });

      it('does not load any extensions in the workspace config when user declines trust', async () => {
        vi.mocked(isWorkspaceTrusted).mockReturnValue(false);
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
        vi.mocked(isWorkspaceTrusted).mockReturnValue(false);
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
      const extensionsToMigrate: GeminiCLIExtension[] = [
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

      const userExtensionsDir = path.join(
        tempHomeDir,
        GEMINI_DIR,
        'extensions',
      );
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

      const extensions: GeminiCLIExtension[] = [
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

    const getActiveExtensions = (): GeminiCLIExtension[] => {
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
