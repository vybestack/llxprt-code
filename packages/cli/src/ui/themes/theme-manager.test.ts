/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Patch: Unset NO_COLOR at the very top before any imports
if (process.env.NO_COLOR !== undefined) {
  delete process.env.NO_COLOR;
}

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { themeManager, DEFAULT_THEME } from './theme-manager.js';
import { CustomTheme } from './theme.js';
import { SemanticColors } from './semantic-tokens.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type * as osActual from 'node:os';

vi.mock('node:fs');
vi.mock('node:os', async (importOriginal) => {
  const actualOs = await importOriginal<typeof osActual>();
  return {
    ...actualOs,
    homedir: vi.fn(),
    platform: vi.fn(() => 'linux'),
  };
});

const validCustomTheme: CustomTheme = {
  type: 'custom',
  name: 'MyCustomTheme',
  Background: '#000000',
  Foreground: '#ffffff',
  LightBlue: '#89BDCD',
  AccentBlue: '#3B82F6',
  AccentPurple: '#8B5CF6',
  AccentCyan: '#06B6D4',
  AccentGreen: '#3CA84B',
  AccentYellow: 'yellow',
  AccentRed: 'red',
  DiffAdded: 'green',
  DiffRemoved: 'red',
  Comment: 'gray',
  DimComment: '#5a5a5a',
  Gray: 'gray',
};

describe('ThemeManager', () => {
  beforeEach(() => {
    // Reset themeManager state
    themeManager.loadCustomThemes({});
    themeManager.setActiveTheme(DEFAULT_THEME.name);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should load valid custom themes', () => {
    themeManager.loadCustomThemes({ MyCustomTheme: validCustomTheme });
    expect(themeManager.getCustomThemeNames()).toContain('MyCustomTheme');
    expect(themeManager.isCustomTheme('MyCustomTheme')).toBe(true);
  });

  it('should not load invalid custom themes', () => {
    const invalidTheme = { ...validCustomTheme, Background: 'not-a-color' };
    themeManager.loadCustomThemes({
      InvalidTheme: invalidTheme as unknown as CustomTheme,
    });
    expect(themeManager.getCustomThemeNames()).not.toContain('InvalidTheme');
    expect(themeManager.isCustomTheme('InvalidTheme')).toBe(false);
  });

  it('should set and get the active theme', () => {
    expect(themeManager.getActiveTheme().name).toBe(DEFAULT_THEME.name);
    themeManager.setActiveTheme('Ayu');
    expect(themeManager.getActiveTheme().name).toBe('Ayu');
  });

  it('should set and get a custom active theme', () => {
    themeManager.loadCustomThemes({ MyCustomTheme: validCustomTheme });
    themeManager.setActiveTheme('MyCustomTheme');
    expect(themeManager.getActiveTheme().name).toBe('MyCustomTheme');
  });

  it('should return false when setting a non-existent theme', () => {
    expect(themeManager.setActiveTheme('NonExistentTheme')).toBe(false);
    expect(themeManager.getActiveTheme().name).toBe(DEFAULT_THEME.name);
  });

  it('should list available themes including custom themes', () => {
    themeManager.loadCustomThemes({ MyCustomTheme: validCustomTheme });
    const available = themeManager.getAvailableThemes();
    expect(
      available.some(
        (t: { name: string; isCustom?: boolean }) =>
          t.name === 'MyCustomTheme' && t.isCustom,
      ),
    ).toBe(true);
  });

  it('should get a theme by name', () => {
    expect(themeManager.getTheme('Ayu')).toBeDefined();
    themeManager.loadCustomThemes({ MyCustomTheme: validCustomTheme });
    expect(themeManager.getTheme('MyCustomTheme')).toBeDefined();
  });

  it('should fall back to default theme if active theme is invalid', () => {
    (themeManager as unknown as { activeTheme: unknown }).activeTheme = {
      name: 'NonExistent',
      type: 'custom',
    };
    expect(themeManager.getActiveTheme().name).toBe(DEFAULT_THEME.name);
  });

  it('should return NoColorTheme if NO_COLOR is set', () => {
    const original = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    expect(themeManager.getActiveTheme().name).toBe('NoColor');
    if (original === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = original;
    }
  });

  describe('getSemanticColors', () => {
    it('should return semantic colors for the active theme', () => {
      themeManager.setActiveTheme('Ayu');
      const semanticColors = themeManager.getSemanticColors();

      expect(semanticColors).toEqual({
        text: {
          primary: expect.any(String),
          secondary: expect.any(String),
          link: expect.any(String),
          accent: expect.any(String),
        },
        status: {
          success: expect.any(String),
          warning: expect.any(String),
          error: expect.any(String),
        },
        background: {
          primary: expect.any(String),
          diff: {
            added: expect.any(String),
            removed: expect.any(String),
          },
        },
        ui: {
          comment: expect.any(String),
          symbol: expect.any(String),
          gradient: expect.anything(),
        },
        border: {
          default: expect.any(String),
          focused: expect.any(String),
        },
      } satisfies SemanticColors);
    });

    it('should return semantic colors for custom themes', () => {
      themeManager.loadCustomThemes({ MyCustomTheme: validCustomTheme });
      themeManager.setActiveTheme('MyCustomTheme');

      const semanticColors = themeManager.getSemanticColors();

      expect(semanticColors.text.primary).toBe('#ffffff');
      expect(semanticColors.background.primary).toBe('#000000');
      expect(semanticColors.status.success).toBe('#3CA84B');
      expect(semanticColors.status.warning).toBe('yellow');
      expect(semanticColors.status.error).toBe('red');
    });

    it('should update semantic colors when theme is switched', () => {
      // Start with default theme
      const defaultSemanticColors = themeManager.getSemanticColors();

      // Switch to a different theme
      themeManager.setActiveTheme('Ayu');
      const ayuSemanticColors = themeManager.getSemanticColors();

      // Semantic colors should be different
      expect(defaultSemanticColors.text.primary).not.toBe(
        ayuSemanticColors.text.primary,
      );
      expect(defaultSemanticColors.background.primary).not.toBe(
        ayuSemanticColors.background.primary,
      );
    });

    it('should cache semantic colors for performance', () => {
      const semanticColors1 = themeManager.getSemanticColors();
      const semanticColors2 = themeManager.getSemanticColors();

      // Should return the same object reference (cached)
      expect(semanticColors1).toBe(semanticColors2);
    });

    it('should invalidate cache when theme is switched', () => {
      const semanticColors1 = themeManager.getSemanticColors();

      // Switch theme to invalidate cache
      themeManager.setActiveTheme('Ayu');
      const semanticColors2 = themeManager.getSemanticColors();

      // Should return different object references
      expect(semanticColors1).not.toBe(semanticColors2);
    });
  });

  describe('when loading a theme from a file', () => {
    const mockThemePath = './my-theme.json';
    const mockTheme: CustomTheme = {
      ...validCustomTheme,
      name: 'My File Theme',
    };

    beforeEach(() => {
      vi.mocked(os.homedir).mockReturnValue('/home/user');
      vi.spyOn(fs, 'realpathSync').mockImplementation((p) => p as string);
    });

    it('should load a theme from a valid file path', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockTheme));

      const result = themeManager.setActiveTheme('/home/user/my-theme.json');

      expect(result).toBe(true);
      const activeTheme = themeManager.getActiveTheme();
      expect(activeTheme.name).toBe('My File Theme');
      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('my-theme.json'),
        'utf-8',
      );
    });

    it('should not load a theme if the file does not exist', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      const result = themeManager.setActiveTheme(mockThemePath);

      expect(result).toBe(false);
      expect(themeManager.getActiveTheme().name).toBe(DEFAULT_THEME.name);
    });

    it('should not load a theme from a file with invalid JSON', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue('invalid json');

      const result = themeManager.setActiveTheme(mockThemePath);

      expect(result).toBe(false);
      expect(themeManager.getActiveTheme().name).toBe(DEFAULT_THEME.name);
    });

    it('should not load a theme from an untrusted file path and log a message', () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockTheme));
      const consoleWarnSpy = vi
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      const result = themeManager.setActiveTheme('/untrusted/my-theme.json');

      expect(result).toBe(false);
      expect(themeManager.getActiveTheme().name).toBe(DEFAULT_THEME.name);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('is outside your home directory'),
      );

      consoleWarnSpy.mockRestore();
    });
  });
});
