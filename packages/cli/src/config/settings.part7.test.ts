/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest/globals" />

// Mock 'os' first.
import * as osActual from 'os';
import * as pathActual from 'node:path'; // Import for type info for the mock factory
vi.mock('os', async (importOriginal) => {
  const actualOs = await importOriginal<typeof osActual>();
  return {
    ...actualOs,
    homedir: vi.fn(() => '/mock/home/user'),
    platform: vi.fn(() => 'linux'),
  };
});

// Mock './settings.js' to ensure it uses the mocked 'os.homedir()' for its internal constants.
vi.mock('./settings.js', async (importActual) => {
  const originalModule = await importActual<typeof import('./settings.js')>();
  return {
    __esModule: true, // Ensure correct module shape
    ...originalModule, // Re-export all original members
    // We are relying on originalModule's USER_SETTINGS_PATH being constructed with mocked os.homedir()
  };
});

// Mock trustedFolders
vi.mock('./trustedFolders.js', () => ({
  isWorkspaceTrusted: vi.fn(),
  isFolderTrustEnabled: vi.fn(),
}));

// NOW import everything else, including the (now effectively re-exported) settings.js
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mocked,
  type Mock,
} from 'vitest';
import * as fs from 'fs'; // fs will be mocked separately
import stripJsonComments from 'strip-json-comments'; // Will be mocked separately
import { isWorkspaceTrusted, isFolderTrustEnabled } from './trustedFolders.js';

// These imports will get the versions from the vi.mock('./settings.js', ...) factory.
import {
  loadSettings,
  USER_SETTINGS_PATH,
  SETTINGS_DIRECTORY_NAME,
  getSystemSettingsPath,
} from './settings.js';

const MOCK_WORKSPACE_DIR = '/mock/workspace';
// Use the (mocked) SETTINGS_DIRECTORY_NAME for consistency
const MOCK_WORKSPACE_SETTINGS_PATH = pathActual.join(
  MOCK_WORKSPACE_DIR,
  SETTINGS_DIRECTORY_NAME,
  'settings.json',
);

vi.mock('fs', async (importOriginal) => {
  // Get all the functions from the real 'fs' module
  const actualFs = await importOriginal<typeof fs>();

  return {
    ...actualFs, // Keep all the real functions
    // Now, just override the ones we need for the test
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    realpathSync: (p: string) => p,
  };
});

const mockCoreEvents = vi.hoisted(() => ({
  emitFeedback: vi.fn(),
  emitSettingsChanged: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...actual,
    coreEvents: mockCoreEvents,
  };
});

vi.mock('strip-json-comments', () => ({
  default: vi.fn((content) => content),
}));

describe('Settings Loading and Merging', () => {
  let mockFsExistsSync: Mocked<typeof fs.existsSync>;
  let mockStripJsonComments: Mocked<typeof stripJsonComments>;
  let mockFsMkdirSync: Mocked<typeof fs.mkdirSync>;

  beforeEach(() => {
    vi.resetAllMocks();

    // Set environment variables to override system paths
    process.env.LLXPRT_CODE_SYSTEM_SETTINGS_PATH = '/mock/system/settings.json';
    process.env.LLXPRT_CODE_SYSTEM_DEFAULTS_PATH =
      '/mock/system/system-defaults.json';

    mockFsExistsSync = vi.mocked(fs.existsSync);
    mockFsMkdirSync = vi.mocked(fs.mkdirSync);
    mockStripJsonComments = vi.mocked(stripJsonComments);

    vi.mocked(osActual.homedir).mockReturnValue('/mock/home/user');
    (mockStripJsonComments as unknown as Mock).mockImplementation(
      (jsonString: string) => jsonString,
    );
    (mockFsExistsSync as Mock).mockReturnValue(false);
    (fs.readFileSync as Mock).mockImplementation(
      (p: fs.PathOrFileDescriptor) => {
        // Handle system paths specifically
        if (
          p === '/mock/system/settings.json' ||
          p === '/mock/system/system-defaults.json'
        ) {
          return '{}'; // Return valid empty JSON for system paths
        }
        // Always return valid empty JSON for any path to prevent JSON parsing errors
        // Individual tests can override this mock for specific paths they need
        return '{}';
      },
    );
    (mockFsMkdirSync as Mock).mockImplementation(
      (dir: string, _options?: unknown) => {
        // Mock implementation that validates directory creation
        if (!dir || typeof dir !== 'string') {
          throw new Error('Invalid directory path');
        }
        return dir; // Return the created directory path for verification
      },
    );
    vi.mocked(isWorkspaceTrusted).mockReturnValue(true);
    vi.mocked(isFolderTrustEnabled).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Clean up environment variables
    delete process.env.LLXPRT_CODE_SYSTEM_SETTINGS_PATH;
    delete process.env.LLXPRT_CODE_SYSTEM_DEFAULTS_PATH;
  });

  describe('hooks split merge behavior', () => {
    it('hooksConfig merges fields across user and workspace scopes rather than replacing', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = {
        hooksConfig: {
          enabled: true,
        },
      };
      const workspaceSettingsContent = {
        hooksConfig: {
          notifications: false,
        },
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      expect(settings.merged.hooksConfig).toMatchObject({
        enabled: true,
        notifications: false,
      });
      // Verify both scopes contributed (not replaced wholesale)
      expect(settings.merged.hooksConfig!.enabled).toBe(true);
      expect(settings.merged.hooksConfig!.notifications).toBe(false);
    });

    it('hooks event-map merges by event key across scopes', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userHooks = {
        BeforeTool: [
          {
            matcher: 'ReadFile',
            hooks: [{ type: 'command', command: 'user-before.sh' }],
          },
        ],
      };
      const workspaceHooks = {
        AfterTool: [
          {
            matcher: 'WriteFile',
            hooks: [{ type: 'command', command: 'workspace-after.sh' }],
          },
        ],
      };
      const userSettingsContent = { hooks: userHooks };
      const workspaceSettingsContent = { hooks: workspaceHooks };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // Both event keys should be present in merged hooks
      expect(settings.merged.hooks).toStrictEqual({
        BeforeTool: userHooks.BeforeTool,
        AfterTool: workspaceHooks.AfterTool,
      });
    });

    it('later scope overrides same event key array in hooks', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userHooks = {
        BeforeTool: [
          {
            matcher: 'ReadFile',
            hooks: [{ type: 'command', command: 'user-before.sh' }],
          },
        ],
      };
      const workspaceHooks = {
        BeforeTool: [
          {
            matcher: 'WriteFile',
            hooks: [{ type: 'command', command: 'workspace-before.sh' }],
          },
        ],
      };
      const userSettingsContent = { hooks: userHooks };
      const workspaceSettingsContent = { hooks: workspaceHooks };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // Workspace BeforeTool should replace user BeforeTool
      expect(settings.merged.hooks!.BeforeTool).toStrictEqual(
        workspaceHooks.BeforeTool,
      );
      expect(settings.merged.hooks!.BeforeTool).not.toStrictEqual(
        userHooks.BeforeTool,
      );
    });

    it('hooksConfig preserves all nested keys when workspace overrides only disabled (issue #1802)', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = {
        hooksConfig: {
          enabled: true,
          disabled: ['hookA'],
          notifications: false,
        },
      };
      const workspaceSettingsContent = {
        hooksConfig: {
          disabled: [],
        },
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // User enabled and notifications are preserved; workspace disabled wins
      expect(settings.merged.hooksConfig!.enabled).toBe(true);
      expect(settings.merged.hooksConfig!.notifications).toBe(false);
      expect(settings.merged.hooksConfig!.disabled).toStrictEqual([]);
    });

    it('system override for hooksConfig wins over workspace and user while preserving unrelated keys (issue #1802)', () => {
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const systemSettingsContent = {
        hooksConfig: {
          enabled: true,
        },
      };
      const userSettingsContent = {
        hooksConfig: {
          enabled: true,
          notifications: false,
        },
      };
      const workspaceSettingsContent = {
        hooksConfig: {
          enabled: false,
        },
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === getSystemSettingsPath())
            return JSON.stringify(systemSettingsContent);
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // System enabled=true wins over workspace enabled=false; user notifications=false is preserved
      expect(settings.merged.hooksConfig!.enabled).toBe(true);
      expect(settings.merged.hooksConfig!.notifications).toBe(false);
    });

    it('workspace trust disabled preserves user hooksConfig and hooks, ignoring workspace (issue #1802)', () => {
      vi.mocked(isWorkspaceTrusted).mockReturnValue(false);
      vi.mocked(isFolderTrustEnabled).mockReturnValue(true);
      (mockFsExistsSync as Mock).mockReturnValue(true);
      const userSettingsContent = {
        hooksConfig: { enabled: true },
        hooks: {
          BeforeTool: [
            {
              matcher: 'ReadFile',
              hooks: [{ type: 'command', command: 'user-before.sh' }],
            },
          ],
        },
        folderTrustFeature: true,
        folderTrust: true,
      };
      const workspaceSettingsContent = {
        hooksConfig: { enabled: false, notifications: false },
        hooks: {
          AfterTool: [
            {
              matcher: 'WriteFile',
              hooks: [{ type: 'command', command: 'workspace-after.sh' }],
            },
          ],
        },
      };

      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH)
            return JSON.stringify(userSettingsContent);
          if (p === MOCK_WORKSPACE_SETTINGS_PATH)
            return JSON.stringify(workspaceSettingsContent);
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // User settings are preserved; workspace is ignored
      expect(settings.merged.hooksConfig!.enabled).toBe(true);
      expect(settings.merged.hooksConfig!.notifications).toBe(true); // schema default
      expect(settings.merged.hooks!.BeforeTool).toStrictEqual(
        userSettingsContent.hooks.BeforeTool,
      );
      expect(settings.merged.hooks!.AfterTool).toBeUndefined();
    });
  });
});
