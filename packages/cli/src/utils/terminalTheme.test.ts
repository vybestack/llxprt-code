/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  Config,
  SettingsService,
  coreEvents,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../config/settings.js';
import { setupTerminalAndTheme } from './terminalTheme.js';
import { terminalCapabilityManager } from '../ui/utils/terminalCapabilityManager.js';
import { themeManager } from '../ui/themes/theme-manager.js';

// Mock terminalCapabilityManager
vi.mock('../ui/utils/terminalCapabilityManager.js', () => ({
  terminalCapabilityManager: {
    detectCapabilities: vi.fn().mockResolvedValue(undefined),
    getTerminalBackgroundColor: vi.fn().mockReturnValue(undefined),
  },
}));

// Mock themeManager
vi.mock('../ui/themes/theme-manager.js', () => ({
  themeManager: {
    loadCustomThemes: vi.fn(),
    setActiveTheme: vi.fn().mockReturnValue(true),
    getActiveTheme: vi.fn().mockReturnValue({
      name: 'Green Screen',
      type: 'dark',
      colors: { Background: '#000000' },
    }),
    getAllThemes: vi.fn().mockReturnValue([
      { name: 'Green Screen', type: 'dark', colors: { Background: '#000000' } },
      {
        name: 'Default Light',
        type: 'light',
        colors: { Background: '#FFFFFF' },
      },
    ]),
  },
  DEFAULT_THEME: { name: 'Green Screen' },
}));

describe('setupTerminalAndTheme', () => {
  let config: Config;
  let settingsService: SettingsService;
  let mockSettings: LoadedSettings;

  beforeEach(async () => {
    vi.clearAllMocks();

    settingsService = new SettingsService();
    config = new Config({
      cwd: '/tmp',
      targetDir: '/tmp/test',
      debugMode: false,
      question: undefined,
      userMemory: '',
      sessionId: 'test-session',
      model: 'test-model',
      settingsService,
    });
    await config.initialize();

    // Create a minimal mock LoadedSettings
    mockSettings = {
      merged: {
        ui: {},
      },
    } as LoadedSettings;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Interactive TTY', () => {
    let originalIsTTY: boolean | undefined;

    beforeEach(() => {
      // Mock interactive TTY
      vi.spyOn(config, 'isInteractive').mockReturnValue(true);
      originalIsTTY = process.stdin.isTTY;
      // Set isTTY directly on process.stdin
      Object.defineProperty(process.stdin, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
      });
    });

    it('should call detectCapabilities for interactive TTY', async () => {
      await setupTerminalAndTheme(config, mockSettings);
      expect(terminalCapabilityManager.detectCapabilities).toHaveBeenCalled();
    });

    it('should load custom themes from settings', async () => {
      const customThemes = {
        myTheme: {
          name: 'My Theme',
          type: 'custom' as const,
          Background: '#000000',
          Foreground: '#FFFFFF',
          LightBlue: '#89BDCD',
          AccentBlue: '#3B82F6',
          AccentPurple: '#8B5CF6',
          AccentCyan: '#06B6D4',
          AccentGreen: '#3CA84B',
          AccentYellow: '#D5A40A',
          AccentRed: '#DD4C4C',
          Comment: '#008000',
          Gray: '#97a0b0',
        },
      };
      mockSettings.merged.ui = { customThemes };

      await setupTerminalAndTheme(config, mockSettings);
      expect(themeManager.loadCustomThemes).toHaveBeenCalledWith(customThemes);
    });

    it('should use theme from settings if specified', async () => {
      mockSettings.merged.ui = { theme: 'Green Screen' };

      await setupTerminalAndTheme(config, mockSettings);
      expect(themeManager.setActiveTheme).toHaveBeenCalledWith('Green Screen');
    });

    it('should pick default theme based on background color if no theme set', async () => {
      vi.mocked(
        terminalCapabilityManager.getTerminalBackgroundColor,
      ).mockReturnValue('#1E1E2E');

      await setupTerminalAndTheme(config, mockSettings);
      expect(themeManager.setActiveTheme).toHaveBeenCalled();
    });

    it('should store background color in config', async () => {
      const bgColor = '#1E1E2E';
      vi.mocked(
        terminalCapabilityManager.getTerminalBackgroundColor,
      ).mockReturnValue(bgColor);

      await setupTerminalAndTheme(config, mockSettings);
      expect(config.getTerminalBackground()).toBe(bgColor);
    });

    it('should return the detected background color', async () => {
      const bgColor = '#1E1E2E';
      vi.mocked(
        terminalCapabilityManager.getTerminalBackgroundColor,
      ).mockReturnValue(bgColor);

      const result = await setupTerminalAndTheme(config, mockSettings);
      expect(result).toBe(bgColor);
    });

    it('should emit warning when active theme is incompatible with detected background', async () => {
      const feedbackSpy = vi.spyOn(coreEvents, 'emitFeedback');

      // Set a light background color
      vi.mocked(
        terminalCapabilityManager.getTerminalBackgroundColor,
      ).mockReturnValue('#FFFFFF');

      // Set a dark theme (return value must match Theme class structure)
      vi.mocked(themeManager.getActiveTheme).mockReturnValue({
        name: 'Green Screen',
        type: 'dark',
        colors: {
          type: 'dark',
          Background: '#000000',
          Foreground: '#33FF33',
          LightBlue: '#89BDCD',
          AccentBlue: '#3B82F6',
          AccentPurple: '#8B5CF6',
          AccentCyan: '#06B6D4',
          AccentGreen: '#3CA84B',
          AccentYellow: '#D5A40A',
          AccentRed: '#DD4C4C',
          DiffAdded: '#3CA84B',
          DiffRemoved: '#DD4C4C',
          Comment: '#008000',
          DimComment: '#006600',
          Gray: '#97a0b0',
          DarkGray: '#5c6370',
        },
      } as unknown as ReturnType<typeof themeManager.getActiveTheme>);

      await setupTerminalAndTheme(config, mockSettings);

      expect(feedbackSpy).toHaveBeenCalledWith(
        'warning',
        expect.stringContaining(
          "Theme 'Green Screen' (dark) might look incorrect on your light terminal background",
        ),
      );

      feedbackSpy.mockRestore();
    });

    it('should emit warning log when configured theme is not found', async () => {
      const nonExistentTheme = 'NonExistentTheme';
      mockSettings.merged.ui = { theme: nonExistentTheme };

      // Make setActiveTheme return false to indicate theme not found
      vi.mocked(themeManager.setActiveTheme).mockReturnValue(false);

      // Spy on DebugLogger.warn to capture the warning log
      const debugLoggerWarnSpy = vi.spyOn(DebugLogger.prototype, 'warn');

      await setupTerminalAndTheme(config, mockSettings);

      expect(themeManager.setActiveTheme).toHaveBeenCalledWith(
        nonExistentTheme,
      );
      expect(debugLoggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `Warning: Theme "${nonExistentTheme}" not found`,
        ),
      );

      debugLoggerWarnSpy.mockRestore();
    });
  });

  describe('Non-interactive', () => {
    beforeEach(() => {
      vi.spyOn(config, 'isInteractive').mockReturnValue(false);
    });

    it('should skip detectCapabilities for non-interactive', async () => {
      await setupTerminalAndTheme(config, mockSettings);
      expect(
        terminalCapabilityManager.detectCapabilities,
      ).not.toHaveBeenCalled();
    });

    it('should still load custom themes', async () => {
      const customThemes = {
        myTheme: {
          name: 'My Theme',
          type: 'custom' as const,
          Background: '#000000',
          Foreground: '#FFFFFF',
          LightBlue: '#89BDCD',
          AccentBlue: '#3B82F6',
          AccentPurple: '#8B5CF6',
          AccentCyan: '#06B6D4',
          AccentGreen: '#3CA84B',
          AccentYellow: '#D5A40A',
          AccentRed: '#DD4C4C',
          Comment: '#008000',
          Gray: '#97a0b0',
        },
      };
      mockSettings.merged.ui = { customThemes };

      await setupTerminalAndTheme(config, mockSettings);
      expect(themeManager.loadCustomThemes).toHaveBeenCalledWith(customThemes);
    });

    it('should return undefined background color', async () => {
      const result = await setupTerminalAndTheme(config, mockSettings);
      expect(result).toBeUndefined();
    });
  });
});
