/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { renderWithProviders } from '../../test-utils/render.js';

const mockGetAuthStatus = vi.fn();
const mockAuthenticate = vi.fn();

vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => ({
    getCliOAuthManager: () => ({
      authenticate: mockAuthenticate,
      getAuthStatus: mockGetAuthStatus,
    }),
  }),
}));

vi.mock('../../providers/providerManagerInstance.js', () => ({
  getOAuthManager: () => ({
    authenticate: mockAuthenticate,
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
    vi.clearAllMocks();
    mockGetAuthStatus.mockReset();
    mockAuthenticate.mockReset();
    mockGetAuthStatus.mockResolvedValue([]);
    mockAuthenticate.mockResolvedValue(undefined);
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
      expect(frame).toContain('Anthropic Claude (OAuth) [ON] (Authenticated)');
    });
  });

  it('should authenticate provider when selected', async () => {
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
        settings: { ui: { customThemes: {} }, mcpServers: {} },
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

    stdin.write('1');
    await wait();

    expect(mockAuthenticate).toHaveBeenCalledWith('gemini', undefined, {
      signalAuthCompletion: true,
    });
    expect(onSelect).toHaveBeenCalledWith('oauth_gemini', SettingScope.User);
    unmount();
  });

  it('should close dialog when Close is selected', async () => {
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

    stdin.write('4');
    await wait();
    expect(onSelect).toHaveBeenCalledWith(undefined, 'User');
    unmount();
  });

  it('should allow exiting by selecting Close', async () => {
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

    stdin.write('4');
    await wait();
    expect(onSelect).toHaveBeenCalledWith(undefined, SettingScope.User);
    unmount();
  });
});
