/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2274 — Split Claude Code OAuth from Anthropic API-key access.
 *
 * Renders the real AuthDialog component (not a mock) and proves the
 * claudecode choice/status/toggle identity. Also asserts the exported
 * ProfileCreateWizard provider options correctly expose `anthropic` as
 * API-key-only (supportsOAuth false) and `claudecode` as OAuth (true).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { LoadedSettings, SettingScope } from '../../config/settings.js';
import { renderWithProviders, waitFor } from '../../test-utils/render.js';

const mockGetAuthStatus = vi.fn();
const mockAuthenticate = vi.fn();
const mockToggleOAuthEnabled = vi.fn();

const realRealInkModule = {
  ...(await import('../../../test-utils/real-ink.js')),
};

void vi.mock('ink', () => realRealInkModule);

void vi.mock('../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => ({
    getCliOAuthManager: () => ({
      authenticate: mockAuthenticate,
      getAuthStatus: mockGetAuthStatus,
      toggleOAuthEnabled: mockToggleOAuthEnabled,
    }),
  }),
}));

import { AuthDialog } from '../components/AuthDialog.js';
import {
  PROVIDER_OPTIONS,
  PARAMETER_DEFAULTS,
} from '../components/ProfileCreateWizard/constants.js';

function makeSettings(
  oauthEnabledProviders: Record<string, boolean> = {},
): LoadedSettings {
  return new LoadedSettings(
    { path: '', settings: { ui: { customThemes: {} }, mcpServers: {} } },
    { path: '', settings: {} },
    {
      path: '',
      settings: {
        ui: { customThemes: {} },
        mcpServers: {},
        oauthEnabledProviders,
      },
    },
    { path: '', settings: { ui: { customThemes: {} }, mcpServers: {} } },
    true,
  );
}

const wait = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

describe('AuthDialog + ProfileCreateWizard claudecode identity (@issue:2274)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.GEMINI_API_KEY = '';
    vi.clearAllMocks();
    mockGetAuthStatus.mockReset();
    mockAuthenticate.mockReset();
    mockToggleOAuthEnabled.mockReset();
    mockGetAuthStatus.mockResolvedValue([]);
    mockAuthenticate.mockResolvedValue(undefined);
    mockToggleOAuthEnabled.mockResolvedValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('renders a Claude Code (Claude.ai OAuth) choice item', () => {
    const { lastFrame } = renderWithProviders(
      <AuthDialog onSelect={vi.fn()} settings={makeSettings()} />,
    );

    expect(lastFrame()).toContain('Claude Code (Claude.ai OAuth)');
  });

  it('shows the claudecode choice as [ON] when oauthEnabledProviders.claudecode is true', () => {
    const { lastFrame } = renderWithProviders(
      <AuthDialog
        onSelect={vi.fn()}
        settings={makeSettings({ claudecode: true })}
      />,
    );

    expect(lastFrame()).toContain('Claude Code (Claude.ai OAuth) [ON]');
  });

  it('shows the claudecode choice as [OFF] when oauthEnabledProviders.claudecode is false', () => {
    const { lastFrame } = renderWithProviders(
      <AuthDialog
        onSelect={vi.fn()}
        settings={makeSettings({ claudecode: false })}
      />,
    );

    expect(lastFrame()).toContain('Claude Code (Claude.ai OAuth) [OFF]');
  });

  it('reflects the authenticated status label for claudecode', async () => {
    mockGetAuthStatus.mockResolvedValue([
      {
        provider: 'claudecode',
        authenticated: true,
        method: 'oauth',
        expiresIn: 3600,
        oauthEnabled: true,
      },
    ]);

    const { lastFrame } = renderWithProviders(
      <AuthDialog
        onSelect={vi.fn()}
        settings={makeSettings({ claudecode: true })}
      />,
    );
    await wait();

    expect(lastFrame()).toContain(
      'Claude Code (Claude.ai OAuth) [ON] (Authenticated)',
    );
  });

  it('toggles the claudecode OAuth identity when the claudecode item is selected', async () => {
    mockGetAuthStatus.mockResolvedValueOnce([]);

    const { stdin, unmount } = renderWithProviders(
      <AuthDialog onSelect={vi.fn()} settings={makeSettings()} />,
    );
    await wait();

    stdin.write('1');

    // Polled rather than slept on: a fixed delay after a keystroke is a race,
    // and how long the render/dispatch takes varies with machine load.
    await waitFor(() => {
      expect(mockToggleOAuthEnabled).toHaveBeenCalledWith('claudecode');
    });
    expect(mockAuthenticate).not.toHaveBeenCalled();
    unmount();
  });

  it('closes the dialog via the Close item at visible position 3', async () => {
    const onSelect = vi.fn();
    const { stdin, unmount } = renderWithProviders(
      <AuthDialog onSelect={onSelect} settings={makeSettings()} />,
    );
    await wait();

    stdin.write('3');

    // Polled rather than slept on, for the same reason as above.
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(undefined, SettingScope.User);
    });
    unmount();
  });

  describe('ProfileCreateWizard provider options', () => {
    it('exposes anthropic as supportsOAuth false (API-key-only)', () => {
      const anthropic = PROVIDER_OPTIONS.find((o) => o.value === 'anthropic');
      expect(anthropic).toBeDefined();
      expect(anthropic!.supportsOAuth).toBe(false);
    });

    it('exposes claudecode as supportsOAuth true (OAuth identity)', () => {
      const claudecode = PROVIDER_OPTIONS.find((o) => o.value === 'claudecode');
      expect(claudecode).toBeDefined();
      expect(claudecode!.supportsOAuth).toBe(true);
    });

    it('labels claudecode distinctly from anthropic', () => {
      const anthropic = PROVIDER_OPTIONS.find((o) => o.value === 'anthropic');
      const claudecode = PROVIDER_OPTIONS.find((o) => o.value === 'claudecode');

      expect(anthropic!.label).toBe('Anthropic');
      expect(claudecode!.label).toBe('Claude Code (Claude.ai OAuth)');
    });

    it('provides explicit subscription parameter defaults for claudecode', () => {
      expect(PARAMETER_DEFAULTS.claudecode).toStrictEqual({
        temperature: 0.7,
        maxTokens: 4096,
        contextLimit: 200000,
      });
    });
  });
});
