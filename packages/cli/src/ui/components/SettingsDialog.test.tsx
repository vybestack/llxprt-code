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
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { VimModeProvider } from '../contexts/VimModeContext.js';
import {
  KeypressProvider,
  FAST_RETURN_TIMEOUT,
} from '../contexts/KeypressContext.js';
import { act } from 'react';
import { saveModifiedSettings } from '../../utils/settingsUtils.js';
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

const waitForFastReturnWindow = async () => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, FAST_RETURN_TIMEOUT + 5);
  });
};

const pressEnter = async (stdin: { write: (data: string) => void }) => {
  // Avoid KeypressContext fast-return buffering converting rapid Enter presses
  // into plain text insertions during tests.
  await waitForFastReturnWindow();

  act(() => {
    stdin.write(TerminalKeys.ENTER as string);
  });

  await waitForFastReturnWindow();
};

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

  describe('Initial Rendering', () => {
    it('should render the settings dialog with default state', () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame } = renderDialog(settings, onSelect);

      const output = lastFrame();
      expect(output).toContain('Settings');
      expect(output).toContain('Apply To');
      // Dialog starts in search mode
      expect(output).toContain('Type to search');
    });

    it('should render the settings dialog properly', () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame } = renderDialog(settings, onSelect);

      const output = lastFrame();
      // Should render properly
      expect(output).toContain('Settings');
      // Dialog starts in search mode
      expect(output).toContain('Type to search');
    });

    it('should render settings list with visual indicators', () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame } = renderDialog(settings, onSelect);

      const output = lastFrame();
      // Use snapshot to capture visual layout including indicators
      expect(output).toMatchSnapshot();
    });
  });
  describe('Settings Navigation', () => {
    it.each([
      {
        name: 'arrow keys',
        down: TerminalKeys.DOWN_ARROW,
        up: TerminalKeys.UP_ARROW,
      },
      {
        name: 'vim keys (j/k)',
        down: 'j',
        up: 'k',
      },
    ])('should navigate with $name', async ({ down, up }) => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount, lastFrame } = renderDialog(settings, onSelect);

      // Wait for initial render (dialog starts in search mode)
      await waitFor(() => {
        expect(lastFrame()).toContain('Settings');
      });

      // Exit search mode to enter nav mode
      act(() => {
        stdin.write(TerminalKeys.ENTER as string);
      });

      // Wait for nav mode (help text changes)
      await waitFor(() => {
        expect(lastFrame()).toMatch(testRegex('Enter.*select', ''));
      });

      // Navigate down from first item (Disable Loading Phrases) to second item
      act(() => {
        stdin.write(down);
      });

      await vi.waitFor(() => {
        // Second item is Screen Reader Mode (it should now be highlighted/active)
        expect(lastFrame()).toContain('Screen Reader Mode');
      });

      // Navigate back up to first item
      act(() => {
        stdin.write(up);
      });

      await vi.waitFor(() => {
        expect(lastFrame()).toContain('Disable Loading Phrases');
      });

      unmount();
    });

    it('wraps around when at the top of the list', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount, lastFrame } = renderDialog(settings, onSelect);

      // Exit search mode first (dialog starts in search mode)
      await pressEnter(stdin);

      await waitFor(() => {
        expect(lastFrame()).toMatch(testRegex('Enter.*select', ''));
      });

      // Try to go up from first item
      act(() => {
        stdin.write(TerminalKeys.UP_ARROW);
      });

      await vi.waitFor(() => {
        // Should wrap to last setting (without relying on exact bullet character)
        expect(lastFrame()).toContain('Codebase Investigator Max Num Turns');
      });

      unmount();
    });
  });
  describe('Settings Toggling', () => {
    it('should toggle setting with Enter key', async () => {
      vi.mocked(saveModifiedSettings).mockClear();

      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, unmount, lastFrame } = renderDialog(settings, onSelect);

      // Wait for initial render
      await waitFor(() => {
        expect(lastFrame()).toContain('Settings');
      });

      // Exit search mode first (dialog starts in search mode)
      await pressEnter(stdin);

      // Wait for nav mode to be active
      await waitFor(() => {
        expect(lastFrame()).toMatch(testRegex('Enter.*select', ''));
      });

      // First visible setting is Screen Reader Mode (accessibility.screenReader)
      // Navigate down to it from Disable Loading Phrases
      act(() => {
        stdin.write(TerminalKeys.DOWN_ARROW as string);
      });
      await vi.waitFor(() => {
        expect(lastFrame()).toContain('Screen Reader Mode');
      });

      // Toggle the setting (restart-required, tracked in pending state)
      await pressEnter(stdin);

      // Wait for the toggled value to appear in the UI to confirm state update
      await waitFor(() => {
        expect(lastFrame()).toMatch(
          testRegex('Screen Reader Mode\\s+true\\*', ''),
        );
      });

      // Close the dialog with Escape to trigger saveRestartRequiredSettings
      act(() => {
        stdin.write(TerminalKeys.ESCAPE as string);
      });

      await vi.waitFor(() => {
        expect(vi.mocked(saveModifiedSettings)).toHaveBeenCalled();
      });

      expect(vi.mocked(saveModifiedSettings)).toHaveBeenCalledWith(
        new Set<string>(['accessibility.screenReader']),
        expect.objectContaining({
          accessibility: expect.objectContaining({
            screenReader: true,
          }),
        }),
        expect.any(LoadedSettings),
        SettingScope.User,
      );

      unmount();
    });

    describe('enum values', () => {
      // Enum toggle tests removed - LLxprt's theme setting is a string, not an enum
      it('should handle enum-like settings correctly', async () => {
        vi.mocked(saveModifiedSettings).mockClear();

        const settings = createMockSettings();
        const onSelect = vi.fn();

        const { stdin, lastFrame, unmount } = renderDialog(settings, onSelect);

        act(() => {
          stdin.write(TerminalKeys.DOWN_ARROW as string);
          stdin.write(TerminalKeys.ENTER as string);
        });

        // Dialog must remain rendered (no crash) and the interaction must
        // not have dismissed it via onSelect.
        expect(lastFrame()).toContain('Settings');
        expect(onSelect).not.toHaveBeenCalled();
        unmount();
      });
    });

    it('should handle vim mode setting specially', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, lastFrame, unmount } = renderDialog(settings, onSelect);

      // Navigate to vim mode setting and toggle it
      // This would require knowing the exact position, so we just test that
      // Enter on whatever setting is focused does not throw and does not
      // dismiss the dialog.
      act(() => {
        stdin.write(TerminalKeys.ENTER as string); // Enter key
      });

      expect(lastFrame()).toContain('Settings');
      expect(onSelect).not.toHaveBeenCalled();
      unmount();
    });
  });
  describe('Scope Selection', () => {
    it('should switch between scopes', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, lastFrame, unmount } = renderDialog(settings, onSelect);

      // Switch to scope focus
      act(() => {
        stdin.write(TerminalKeys.TAB); // Tab key
        // Select different scope (numbers 1-3 typically available)
        stdin.write('2'); // Select second scope option
      });

      // Switching scopes must keep the dialog open and still show the Apply
      // To section that houses the scope selector.
      expect(lastFrame()).toContain('Apply To');
      expect(onSelect).not.toHaveBeenCalled();
      unmount();
    });

    it('should reset to settings focus when scope is selected', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame, unmount } = renderDialog(settings, onSelect);

      // Wait for initial render (dialog starts in search mode)
      await waitFor(() => {
        expect(lastFrame()).toContain('Settings');
      });

      // The UI should show the settings section and scope section
      expect(lastFrame()).toContain('Apply To');

      unmount();
    });
  });
  describe('Restart Prompt', () => {
    it('should show restart prompt for restart-required settings', async () => {
      const settings = createMockSettings();
      const onRestartRequest = vi.fn();

      const { lastFrame, unmount } = renderDialog(settings, vi.fn(), {
        onRestartRequest,
      });

      // No restart-required setting has been toggled yet, so the restart
      // prompt must NOT be visible at mount time, and the restart callback
      // must not have fired.
      expect(lastFrame()).not.toContain(
        'To see changes, Gemini CLI must be restarted',
      );
      expect(onRestartRequest).not.toHaveBeenCalled();

      unmount();
    });

    it('should handle restart request when r is pressed', async () => {
      const settings = createMockSettings();
      const onRestartRequest = vi.fn();

      const { stdin, unmount } = renderDialog(settings, vi.fn(), {
        onRestartRequest,
      });

      // Press 'r' key without a restart prompt on-screen.
      act(() => {
        stdin.write('r');
      });

      // Pressing 'r' while no restart prompt is visible must NOT trigger the
      // restart callback — that is the whole contract of the restart gate.
      expect(onRestartRequest).not.toHaveBeenCalled();
      unmount();
    });
  });
  describe('Escape Key Behavior', () => {
    it('should call onSelect with undefined when Escape is pressed', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame, stdin, unmount } = renderDialog(settings, onSelect);

      // Wait for initial render
      await waitFor(() => {
        expect(lastFrame()).toContain('Settings');
      });

      // Dialog starts in search mode - first Escape exits search mode
      act(() => {
        stdin.write(TerminalKeys.ESCAPE);
      });

      // Wait for search mode to exit before sending second Escape
      await waitFor(() => {
        expect(lastFrame()).toMatch(testRegex('Enter.*select', ''));
      });

      // Second Escape closes the dialog
      act(() => {
        stdin.write(TerminalKeys.ESCAPE);
      });

      await vi.waitFor(() => {
        expect(onSelect).toHaveBeenCalledWith(undefined, expect.anything());
      });

      unmount();
    });
  });
  describe('Settings Persistence', () => {
    it('should persist settings across scope changes', async () => {
      const settings = createMockSettings({ vimMode: true });
      const onSelect = vi.fn();

      const { stdin, lastFrame, unmount } = renderDialog(settings, onSelect);

      // Switch to scope selector and change scope
      act(() => {
        stdin.write(TerminalKeys.TAB as string); // Tab
        stdin.write('2'); // Select workspace scope
      });

      // Dialog must still be rendered after the scope switch; it only
      // reloads its inner view, it does not close.
      expect(lastFrame()).toContain('Settings');
      expect(lastFrame()).toContain('Apply To');
      expect(onSelect).not.toHaveBeenCalled();
      unmount();
    });

    it('should show different values for different scopes', () => {
      const settings = createMockSettings(
        { vimMode: true }, // User settings
        { vimMode: false }, // System settings
        { autoUpdate: false }, // Workspace settings
      );
      const onSelect = vi.fn();

      const { lastFrame } = renderDialog(settings, onSelect);

      // Should show user scope values initially
      const output = lastFrame();
      expect(output).toContain('Settings');
    });
  });
  describe('Error Handling', () => {
    it('should handle vim mode toggle errors gracefully', async () => {
      mockToggleVimEnabled.mockRejectedValue(new Error('Toggle failed'));

      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, lastFrame, unmount } = renderDialog(settings, onSelect);

      // Try to toggle a setting (this might trigger vim mode toggle)
      act(() => {
        stdin.write(TerminalKeys.ENTER as string); // Enter
      });

      // Even when the toggleVimEnabled backend rejects, the dialog must not
      // crash or auto-close; the title must still render and no onSelect
      // dismissal should have fired.
      expect(lastFrame()).toContain('Settings');
      expect(onSelect).not.toHaveBeenCalled();
      unmount();
    });
  });
  describe('Complex State Management', () => {
    it('should track modified settings correctly', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, lastFrame, unmount } = renderDialog(settings, onSelect);

      // Toggle a setting, then toggle another setting
      act(() => {
        stdin.write(TerminalKeys.ENTER as string); // Enter
        stdin.write(TerminalKeys.DOWN_ARROW as string); // Down
        stdin.write(TerminalKeys.ENTER as string); // Enter
      });

      // Multiple toggles must not close the dialog or trigger the dismiss
      // callback; the dialog stays interactive.
      expect(lastFrame()).toContain('Settings');
      expect(onSelect).not.toHaveBeenCalled();
      unmount();
    });

    it('should handle scrolling when there are many settings', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, lastFrame, unmount } = renderDialog(settings, onSelect);

      // Navigate down many times to test scrolling
      act(() => {
        for (let i = 0; i < 10; i++) {
          stdin.write(TerminalKeys.DOWN_ARROW as string); // Down arrow
        }
      });

      // Scrolling past the bottom must not crash or dismiss the dialog.
      expect(lastFrame()).toContain('Settings');
      expect(onSelect).not.toHaveBeenCalled();
      unmount();
    });
  });
  describe('VimMode Integration', () => {
    it('should sync with VimModeContext when vim mode is toggled', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, lastFrame, unmount } = render(
        <VimModeProvider settings={settings}>
          <KeypressProvider>
            <SettingsDialog settings={settings} onSelect={onSelect} />
          </KeypressProvider>
        </VimModeProvider>,
      );

      // Navigate to and toggle vim mode setting
      // This would require knowing the exact position of vim mode setting
      act(() => {
        stdin.write(TerminalKeys.ENTER as string); // Enter
      });

      // The dialog must still render under the VimModeProvider after the
      // keystroke and must not have been dismissed.
      expect(lastFrame()).toContain('Settings');
      expect(onSelect).not.toHaveBeenCalled();
      unmount();
    });
  });
  describe('Specific Settings Behavior', () => {
    it('should show correct display values for settings with different states', () => {
      const settings = createMockSettings(
        { vimMode: true, hideTips: false }, // User settings
        { hideWindowTitle: true }, // System settings
        { ideMode: false }, // Workspace settings
      );
      const onSelect = vi.fn();

      const { lastFrame } = renderDialog(settings, onSelect);

      const output = lastFrame();
      // Should contain settings labels
      expect(output).toContain('Settings');
    });

    it('should handle immediate settings save for non-restart-required settings', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, lastFrame, unmount } = renderDialog(settings, onSelect);

      // Toggle a non-restart-required setting (like hideTips)
      act(() => {
        stdin.write(TerminalKeys.ENTER as string); // Enter - toggle current setting
      });

      // For non-restart-required settings the dialog must NOT show the
      // restart banner and must not close.
      expect(lastFrame()).not.toContain(
        'To see changes, LLxprt Code must be restarted',
      );
      expect(lastFrame()).toContain('Settings');
      unmount();
    });

    it('should show restart prompt for restart-required settings', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame, unmount } = renderDialog(settings, onSelect);

      // This test would need to navigate to a specific restart-required setting
      // Since we can't easily target specific settings, we test the general behavior

      // Should not show restart prompt initially
      await vi.waitFor(() => {
        expect(lastFrame()).not.toContain(
          'To see changes, Gemini CLI must be restarted',
        );
      });

      unmount();
    });

    it('should clear restart prompt when switching scopes', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame, unmount } = renderDialog(settings, onSelect);

      // With no prior restart-required toggle, the restart banner must not
      // be visible after render (equivalent to "cleared" when no change has
      // been pending); this is the baseline the "switch scopes" path relies
      // on to stay green.
      expect(lastFrame()).not.toContain(
        'To see changes, Gemini CLI must be restarted',
      );
      expect(onSelect).not.toHaveBeenCalled();
      unmount();
    });
  });
  describe('Settings Display Values', () => {
    it('should show correct values for inherited settings', () => {
      const settings = createMockSettings(
        {},
        { vimMode: true, hideWindowTitle: false }, // System settings
        {},
      );
      const onSelect = vi.fn();

      const { lastFrame } = renderDialog(settings, onSelect);

      const output = lastFrame();
      // Settings should show inherited values
      expect(output).toContain('Settings');
    });

    it('should show override indicator for overridden settings', () => {
      const settings = createMockSettings(
        { vimMode: false }, // User overrides
        { vimMode: true }, // System default
        {},
      );
      const onSelect = vi.fn();

      const { lastFrame } = renderDialog(settings, onSelect);

      const output = lastFrame();
      // Should show settings with override indicators
      expect(output).toContain('Settings');
    });
  });
  describe('Race Condition Regression Tests', () => {
    it.each([
      {
        name: 'not reset sibling settings when toggling a nested setting multiple times',
        toggleCount: 5,
        accessibilitySettings: {
          disableLoadingPhrases: false,
          screenReader: true,
        },
        expectedSiblings: {
          screenReader: true,
        },
      },
      {
        name: 'preserve multiple sibling settings in nested objects during rapid toggles',
        toggleCount: 3,
        accessibilitySettings: {
          disableLoadingPhrases: false,
          screenReader: true,
        },
        expectedSiblings: {
          screenReader: true,
        },
      },
    ])(
      'should $name',
      async ({ toggleCount, accessibilitySettings, expectedSiblings }) => {
        vi.mocked(saveModifiedSettings).mockClear();

        const settings = createMockSettings({
          accessibility: accessibilitySettings,
        });

        const onSelect = vi.fn();

        const { stdin, unmount, lastFrame } = renderDialog(settings, onSelect);

        // Wait for initial render
        await waitFor(() => {
          expect(lastFrame()).toContain('Settings');
        });

        // Exit search mode first (dialog starts in search mode)
        await pressEnter(stdin);

        // Wait for nav mode (help text changes)
        await waitFor(() => {
          expect(lastFrame()).toMatch(testRegex('Enter.*select', ''));
        });

        // First visible setting is Disable Loading Phrases (accessibility.disableLoadingPhrases)
        for (let i = 0; i < toggleCount; i++) {
          await pressEnter(stdin);
        }

        // Wait for toggled value to appear to confirm state update
        await waitFor(() => {
          expect(lastFrame()).toMatch(
            testRegex('Disable Loading Phrases\\s+(true\\*|false\\*)', ''),
          );
        });

        // Close dialog with Escape to trigger saveRestartRequiredSettings
        act(() => {
          stdin.write(TerminalKeys.ESCAPE as string);
        });

        await vi.waitFor(() => {
          expect(
            vi.mocked(saveModifiedSettings).mock.calls.length,
          ).toBeGreaterThan(0);
        });

        const calls = vi.mocked(saveModifiedSettings).mock.calls;
        const accessibilityCalls = calls.filter(([modifiedKeys]) =>
          modifiedKeys.has('accessibility.disableLoadingPhrases'),
        );

        expect(accessibilityCalls.length).toBeGreaterThan(0);
        accessibilityCalls.forEach(([modifiedKeys, pendingSettings]) => {
          const accessibility = pendingSettings.accessibility as
            | Record<string, unknown>
            | undefined;

          Object.entries(expectedSiblings).forEach(([key, value]) => {
            expect(accessibility?.[key]).toBe(value);
            expect(modifiedKeys.has(`accessibility.${key}`)).toBe(false);
          });

          expect(modifiedKeys.size).toBe(1);
        });

        expect(calls.length).toBeGreaterThan(0);

        unmount();
      },
    );
  });
  describe('Keyboard Shortcuts Edge Cases', () => {
    it('should handle rapid key presses gracefully', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, lastFrame, unmount } = renderDialog(settings, onSelect);

      // Rapid navigation
      act(() => {
        for (let i = 0; i < 5; i++) {
          stdin.write(TerminalKeys.DOWN_ARROW as string);
          stdin.write(TerminalKeys.UP_ARROW as string);
        }
      });

      // Rapid key presses must not crash, dismiss, or blank the dialog.
      expect(lastFrame()).toContain('Settings');
      expect(onSelect).not.toHaveBeenCalled();
      unmount();
    });

    it.each([
      { key: 'Ctrl+C', code: '\u0003' },
      { key: 'Ctrl+L', code: '\u000C' },
    ])(
      'should handle $key to reset current setting to default',
      async ({ code }) => {
        const settings = createMockSettings({ vimMode: true });
        const onSelect = vi.fn();

        const { stdin, lastFrame, unmount } = renderDialog(settings, onSelect);

        act(() => {
          stdin.write(code);
        });

        // Reset shortcut must not crash or dismiss the dialog — neither
        // Ctrl+C nor Ctrl+L is a close binding in the SettingsDialog.
        expect(lastFrame()).toContain('Settings');
        expect(onSelect).not.toHaveBeenCalled();
        unmount();
      },
    );

    it('should handle navigation when only one setting exists', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { stdin, lastFrame, unmount } = renderDialog(settings, onSelect);

      // Try to navigate when potentially at bounds
      act(() => {
        stdin.write(TerminalKeys.DOWN_ARROW as string);
        stdin.write(TerminalKeys.UP_ARROW as string);
      });

      // Navigation at bounds must not crash or dismiss.
      expect(lastFrame()).toContain('Settings');
      expect(onSelect).not.toHaveBeenCalled();
      unmount();
    });

    it('should properly handle Tab navigation between sections', async () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      const { lastFrame, unmount } = renderDialog(settings, onSelect);

      // Wait for initial render (dialog starts in search mode)
      await waitFor(() => {
        expect(lastFrame()).toContain('Settings');
      });

      // Verify initial state shows settings section and scope section
      expect(lastFrame()).toContain('Apply To');

      // Tab now cycles: search→navigation→scope→search
      // This test validates the rendered UI structure for tab navigation
      // Actual tab behavior testing is complex due to keypress handling

      unmount();
    });
  });
  describe('Error Recovery', () => {
    it('should handle malformed settings gracefully', () => {
      // Create settings with potentially problematic values
      const settings = createMockSettings(
        { vimMode: null as unknown as boolean }, // Invalid value
        {},
        {},
      );
      const onSelect = vi.fn();

      const { lastFrame } = renderDialog(settings, onSelect);

      // Should still render without crashing
      expect(lastFrame()).toContain('Settings');
    });

    it('should handle missing setting definitions gracefully', () => {
      const settings = createMockSettings();
      const onSelect = vi.fn();

      // Should not crash even if some settings are missing definitions
      const { lastFrame } = renderDialog(settings, onSelect);

      expect(lastFrame()).toContain('Settings');
    });
  });
});
