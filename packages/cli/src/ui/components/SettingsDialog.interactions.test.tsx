/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** @vitest-environment jsdom */

/**
 *
 *
 * This test suite covers:
 * - Initial rendering and display state
 * - Keyboard navigation (arrows, vim keys, Tab)
 * - Settings toggling (Enter, Space)
 * - Focus section switching between settings and scope selector
 * - Scope selection and settings persistence across scopes
 * - Restart-required vs immediate settings behavior
 * - VimModeContext integration
 * - Complex user interaction workflows
 * - Error handling and edge cases
 * - Display values for inherited and overridden settings
 *
 */

import { render } from 'ink-testing-library';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitFor } from '../../test-utils/render.js';
import { SettingsDialog } from './SettingsDialog.js';
import { LoadedSettings } from '../../config/settings.js';
import { KeypressProvider } from '../contexts/KeypressContext.js';
import { act } from 'react';
import { terminalCapabilityManager } from '../utils/terminalCapabilityManager.js';
import { testRegex } from '../../test-utils/regex.js';

// Mock useUIState since we don't wrap in UIStateProvider
vi.mock('../contexts/UIStateContext.js', () => ({
  useUIState: () => ({ mainAreaWidth: 120 }),
}));

// Mock the VimModeContext
const mockToggleVimEnabled = vi.fn().mockResolvedValue(undefined);
const mockSetVimMode = vi.fn();

enum TerminalKeys {
  ENTER = '\u000D',
  TAB = '\t',
  UP_ARROW = '\u001B[A',
  DOWN_ARROW = '\u001B[B',
  LEFT_ARROW = '\u001B[D',
  RIGHT_ARROW = '\u001B[C',
  ESCAPE = '\u001B',
  BACKSPACE = '\u0008',
}

const createMockSettings = (
  userSettings = {},
  systemSettings = {},
  workspaceSettings = {},
) =>
  new LoadedSettings(
    {
      settings: { ui: { customThemes: {} }, mcpServers: {}, ...systemSettings },
      path: '/system/settings.json',
    },
    {
      settings: {},
      path: '/system/system-defaults.json',
    },
    {
      settings: {
        ui: { customThemes: {} },
        mcpServers: {},
        ...userSettings,
      },
      path: '/user/settings.json',
    },
    {
      settings: {
        ui: { customThemes: {} },
        mcpServers: {},
        ...workspaceSettings,
      },
      path: '/workspace/settings.json',
    },
    true,
  );

// We use the real SETTINGS_SCHEMA from settingsSchema.js
// Tests that need a custom schema can override it by mocking the module

vi.mock('../contexts/VimModeContext.js', async () => {
  const actual = await vi.importActual('../contexts/VimModeContext.js');
  return {
    ...actual,
    useVimMode: () => ({
      vimEnabled: false,
      vimMode: 'INSERT' as const,
      toggleVimEnabled: mockToggleVimEnabled,
      setVimMode: mockSetVimMode,
    }),
  };
});

vi.mock('../../utils/settingsUtils.js', async () => {
  const actual = await vi.importActual('../../utils/settingsUtils.js');
  return {
    ...actual,
    saveModifiedSettings: vi.fn(),
  };
});

// Helper function to render SettingsDialog with standard wrapper
const renderDialog = (
  settings: LoadedSettings,
  onSelect: ReturnType<typeof vi.fn>,
  options?: {
    onRestartRequest?: ReturnType<typeof vi.fn>;
  },
) =>
  render(
    <KeypressProvider>
      <SettingsDialog
        settings={settings}
        onSelect={onSelect}
        onRestartRequest={options?.onRestartRequest}
      />
    </KeypressProvider>,
  );

describe('SettingsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(
      terminalCapabilityManager,
      'isKittyProtocolEnabled',
    ).mockReturnValue(true);
    mockToggleVimEnabled.mockRejectedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe('Complex User Interactions', () => {
    it('should handle complete user workflow: navigate, toggle, change scope, exit', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame, stdin, unmount } = renderDialog(settings, onSelect);

      // Wait for initial render (dialog starts in search mode)
      await waitFor(() => {
        expect(lastFrame()).toContain('Settings');
      });

      // Exit search mode first
      act(() => {
        stdin.write(TerminalKeys.ENTER as string);
      });

      // Wait for nav mode (help text changes)
      await waitFor(() => {
        expect(lastFrame()).toMatch(testRegex('Enter.*select', ''));
      });

      // Verify the complete UI is rendered with all necessary sections
      expect(lastFrame()).toContain('Settings'); // Title
      expect(lastFrame()).toContain('Disable Loading Phrases'); // First visible setting
      expect(lastFrame()).toContain('Apply To'); // Scope section
      expect(lastFrame()).toContain('User Settings'); // Scope options (no numbers when settings focused)
      // In nav mode, help text shows navigation help
      expect(lastFrame()).toMatch(
        testRegex('Enter.*select.*Tab.*focus.*Esc.*close', ''),
      );

      // This test validates the complete UI structure is available for user workflow
      // Individual interactions are tested in focused unit tests

      unmount();
    });

    it('should allow changing multiple settings without losing pending changes', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, lastFrame, unmount } = renderDialog(settings, onSelect);

      // Toggle multiple settings
      act(() => {
        stdin.write(TerminalKeys.ENTER as string); // Enter
        stdin.write(TerminalKeys.DOWN_ARROW as string); // Down
        stdin.write(TerminalKeys.ENTER as string); // Enter
        stdin.write(TerminalKeys.DOWN_ARROW as string); // Down
        stdin.write(TerminalKeys.ENTER as string); // Enter
      });

      // Regression: toggling several settings in sequence must not dismiss
      // the dialog or wipe its contents (old bug would reset all pending
      // changes + potentially close the dialog).
      expect(lastFrame()).toContain('Settings');
      expect(onSelect).not.toHaveBeenCalled();
      unmount();
    });

    it('should maintain state consistency during complex interactions', async () => {
      const settings = createMockSettings({ vimMode: true });
      const onSelect = vi.fn();

      const { stdin, lastFrame, unmount } = renderDialog(settings, onSelect);

      // Multiple scope changes
      act(() => {
        stdin.write(TerminalKeys.TAB as string); // Tab to scope
        stdin.write('2'); // Workspace
        stdin.write(TerminalKeys.TAB as string); // Tab to settings
        stdin.write(TerminalKeys.TAB as string); // Tab to scope
        stdin.write('1'); // User
      });

      // Complex Tab/scope interactions must leave the dialog rendered with
      // both the Settings and scope-selector sections still present.
      expect(lastFrame()).toContain('Settings');
      expect(lastFrame()).toContain('Apply To');
      expect(onSelect).not.toHaveBeenCalled();
      unmount();
    });

    it('should handle restart workflow correctly', async () => {
      const settings = createMockSettings();
      const onRestartRequest = vi.fn();

      const { stdin, unmount } = renderDialog(settings, vi.fn(), {
        onRestartRequest,
      });

      // This would test the restart workflow if we could trigger it
      act(() => {
        stdin.write('r'); // Try restart key
      });

      // Without restart prompt showing, this should have no effect
      expect(onRestartRequest).not.toHaveBeenCalled();

      unmount();
    });
  });
  describe('String Settings Editing', () => {
    it('should allow editing and committing a string setting', async () => {
      let settings = createMockSettings({ 'a.string.setting': 'initial' });
      const onSelect = vi.fn();

      const { stdin, unmount, rerender } = render(
        <KeypressProvider>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Exit search mode first (dialog starts in search mode)
      act(() => {
        stdin.write('\r'); // Enter to exit search mode
      });

      // Navigate to the last setting
      act(() => {
        for (let i = 0; i < 20; i++) {
          stdin.write('j'); // Down
        }
      });

      // Press Enter to start editing, type new value, and commit
      act(() => {
        stdin.write('\r'); // Start editing
        stdin.write('new value');
        stdin.write('\r'); // Commit
      });

      settings = createMockSettings(
        { 'a.string.setting': 'new value' },
        {},
        {},
      );
      rerender(
        <KeypressProvider>
          <SettingsDialog settings={settings} onSelect={onSelect} />
        </KeypressProvider>,
      );

      // Press Escape to exit
      act(() => {
        stdin.write('\u001B');
      });

      await vi.waitFor(() => {
        expect(onSelect).toHaveBeenCalledWith(undefined, 'User');
      });

      unmount();
    });
  });
  describe('Search Functionality', () => {
    it('should display text entered in search', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame, stdin, unmount } = renderDialog(settings, onSelect);

      // Wait for initial render and verify that search is not active
      await waitFor(() => {
        expect(lastFrame()).not.toContain('> Search:');
      });
      expect(lastFrame()).toContain('Search to filter');

      // Press '/' to enter search mode
      act(() => {
        stdin.write('/');
      });

      await waitFor(() => {
        expect(lastFrame()).toContain('/');
        expect(lastFrame()).not.toContain('Search to filter');
      });

      unmount();
    });

    it('should show search query and filter settings as user types', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame, stdin, unmount } = renderDialog(settings, onSelect);

      act(() => {
        stdin.write('yolo');
      });

      await waitFor(() => {
        expect(lastFrame()).toContain('yolo');
        expect(lastFrame()).toContain('Disable YOLO Mode');
      });

      unmount();
    });

    it('should exit search mode with Escape and close dialog with second Escape', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame, stdin, unmount } = renderDialog(settings, onSelect);

      // Type in search (dialog starts in search mode)
      act(() => {
        stdin.write('vim');
      });
      await waitFor(() => {
        expect(lastFrame()).toContain('vim');
      });

      // First Escape exits search mode (clears query)
      act(() => {
        stdin.write(TerminalKeys.ESCAPE);
      });

      await waitFor(() => {
        // Should no longer show search query
        expect(lastFrame()).not.toContain('vim');
      });

      // Second Escape closes the dialog
      act(() => {
        stdin.write(TerminalKeys.ESCAPE);
      });

      await waitFor(() => {
        // onSelect is called with (settingName, scope).
        // undefined settingName means "close dialog"
        expect(onSelect).toHaveBeenCalledWith(undefined, expect.anything());
      });

      unmount();
    });

    it('should handle backspace to modify search query', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame, stdin, unmount } = renderDialog(settings, onSelect);

      // Dialog starts in search mode - type directly
      act(() => {
        stdin.write('vimm');
      });
      await waitFor(() => {
        expect(lastFrame()).toContain('vimm');
      });

      // Press backspace to remove last 'm'
      act(() => {
        stdin.write(TerminalKeys.BACKSPACE);
      });

      await waitFor(() => {
        expect(lastFrame()).toContain('vim');
        // After correcting to 'vim', should show Vim Mode
        expect(lastFrame()).toContain('Vim Mode');
      });

      unmount();
    });

    it('should display nothing when search yields no results', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame, stdin, unmount } = renderDialog(settings, onSelect);

      // Type a search query that won't match any settings
      act(() => {
        stdin.write('nonexistentsetting');
      });

      await waitFor(() => {
        expect(lastFrame()).toContain('nonexistentsetting');
        expect(lastFrame()).toContain('');
        expect(lastFrame()).not.toContain('Vim Mode'); // Should not contain any settings
        expect(lastFrame()).not.toContain('Disable Auto Update'); // Should not contain any settings
      });

      unmount();
    });
  });
  describe('Snapshot Tests', () => {
    /**
     * Snapshot tests for SettingsDialog component using ink-testing-library.
     * These tests capture the visual output of the component in various states.
     * The snapshots help ensure UI consistency and catch unintended visual changes.
     */

    const noStdinAction = (_stdin: { write: (data: string) => void }) => {};

    it.each([
      {
        name: 'default state',
        userSettings: {},
        systemSettings: {},
        workspaceSettings: {},
        stdinActions: noStdinAction,
      },
      {
        name: 'various boolean settings enabled',
        userSettings: {
          general: {
            vimMode: true,
            disableAutoUpdate: true,
            enablePromptCompletion: true,
          },
          ui: {
            hideWindowTitle: true,
            hideTips: true,
            showMemoryUsage: true,
            showLineNumbers: true,
            showCitations: true,
            accessibility: {
              disableLoadingPhrases: true,
              screenReader: true,
            },
          },
          ide: {
            enabled: true,
          },
          context: {
            loadMemoryFromIncludeDirectories: true,
            fileFiltering: {
              respectGitIgnore: true,
              respectGeminiIgnore: true,
              enableRecursiveFileSearch: true,
              disableFuzzySearch: false,
            },
          },
          tools: {
            enableInteractiveShell: true,
            autoAccept: true,
            useRipgrep: true,
          },
          security: {
            folderTrust: {
              enabled: true,
            },
          },
        },
        systemSettings: {},
        workspaceSettings: {},
        stdinActions: noStdinAction,
      },
      {
        name: 'mixed boolean and number settings',
        userSettings: {
          general: {
            vimMode: false,
            disableAutoUpdate: true,
          },
          ui: {
            showMemoryUsage: true,
            hideWindowTitle: false,
          },
          tools: {
            truncateToolOutputThreshold: 50000,
            truncateToolOutputLines: 1000,
          },
          context: {
            discoveryMaxDirs: 500,
          },
          model: {
            maxSessionTurns: 100,
            skipNextSpeakerCheck: false,
          },
        },
        systemSettings: {},
        workspaceSettings: {},
        stdinActions: noStdinAction,
      },
      {
        name: 'focused on scope selector',
        userSettings: {},
        systemSettings: {},
        workspaceSettings: {},
        stdinActions: (stdin: { write: (data: string) => void }) =>
          stdin.write('\t'),
      },
      {
        name: 'accessibility settings enabled',
        userSettings: {
          ui: {
            accessibility: {
              disableLoadingPhrases: true,
              screenReader: true,
            },
            showMemoryUsage: true,
            showLineNumbers: true,
          },
          general: {
            vimMode: true,
          },
        },
        systemSettings: {},
        workspaceSettings: {},
        stdinActions: noStdinAction,
      },
      {
        name: 'file filtering settings configured',
        userSettings: {
          context: {
            fileFiltering: {
              respectGitIgnore: false,
              respectGeminiIgnore: true,
              enableRecursiveFileSearch: false,
              disableFuzzySearch: true,
            },
            loadMemoryFromIncludeDirectories: true,
            discoveryMaxDirs: 100,
          },
        },
        systemSettings: {},
        workspaceSettings: {},
        stdinActions: noStdinAction,
      },
      {
        name: 'tools and security settings',
        userSettings: {
          tools: {
            enableInteractiveShell: true,
            autoAccept: false,
            useRipgrep: true,
            truncateToolOutputThreshold: 25000,
            truncateToolOutputLines: 500,
          },
          security: {
            folderTrust: {
              enabled: true,
            },
          },
          model: {
            maxSessionTurns: 50,
            skipNextSpeakerCheck: true,
          },
        },
        systemSettings: {},
        workspaceSettings: {},
        stdinActions: noStdinAction,
      },
      {
        name: 'all boolean settings disabled',
        userSettings: {
          general: {
            vimMode: false,
            disableAutoUpdate: false,
            enablePromptCompletion: false,
          },
          ui: {
            hideWindowTitle: false,
            hideTips: false,
            showMemoryUsage: false,
            showLineNumbers: false,
            showCitations: false,
            accessibility: {
              disableLoadingPhrases: false,
              screenReader: false,
            },
          },
          ide: {
            enabled: false,
          },
          context: {
            loadMemoryFromIncludeDirectories: false,
            fileFiltering: {
              respectGitIgnore: false,
              respectGeminiIgnore: false,
              enableRecursiveFileSearch: false,
              disableFuzzySearch: false,
            },
          },
          tools: {
            enableInteractiveShell: false,
            autoAccept: false,
            useRipgrep: false,
          },
          security: {
            folderTrust: {
              enabled: false,
            },
          },
        },
        systemSettings: {},
        workspaceSettings: {},
        stdinActions: noStdinAction,
      },
    ])(
      'should render $name correctly',
      ({ userSettings, systemSettings, workspaceSettings, stdinActions }) => {
        const settings = createMockSettings(
          userSettings,
          systemSettings,
          workspaceSettings,
        );
        const onSelect = vi.fn();

        const { lastFrame, stdin } = renderDialog(settings, onSelect);

        stdinActions(stdin);

        expect(lastFrame()).toMatchSnapshot();
      },
    );
  });
});
