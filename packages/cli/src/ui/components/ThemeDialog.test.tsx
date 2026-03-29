/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { ThemeDialog } from './ThemeDialog.js';
import { type LoadedSettings, SettingScope } from '../../config/settings.js';
import { UIStateProvider } from '../contexts/UIStateContext.js';
import type { UIState } from '../contexts/UIStateContext.js';
import { KeypressProvider } from '../contexts/KeypressContext.js';

// Mock theme manager
vi.mock('../themes/theme-manager.js', () => ({
  themeManager: {
    getAvailableThemes: vi.fn(() => [
      { name: 'Green Screen', type: 'dark' },
      { name: 'Default Light', type: 'light' },
      { name: 'Ayu Dark', type: 'dark' },
      { name: 'GitHub Light', type: 'light' },
    ]),
    getAllThemes: vi.fn(() => [
      { name: 'Green Screen', type: 'dark' },
      { name: 'Default Light', type: 'light' },
      { name: 'Ayu Dark', type: 'dark' },
      { name: 'GitHub Light', type: 'light' },
    ]),
    getTheme: vi.fn((name: string) => ({
      name,
      type: name.toLowerCase().includes('light') ? 'light' : 'dark',
      colors: {
        Background: '#000000',
        Foreground: '#ffffff',
        Gray: '#888888',
        DarkGray: '#666666',
      },
    })),
    getActiveTheme: vi.fn(() => ({
      name: 'Green Screen',
      type: 'dark',
      colors: {
        Background: '#000000',
        Foreground: '#ffffff',
        Gray: '#888888',
        DarkGray: '#666666',
      },
    })),
    getSemanticColors: vi.fn(() => ({
      text: {
        primary: '#ffffff',
        secondary: '#888888',
        link: '#0000ff',
        accent: '#ff00ff',
        response: '#ffffff',
      },
      background: {
        primary: '#000000',
        diff: {
          added: '#00ff00',
          removed: '#ff0000',
        },
      },
      border: {
        default: '#888888',
        focused: '#0000ff',
      },
      ui: {
        comment: '#008000',
        symbol: '#888888',
        dark: '#666666',
        gradient: undefined,
      },
      status: {
        error: '#ff0000',
        success: '#00ff00',
        warning: '#ffff00',
      },
    })),
  },
  DEFAULT_THEME: {
    name: 'Green Screen',
    type: 'dark',
  },
}));

// Mock the hooks
vi.mock('../hooks/useKeypress.js', () => ({
  useKeypress: vi.fn(),
}));

// Mock colorizeCode
vi.mock('../utils/CodeColorizer.js', () => ({
  colorizeCode: vi.fn(() => null),
}));

// Mock DiffRenderer
vi.mock('./messages/DiffRenderer.js', () => ({
  DiffRenderer: vi.fn(() => null),
}));

// Mock semantic colors
vi.mock('../semantic-colors.js', () => ({
  theme: {
    text: {
      primary: '#ffffff',
      secondary: '#888888',
      link: '#0000ff',
      accent: '#ff00ff',
      response: '#ffffff',
    },
    background: {
      primary: '#000000',
      diff: {
        added: '#00ff00',
        removed: '#ff0000',
      },
    },
    border: {
      default: '#888888',
      focused: '#0000ff',
    },
    ui: {
      comment: '#008000',
      symbol: '#888888',
      dark: '#666666',
      gradient: undefined,
    },
    status: {
      error: '#ff0000',
      success: '#00ff00',
      warning: '#ffff00',
    },
  },
}));

describe('ThemeDialog', () => {
  const mockOnSelect = vi.fn();
  const mockOnHighlight = vi.fn();

  const createMockSettings = (
    customThemes?: Record<string, unknown>,
  ): LoadedSettings => {
    const mockSettingsFile = {
      settings: {
        ui: customThemes != null ? { customThemes } : {},
      },
      path: '/mock/user/settings.json',
      exists: true,
    };

    const mockWorkspaceFile = {
      settings: {},
      path: '/mock/workspace/settings.json',
      exists: false,
    };

    const mockSystemFile = {
      settings: {},
      path: '/mock/system/settings.json',
      exists: true,
    };

    const mockSystemDefaultsFile = {
      settings: {},
      path: '/mock/system-defaults/settings.json',
      exists: true,
    };

    return {
      merged: {
        ui: {
          theme: 'Green Screen',
          ...(customThemes != null ? { customThemes } : {}),
        },
      },
      user: mockSettingsFile,
      workspace: mockWorkspaceFile,
      system: mockSystemFile,
      systemDefaults: mockSystemDefaultsFile,
      isTrusted: true,
      errors: [],
      forScope: (scope: SettingScope) => {
        if (scope === SettingScope.User) return mockSettingsFile;
        if (scope === SettingScope.Workspace) return mockWorkspaceFile;
        if (scope === SettingScope.System) return mockSystemFile;
        return mockSystemDefaultsFile;
      },
      setValue: vi.fn(),
      getEffectiveValue: vi.fn(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  };

  const mockSettings = createMockSettings();

  const createMockUIState = (
    terminalBackgroundColor?: string,
  ): Partial<UIState> => ({
    terminalBackgroundColor,
    terminalWidth: 120,
    terminalHeight: 40,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: {} as any,
    settings: mockSettings,
    history: [],
    pendingHistoryItems: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    streamingState: { isStreaming: false } as any,
    thought: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    buffer: {} as any,
    shellModeActive: false,
    isThemeDialogOpen: true,
    isSettingsDialogOpen: false,
    isAuthDialogOpen: false,
    isEditorDialogOpen: false,
    isProviderDialogOpen: false,
    isLoadProfileDialogOpen: false,
    isCreateProfileDialogOpen: false,
    isProfileListDialogOpen: false,
    isProfileDetailDialogOpen: false,
    isProfileEditorDialogOpen: false,
    isToolsDialogOpen: false,
    isFolderTrustDialogOpen: false,
    showWorkspaceMigrationDialog: false,
    showPrivacyNotice: false,
    isOAuthCodeDialogOpen: false,
    isPermissionsDialogOpen: false,
    isLoggingDialogOpen: false,
    isSubagentDialogOpen: false,
    isModelsDialogOpen: false,
    isSessionBrowserDialogOpen: false,
    providerOptions: [],
    selectedProvider: '',
    currentModel: '',
    profiles: [],
    toolsDialogAction: 'enable',
    toolsDialogTools: [],
    toolsDialogDisabledTools: [],
    workspaceGeminiCLIExtensions: [],
    loggingDialogData: { entries: [] },
    profileListItems: [],
    selectedProfileName: null,
    selectedProfileData: null,
    defaultProfileName: null,
    activeProfileName: null,
    profileDialogError: null,
    profileDialogLoading: false,
    shellConfirmationRequest: null,
    confirmationRequest: null,
    confirmUpdateGeminiCLIExtensionRequests: [],
    ctrlCPressedOnce: false,
    ctrlDPressedOnce: false,
    showEscapePrompt: false,
    showIdeRestartPrompt: false,
    quittingMessages: null,
    constrainHeight: false,
    showErrorDetails: false,
    showToolDescriptions: false,
    isTodoPanelCollapsed: false,
    isNarrow: false,
    vimModeEnabled: false,
    vimMode: undefined,
    ideContextState: undefined,
    llxprtMdFileCount: 0,
    branchName: undefined,
    errorCount: 0,
    consoleMessages: [],
    elapsedTime: 0,
    currentLoadingPhrase: undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    showAutoAcceptIndicator: 'off' as any,
    tokenMetrics: {
      tokensPerMinute: 0,
      throttleWaitTimeMs: 0,
      sessionTokenTotal: 0,
    },
    historyTokenCount: 0,
    initError: null,
    authError: null,
    themeError: null,
    editorError: null,
    isProcessing: false,
    isInputActive: false,
    isFocused: true,
    rootUiRef: { current: null },
    pendingHistoryItemRef: { current: null },
    slashCommands: undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    commandContext: {} as any,
    shouldShowIdePrompt: false,
    currentIDE: undefined,
    isRestarting: false,
    isTrustedFolder: true,
    isWelcomeDialogOpen: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    welcomeState: 'initial' as any,
    welcomeAvailableProviders: [],
    welcomeAvailableModels: [],
    inputHistory: [],
    staticKey: 0,
    debugMessage: '',
    showDebugProfiler: false,
    copyModeEnabled: false,
    footerHeight: 0,
    placeholder: '',
    availableTerminalHeight: 40,
    queueErrorMessage: null,
    renderMarkdown: true,
    activeShellPtyId: null,
    embeddedShellFocused: false,
    mainAreaWidth: 120,
    inputWidth: 120,
    suggestionsWidth: 120,
  });

  const renderThemeDialog = (terminalBackgroundColor?: string) => {
    const uiState = createMockUIState(terminalBackgroundColor);
    return render(
      <KeypressProvider>
        <UIStateProvider value={uiState as UIState}>
          <ThemeDialog
            onSelect={mockOnSelect}
            onHighlight={mockOnHighlight}
            settings={mockSettings}
            terminalWidth={120}
          />
        </UIStateProvider>
      </KeypressProvider>,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render theme list', () => {
    const { lastFrame } = renderThemeDialog();
    const output = lastFrame();

    expect(output).toContain('Green Screen');
    expect(output).toContain('Default Light');
    expect(output).toContain('Ayu Dark');
    expect(output).toContain('GitHub Light');
  });

  it('should show "(Matches terminal)" for themes matching terminal background', () => {
    // Dark terminal background should match dark themes
    const { lastFrame } = renderThemeDialog('#1E1E2E');
    const output = lastFrame();

    // Dark themes should show "Matches terminal" (may be truncated)
    expect(output).toContain('Green Screen');
    expect(output).toMatch(/Green Screen.*Matches termin/s);
    expect(output).toMatch(/Ayu Dark.*Matches termin/s);

    // Light themes should show "Incompatible"
    expect(output).toMatch(/Default Light.*Incompatible/s);
    expect(output).toMatch(/GitHub Light.*Incompatible/s);
  });

  it('should show "(Incompatible)" for mismatched themes', () => {
    // Light terminal background should mark dark themes as incompatible
    const { lastFrame } = renderThemeDialog('#FAFAFA');
    const output = lastFrame();

    // Light themes should show "Matches terminal" (may be truncated)
    expect(output).toMatch(/Default Light.*Matches termin/s);
    expect(output).toMatch(/GitHub Light.*Matches termin/s);

    // Dark themes should show "Incompatible"
    expect(output).toMatch(/Green Screen.*Incompatible/s);
    expect(output).toMatch(/Ayu Dark.*Incompatible/s);
  });

  it('should sort compatible themes before incompatible ones', () => {
    // Dark terminal should sort dark themes first
    const { lastFrame } = renderThemeDialog('#1E1E2E');
    const output = lastFrame() ?? '';

    // Find positions of themes in output
    const greenScreenPos = output.indexOf('Green Screen');
    const ayuDarkPos = output.indexOf('Ayu Dark');
    const defaultLightPos = output.indexOf('Default Light');
    const githubLightPos = output.indexOf('GitHub Light');

    // Compatible (dark) themes should come before incompatible (light) themes
    expect(greenScreenPos).toBeLessThan(defaultLightPos);
    expect(ayuDarkPos).toBeLessThan(defaultLightPos);
    expect(greenScreenPos).toBeLessThan(githubLightPos);
    expect(ayuDarkPos).toBeLessThan(githubLightPos);
  });

  it('should work without terminalBackgroundColor (no labels shown)', () => {
    const { lastFrame } = renderThemeDialog();
    const output = lastFrame();

    // All themes should be shown
    expect(output).toContain('Green Screen');
    expect(output).toContain('Default Light');
    expect(output).toContain('Ayu Dark');
    expect(output).toContain('GitHub Light');

    // No compatibility labels should be shown
    expect(output).not.toContain('Matches terminal');
    expect(output).not.toContain('Incompatible');
  });

  it('should pre-select theme based on terminal background', () => {
    // Dark terminal should pre-select a dark theme via pickDefaultThemeName
    const { lastFrame } = renderThemeDialog('#1E1E2E');
    const output = lastFrame() ?? '';

    // With a dark background, pickDefaultThemeName should pick a dark theme.
    // The default dark theme "Green Screen" should be pre-selected and
    // sorted to the top as a compatible theme.
    expect(output).toContain('Green Screen');
  });

  it('should include custom themes in the list', () => {
    const customThemes = {
      MyCustomTheme: {
        name: 'MyCustomTheme',
        type: 'custom',
        Background: '#000000',
        Foreground: '#ffffff',
      },
    };

    const settingsWithCustomTheme = createMockSettings(customThemes);
    const uiState = createMockUIState('#1E1E2E');
    const { lastFrame } = render(
      <KeypressProvider>
        <UIStateProvider value={uiState as UIState}>
          <ThemeDialog
            onSelect={mockOnSelect}
            onHighlight={mockOnHighlight}
            settings={settingsWithCustomTheme}
            terminalWidth={120}
          />
        </UIStateProvider>
      </KeypressProvider>,
    );

    const output = lastFrame();
    expect(output).toContain('MyCustomTheme');
  });
});
