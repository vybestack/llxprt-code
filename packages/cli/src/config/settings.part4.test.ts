/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest/globals" />

// Mock 'os' first.
import * as osActual from 'os';
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
  migrateDeprecatedSettings,
} from './settings.js';

const MOCK_WORKSPACE_DIR = '/mock/workspace';
// Use the (mocked) SETTINGS_DIRECTORY_NAME for consistency

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

  describe('loadSettings', () => {
    it('should migrate ui.disableLoadingPhrases false to ui.accessibility.enableLoadingPhrases true', () => {
      const userSettingsContent = {
        ui: {
          disableLoadingPhrases: false,
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH) {
            return JSON.stringify(userSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // Verify migrated value (inverted: disableLoadingPhrases=false → enableLoadingPhrases=true)
      expect(
        (settings.user.settings.ui?.accessibility as Record<string, unknown>)[
          'enableLoadingPhrases'
        ],
      ).toBe(true);
      expect(settings.merged.accessibility?.enableLoadingPhrases).toBe(true);
    });

    it('should preserve existing ui.accessibility.enableLoadingPhrases when ui.disableLoadingPhrases is also present', () => {
      const userSettingsContent = {
        ui: {
          disableLoadingPhrases: true,
          accessibility: {
            enableLoadingPhrases: true,
          },
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH) {
            return JSON.stringify(userSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // The existing enableLoadingPhrases=true should NOT be overwritten by disableLoadingPhrases=true
      expect(
        (settings.user.settings.ui?.accessibility as Record<string, unknown>)[
          'enableLoadingPhrases'
        ],
      ).toBe(true);
      expect(settings.merged.accessibility?.enableLoadingPhrases).toBe(true);
    });

    it('should remove ui.disableLoadingPhrases during cleanup while preserving other ui settings', () => {
      const userSettingsContent = {
        ui: {
          disableLoadingPhrases: true,
          theme: 'dark',
          accessibility: {
            enableLoadingPhrases: false,
          },
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH) {
            return JSON.stringify(userSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // The existing enableLoadingPhrases should be preserved
      expect(
        (settings.user.settings.ui?.accessibility as Record<string, unknown>)[
          'enableLoadingPhrases'
        ],
      ).toBe(false);
      expect(settings.merged.accessibility?.enableLoadingPhrases).toBe(false);
      // Other ui settings should be preserved
      expect(
        (settings.user.settings.ui as Record<string, unknown>)['theme'],
      ).toBe('dark');

      // Now explicitly run cleanup to remove deprecated keys
      migrateDeprecatedSettings(settings, true);

      // The deprecated key should now be removed from ui
      expect(
        (settings.user.settings.ui as Record<string, unknown>)[
          'disableLoadingPhrases'
        ],
      ).toBeUndefined();
      // Other ui settings should still be preserved
      expect(
        (settings.user.settings.ui as Record<string, unknown>)['theme'],
      ).toBe('dark');
      // enableLoadingPhrases should still be preserved
      expect(
        (settings.user.settings.ui?.accessibility as Record<string, unknown>)[
          'enableLoadingPhrases'
        ],
      ).toBe(false);
      expect(settings.merged.accessibility?.enableLoadingPhrases).toBe(false);
    });

    it('should migrate ui.accessibility.disableLoadingPhrases to ui.accessibility.enableLoadingPhrases', () => {
      const userSettingsContent = {
        ui: {
          accessibility: {
            disableLoadingPhrases: true,
          },
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH) {
            return JSON.stringify(userSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // Verify migrated value (inverted: disableLoadingPhrases=true → enableLoadingPhrases=false)
      expect(
        (settings.user.settings.ui?.accessibility as Record<string, unknown>)[
          'enableLoadingPhrases'
        ],
      ).toBe(false);
      expect(settings.merged.accessibility?.enableLoadingPhrases).toBe(false);
    });

    it('should migrate ui.accessibility.disableLoadingPhrases false to ui.accessibility.enableLoadingPhrases true', () => {
      const userSettingsContent = {
        ui: {
          accessibility: {
            disableLoadingPhrases: false,
          },
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH) {
            return JSON.stringify(userSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // Verify migrated value (inverted: disableLoadingPhrases=false → enableLoadingPhrases=true)
      expect(
        (settings.user.settings.ui?.accessibility as Record<string, unknown>)[
          'enableLoadingPhrases'
        ],
      ).toBe(true);
      expect(settings.merged.accessibility?.enableLoadingPhrases).toBe(true);
    });

    it('should prefer ui.accessibility.disableLoadingPhrases over ui.disableLoadingPhrases when both are present', () => {
      const userSettingsContent = {
        ui: {
          disableLoadingPhrases: false,
          accessibility: {
            disableLoadingPhrases: true,
          },
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH) {
            return JSON.stringify(userSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // Nested ui.accessibility.disableLoadingPhrases=true should take priority over ui.disableLoadingPhrases=false
      expect(
        (settings.user.settings.ui?.accessibility as Record<string, unknown>)[
          'enableLoadingPhrases'
        ],
      ).toBe(false);
      expect(settings.merged.accessibility?.enableLoadingPhrases).toBe(false);
    });

    it('should preserve existing ui.accessibility.enableLoadingPhrases when ui.accessibility.disableLoadingPhrases is also present', () => {
      const userSettingsContent = {
        ui: {
          accessibility: {
            disableLoadingPhrases: true,
            enableLoadingPhrases: true,
          },
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH) {
            return JSON.stringify(userSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // Existing enableLoadingPhrases=true should NOT be overwritten
      expect(
        (settings.user.settings.ui?.accessibility as Record<string, unknown>)[
          'enableLoadingPhrases'
        ],
      ).toBe(true);
      expect(settings.merged.accessibility?.enableLoadingPhrases).toBe(true);
    });

    it('should remove ui.accessibility.disableLoadingPhrases during cleanup while preserving other ui settings', () => {
      const userSettingsContent = {
        ui: {
          theme: 'dark',
          accessibility: {
            disableLoadingPhrases: true,
            enableLoadingPhrases: false,
          },
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH) {
            return JSON.stringify(userSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // enableLoadingPhrases should be preserved
      expect(
        (settings.user.settings.ui?.accessibility as Record<string, unknown>)[
          'enableLoadingPhrases'
        ],
      ).toBe(false);
      expect(settings.merged.accessibility?.enableLoadingPhrases).toBe(false);

      // Run cleanup to remove deprecated keys
      migrateDeprecatedSettings(settings, true);

      // The deprecated nested key should now be removed from ui.accessibility
      expect(
        (settings.user.settings.ui?.accessibility as Record<string, unknown>)[
          'disableLoadingPhrases'
        ],
      ).toBeUndefined();
      // Other ui settings should still be preserved
      expect(
        (settings.user.settings.ui as Record<string, unknown>)['theme'],
      ).toBe('dark');
      // enableLoadingPhrases should still be preserved
      expect(
        (settings.user.settings.ui?.accessibility as Record<string, unknown>)[
          'enableLoadingPhrases'
        ],
      ).toBe(false);
      expect(settings.merged.accessibility?.enableLoadingPhrases).toBe(false);
    });

    it('should remove both ui.disableLoadingPhrases and ui.accessibility.disableLoadingPhrases during cleanup', () => {
      const userSettingsContent = {
        ui: {
          disableLoadingPhrases: true,
          theme: 'dark',
          accessibility: {
            disableLoadingPhrases: true,
          },
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH) {
            return JSON.stringify(userSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // Verify migrated value exists
      expect(
        (settings.user.settings.ui?.accessibility as Record<string, unknown>)[
          'enableLoadingPhrases'
        ],
      ).toBe(false);
      expect(settings.merged.accessibility?.enableLoadingPhrases).toBe(false);

      // Run cleanup to remove deprecated keys
      migrateDeprecatedSettings(settings, true);

      // Both deprecated keys should now be removed
      expect(
        (settings.user.settings.ui as Record<string, unknown>)[
          'disableLoadingPhrases'
        ],
      ).toBeUndefined();
      expect(
        (settings.user.settings.ui?.accessibility as Record<string, unknown>)[
          'disableLoadingPhrases'
        ],
      ).toBeUndefined();
      // Other ui settings should still be preserved
      expect(
        (settings.user.settings.ui as Record<string, unknown>)['theme'],
      ).toBe('dark');
      // enableLoadingPhrases should still be preserved
      expect(
        (settings.user.settings.ui?.accessibility as Record<string, unknown>)[
          'enableLoadingPhrases'
        ],
      ).toBe(false);
      expect(settings.merged.accessibility?.enableLoadingPhrases).toBe(false);
    });

    it('should migrate fileFiltering.disableFuzzySearch to fileFiltering.enableFuzzySearch', () => {
      const userSettingsContent = {
        fileFiltering: {
          disableFuzzySearch: true,
        },
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      (fs.readFileSync as Mock).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (p === USER_SETTINGS_PATH) {
            return JSON.stringify(userSettingsContent);
          }
          return '{}';
        },
      );

      const settings = loadSettings(MOCK_WORKSPACE_DIR);

      // Verify migrated value (inverted: disableFuzzySearch=true → enableFuzzySearch=false)
      expect(
        (settings.user.settings.ui?.fileFiltering as Record<string, unknown>)[
          'enableFuzzySearch'
        ],
      ).toBe(false);
      expect(settings.merged.fileFiltering?.enableFuzzySearch).toBe(false);
    });
  });
});
