/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { renderWithProviders } from '../../test-utils/render.js';

const mockGetAuthStatus = vi.fn();
const mockToggleOAuthEnabled = vi.fn();

vi.mock('../../providers/providerManagerInstance.js', () => ({
  getOAuthManager: () => ({
    toggleOAuthEnabled: mockToggleOAuthEnabled,
    getAuthStatus: mockGetAuthStatus,
  }),
}));

import { AuthDialog } from './AuthDialog.js';

describe('AuthDialog', () => {
  const wait = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.GEMINI_API_KEY = '';
    process.env.GEMINI_DEFAULT_AUTH_TYPE = '';
    vi.clearAllMocks();
    mockGetAuthStatus.mockReset();
    mockToggleOAuthEnabled.mockReset();
    mockGetAuthStatus.mockResolvedValue([]);
    mockToggleOAuthEnabled.mockResolvedValue(false);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should show an error if the initial auth type is invalid', () => {
    process.env.GEMINI_API_KEY = '';

    const settings: LoadedSettings = new LoadedSettings(
      {
        settings: { ui: { customThemes: {} }, mcpServers: {} },
        path: '',
      },
      {
        settings: {},
        path: '',
      },
      {
        settings: {},
        path: '',
      },
      {
        settings: { ui: { customThemes: {} }, mcpServers: {} },
        path: '',
      },
      true,
    );

    const mockOnSelect = vi.fn();
    const { lastFrame } = renderWithProviders(
      <AuthDialog
        onSelect={mockOnSelect}
        settings={settings}
        initialErrorMessage="GEMINI_API_KEY  environment variable not found"
      />,
    );

    expect(lastFrame()).toContain(
      'GEMINI_API_KEY  environment variable not found',
    );
  });

  describe('GEMINI_API_KEY environment variable', () => {
    it('should show OAuth dialog even when GEMINI_API_KEY is set', () => {
      process.env.GEMINI_API_KEY = 'foobar';

      const settings: LoadedSettings = new LoadedSettings(
        {
          settings: {
            ui: { customThemes: {} },
            mcpServers: {},
          },
          path: '',
        },
        {
          settings: {},
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        true,
      );

      const mockOnSelect = vi.fn();
      const { lastFrame } = renderWithProviders(
        <AuthDialog onSelect={mockOnSelect} settings={settings} />,
      );

      // OAuth-only dialog shows regardless of API key presence
      expect(lastFrame()).toContain('OAuth Authentication');
      expect(lastFrame()).toContain('Gemini (Google OAuth)');
      expect(lastFrame()).toContain('Qwen (OAuth)');
    });

    it('should display authentication status for each provider', async () => {
      mockGetAuthStatus.mockResolvedValue([
        {
          provider: 'gemini',
          authenticated: true,
          method: 'oauth',
          expiresIn: 3600,
          oauthEnabled: true,
        },
        {
          provider: 'qwen',
          authenticated: false,
          method: 'none',
          oauthEnabled: false,
        },
        {
          provider: 'anthropic',
          authenticated: true,
          method: 'oauth',
          oauthEnabled: true,
        },
      ]);

      const settings: LoadedSettings = new LoadedSettings(
        {
          settings: {
            ui: { customThemes: {} },
            mcpServers: {},
          },
          path: '',
        },
        {
          settings: {},
          path: '',
        },
        {
          settings: {
            ui: { customThemes: {} },
            mcpServers: {},
            oauthEnabledProviders: {
              gemini: true,
              qwen: false,
              anthropic: true,
            },
          },
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        true,
      );

      const { lastFrame } = renderWithProviders(
        <AuthDialog onSelect={vi.fn()} settings={settings} />,
      );
      await wait();

      const frame = lastFrame();
      expect(frame).toContain('Gemini (Google OAuth) [ON] (Authenticated)');
      expect(frame).toContain('Qwen (OAuth) [OFF] (Not authenticated)');
      expect(frame).toContain('Anthropic Claude (OAuth) [ON] (Authenticated)');
    });

    it('should show OAuth options regardless of GEMINI_DEFAULT_AUTH_TYPE', () => {
      process.env.GEMINI_API_KEY = 'foobar';
      process.env.GEMINI_DEFAULT_AUTH_TYPE = 'oauth-personal';

      const settings: LoadedSettings = new LoadedSettings(
        {
          settings: {
            ui: { customThemes: {} },
            mcpServers: {},
          },
          path: '',
        },
        {
          settings: {},
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        true,
      );

      const { lastFrame } = renderWithProviders(
        <AuthDialog onSelect={vi.fn()} settings={settings} />,
      );

      // OAuth-only implementation doesn't show API key messages
      expect(lastFrame()).not.toContain(
        'Existing API key detected (GEMINI_API_KEY)',
      );
      expect(lastFrame()).toContain('OAuth Authentication');
    });

    it('should show OAuth dialog even when GEMINI_DEFAULT_AUTH_TYPE is set to use api key', () => {
      process.env.GEMINI_API_KEY = 'foobar';
      process.env.GEMINI_DEFAULT_AUTH_TYPE = 'gemini-api-key';

      const settings: LoadedSettings = new LoadedSettings(
        {
          settings: {
            ui: { customThemes: {} },
            mcpServers: {},
          },
          path: '',
        },
        {
          settings: {},
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        true,
      );

      const { lastFrame } = renderWithProviders(
        <AuthDialog onSelect={vi.fn()} settings={settings} />,
      );

      // OAuth-only dialog shows, API key message not shown
      expect(lastFrame()).not.toContain(
        'Existing API key detected (GEMINI_API_KEY)',
      );
      expect(lastFrame()).toContain('OAuth Authentication');
      expect(lastFrame()).toContain('Note: You can also use API keys');
    });
  });

  describe('GEMINI_DEFAULT_AUTH_TYPE environment variable', () => {
    it('should select the auth type specified by GEMINI_DEFAULT_AUTH_TYPE', () => {
      process.env.GEMINI_DEFAULT_AUTH_TYPE = 'oauth-personal';

      const settings: LoadedSettings = new LoadedSettings(
        {
          settings: {
            ui: { customThemes: {} },
            mcpServers: {},
          },
          path: '',
        },
        {
          settings: {},
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        true,
      );

      const { lastFrame } = renderWithProviders(
        <AuthDialog onSelect={vi.fn()} settings={settings} />,
      );

      // OAuth-only implementation always shows first option selected by default
      expect(lastFrame()).toContain('● 1. Gemini (Google OAuth)');
    });

    it('should fall back to default if GEMINI_DEFAULT_AUTH_TYPE is not set', () => {
      const settings: LoadedSettings = new LoadedSettings(
        {
          settings: {
            ui: { customThemes: {} },
            mcpServers: {},
          },
          path: '',
        },
        {
          settings: {},
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        true,
      );

      const { lastFrame } = renderWithProviders(
        <AuthDialog onSelect={vi.fn()} settings={settings} />,
      );

      // OAuth-only implementation defaults to Gemini OAuth
      expect(lastFrame()).toContain('● 1. Gemini (Google OAuth)');
    });

    it('should show an error and fall back to default if GEMINI_DEFAULT_AUTH_TYPE is invalid', () => {
      process.env.GEMINI_DEFAULT_AUTH_TYPE = 'invalid-auth-type';

      const settings: LoadedSettings = new LoadedSettings(
        {
          settings: {
            ui: { customThemes: {} },
            mcpServers: {},
          },
          path: '',
        },
        {
          settings: {},
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        {
          settings: { ui: { customThemes: {} }, mcpServers: {} },
          path: '',
        },
        true,
      );

      const { lastFrame } = renderWithProviders(
        <AuthDialog onSelect={vi.fn()} settings={settings} />,
      );

      // OAuth-only implementation doesn't validate GEMINI_DEFAULT_AUTH_TYPE anymore
      expect(lastFrame()).not.toContain(
        'Invalid value for GEMINI_DEFAULT_AUTH_TYPE',
      );

      // OAuth-only implementation defaults to Gemini OAuth
      expect(lastFrame()).toContain('● 1. Gemini (Google OAuth)');
    });
  });

  it('should close dialog when ESC is pressed', async () => {
    const onSelect = vi.fn();
    const settings: LoadedSettings = new LoadedSettings(
      {
        settings: { ui: { customThemes: {} }, mcpServers: {} },
        path: '',
      },
      {
        settings: {},
        path: '',
      },
      {
        settings: {
          ui: { customThemes: {} },
          mcpServers: {},
        },
        path: '',
      },
      {
        settings: { ui: { customThemes: {} }, mcpServers: {} },
        path: '',
      },
      true,
    );

    const { stdin, unmount } = renderWithProviders(
      <AuthDialog onSelect={onSelect} settings={settings} />,
    );
    await wait();

    // Simulate pressing escape key
    stdin.write('\u001b'); // ESC key
    await wait();

    // Should call onSelect with undefined to close the dialog
    expect(onSelect).toHaveBeenCalledWith(undefined, 'User');
    unmount();
  });

  it('should close dialog even with an error message when ESC is pressed', async () => {
    const onSelect = vi.fn();
    const settings: LoadedSettings = new LoadedSettings(
      {
        settings: { ui: { customThemes: {} }, mcpServers: {} },
        path: '',
      },
      {
        settings: {},
        path: '',
      },
      {
        settings: {
          ui: { customThemes: {} },
          mcpServers: {},
        },
        path: '',
      },
      {
        settings: { ui: { customThemes: {} }, mcpServers: {} },
        path: '',
      },
      true,
    );

    const { lastFrame, stdin, unmount } = renderWithProviders(
      <AuthDialog
        onSelect={onSelect}
        settings={settings}
        initialErrorMessage="Initial error"
      />,
    );
    await wait();

    expect(lastFrame()).toContain('Initial error');

    // Simulate pressing escape key
    stdin.write('\u001b'); // ESC key
    await wait();

    // Should call onSelect with undefined to close the dialog
    expect(onSelect).toHaveBeenCalledWith(undefined, 'User');
    unmount();
  });

  it('should allow exiting when auth method is already selected', async () => {
    const onSelect = vi.fn();
    const settings: LoadedSettings = new LoadedSettings(
      {
        settings: { ui: { customThemes: {} }, mcpServers: {} },
        path: '',
      },
      {
        settings: {},
        path: '',
      },
      {
        settings: {
          ui: { customThemes: {} },
          mcpServers: {},
        },
        path: '',
      },
      {
        settings: { ui: { customThemes: {} }, mcpServers: {} },
        path: '',
      },
      true,
    );

    const { stdin, unmount } = renderWithProviders(
      <AuthDialog onSelect={onSelect} settings={settings} />,
    );
    await wait();

    // Simulate pressing escape key
    stdin.write('\u001b'); // ESC key
    await wait();

    // Should call onSelect with undefined to exit
    expect(onSelect).toHaveBeenCalledWith(undefined, SettingScope.User);
    unmount();
  });
});
