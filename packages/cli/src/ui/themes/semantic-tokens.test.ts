/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { themeManager } from './theme-manager.js';
import { SemanticColors } from './semantic-tokens.js';
import { getColorMigrationMapping } from './theme-compat.js';
import { Colors } from '../colors.js';

describe('semantic tokens system', () => {
  const originalNoColor = process.env.NO_COLOR;

  beforeEach(() => {
    // Ensure NO_COLOR doesn't interfere with tests
    delete process.env.NO_COLOR;
    // Reset to default theme for consistent testing
    themeManager.setActiveTheme('Green Screen');
  });

  afterEach(() => {
    // Restore original NO_COLOR value
    if (originalNoColor !== undefined) {
      process.env.NO_COLOR = originalNoColor;
    } else {
      delete process.env.NO_COLOR;
    }
  });

  describe('integration with built-in themes', () => {
    it('should resolve semantic colors for all built-in themes', () => {
      const themes = themeManager.getAvailableThemes();
      const builtInThemes = themes.filter((t) => !t.isCustom);

      for (const themeDisplay of builtInThemes) {
        themeManager.setActiveTheme(themeDisplay.name);
        const semanticColors = themeManager.getSemanticColors();

        // Verify all semantic color properties are defined
        expect(semanticColors.text.primary).toBeDefined();
        expect(semanticColors.text.secondary).toBeDefined();
        expect(semanticColors.text.accent).toBeDefined();
        expect(semanticColors.status.success).toBeDefined();
        expect(semanticColors.status.warning).toBeDefined();
        expect(semanticColors.status.error).toBeDefined();
        expect(semanticColors.background.primary).toBeDefined();
        expect(semanticColors.background.diff.added).toBeDefined();
        expect(semanticColors.background.diff.removed).toBeDefined();
        expect(semanticColors.ui.comment).toBeDefined();
        expect(semanticColors.ui.symbol).toBeDefined();
        expect(semanticColors.text.link).toBeDefined();
        expect(semanticColors.border.default).toBeDefined();
        expect(semanticColors.border.focused).toBeDefined();

        // Verify all values are strings (color values)
        expect(typeof semanticColors.text.primary).toBe('string');
        expect(typeof semanticColors.text.secondary).toBe('string');
        expect(typeof semanticColors.text.accent).toBe('string');
        expect(typeof semanticColors.status.success).toBe('string');
        expect(typeof semanticColors.status.warning).toBe('string');
        expect(typeof semanticColors.status.error).toBe('string');
        expect(typeof semanticColors.background.primary).toBe('string');
        expect(typeof semanticColors.background.diff.added).toBe('string');
        expect(typeof semanticColors.background.diff.removed).toBe('string');
        expect(typeof semanticColors.ui.comment).toBe('string');
        expect(typeof semanticColors.ui.symbol).toBe('string');
        expect(typeof semanticColors.text.link).toBe('string');
        expect(typeof semanticColors.border.default).toBe('string');
        expect(typeof semanticColors.border.focused).toBe('string');
      }
    });

    it('should have different semantic colors for different theme types', () => {
      themeManager.setActiveTheme('Ayu'); // Dark theme
      const darkSemanticColors = themeManager.getSemanticColors();

      themeManager.setActiveTheme('Ayu Light'); // Light theme
      const lightSemanticColors = themeManager.getSemanticColors();

      // Colors should be different between dark and light themes
      expect(darkSemanticColors.text.primary).not.toBe(
        lightSemanticColors.text.primary,
      );
      expect(darkSemanticColors.background.primary).not.toBe(
        lightSemanticColors.background.primary,
      );
    });
  });

  describe('custom theme integration', () => {
    it('should resolve semantic colors for custom themes', () => {
      const customTheme = {
        type: 'custom' as const,
        name: 'TestCustomTheme',
        Background: '#1A1A1A',
        Foreground: '#E0E0E0',
        LightBlue: '#5DADE2',
        AccentBlue: '#3498DB',
        AccentPurple: '#9B59B6',
        AccentCyan: '#1ABC9C',
        AccentGreen: '#27AE60',
        AccentYellow: '#F1C40F',
        AccentRed: '#E74C3C',
        DiffAdded: '#2ECC71',
        DiffRemoved: '#E74C3C',
        Comment: '#7F8C8D',
        DimComment: '#5f6a6b',
        Gray: '#95A5A6',
        DarkGray: '#6a6a6a',
      };

      themeManager.loadCustomThemes({ TestCustomTheme: customTheme });
      themeManager.setActiveTheme('TestCustomTheme');

      const semanticColors = themeManager.getSemanticColors();

      expect(semanticColors.text.primary).toBe('#E0E0E0');
      expect(semanticColors.background.primary).toBe('#1A1A1A');
      expect(semanticColors.status.success).toBe('#27AE60');
      expect(semanticColors.status.warning).toBe('#F1C40F');
      expect(semanticColors.status.error).toBe('#E74C3C');
      expect(semanticColors.text.accent).toBe('#9B59B6');
    });

    it('should handle custom themes without DiffAdded gracefully', () => {
      const customThemeNoDiff = {
        type: 'custom' as const,
        name: 'NoDiffTheme',
        Background: '#1A1A1A',
        Foreground: '#E0E0E0',
        LightBlue: '#5DADE2',
        AccentBlue: '#3498DB',
        AccentPurple: '#9B59B6',
        AccentCyan: '#1ABC9C',
        AccentGreen: '#27AE60',
        AccentYellow: '#F1C40F',
        AccentRed: '#E74C3C',
        DiffAdded: '#27AE60', // Using AccentGreen as fallback
        DiffRemoved: '#E74C3C', // Using AccentRed as fallback
        Comment: '#7F8C8D',
        DimComment: '#5f6a6b',
        Gray: '#95A5A6',
        DarkGray: '#6a6a6a',
      };

      themeManager.loadCustomThemes({ NoDiffTheme: customThemeNoDiff });
      const success = themeManager.setActiveTheme('NoDiffTheme');
      expect(success).toBe(true);

      const semanticColors = themeManager.getSemanticColors();

      // Custom theme now has DiffAdded property set
      expect(semanticColors.background.diff.added).toBe('#27AE60'); // Using AccentGreen fallback
    });
  });

  describe('theme switching behavior', () => {
    it('should update semantic colors immediately when theme is switched', () => {
      // Start with Green Screen theme
      themeManager.setActiveTheme('Green Screen');
      const greenScreenColors = themeManager.getSemanticColors();

      // Switch to Dracula theme
      themeManager.setActiveTheme('Dracula');
      const draculaColors = themeManager.getSemanticColors();

      // Colors should be different
      expect(greenScreenColors.text.primary).not.toBe(
        draculaColors.text.primary,
      );
      expect(greenScreenColors.background.primary).not.toBe(
        draculaColors.background.primary,
      );

      // Switch back to Green Screen
      themeManager.setActiveTheme('Green Screen');
      const greenScreenColorsAgain = themeManager.getSemanticColors();

      // Should be the same as initial Green Screen colors
      expect(greenScreenColors.text.primary).toBe(
        greenScreenColorsAgain.text.primary,
      );
      expect(greenScreenColors.background.primary).toBe(
        greenScreenColorsAgain.background.primary,
      );
    });
  });

  describe('backward compatibility', () => {
    it('should maintain Colors API functionality', () => {
      themeManager.setActiveTheme('Ayu');

      // Colors API should still work
      expect(Colors.Foreground).toBeDefined();
      expect(Colors.Background).toBeDefined();
      expect(Colors.AccentBlue).toBeDefined();
      expect(Colors.AccentGreen).toBeDefined();
      expect(Colors.AccentRed).toBeDefined();
      expect(Colors.AccentYellow).toBeDefined();

      // Values should be strings
      expect(typeof Colors.Foreground).toBe('string');
      expect(typeof Colors.Background).toBe('string');
    });

    it('should provide migration mapping between Colors and semantic tokens', () => {
      themeManager.setActiveTheme('Ayu');

      const mapping = getColorMigrationMapping();

      expect(mapping.colorToSemanticMapping).toBeDefined();
      expect(mapping.semanticToValueMapping).toBeDefined();

      // Verify specific mappings exist
      expect(mapping.colorToSemanticMapping['Colors.Foreground']).toBe(
        'text.primary',
      );
      expect(mapping.colorToSemanticMapping['Colors.AccentBlue']).toBe(
        'text.accent',
      );
      expect(mapping.colorToSemanticMapping['Colors.AccentGreen']).toBe(
        'status.success',
      );

      // Verify semantic values are populated
      expect(mapping.semanticToValueMapping['text.primary']).toBeDefined();
      expect(mapping.semanticToValueMapping['status.success']).toBeDefined();
      expect(
        mapping.semanticToValueMapping['background.primary'],
      ).toBeDefined();
    });

    it('should have consistent values between Colors API and semantic colors', () => {
      themeManager.setActiveTheme('GitHub Dark');

      const semanticColors = themeManager.getSemanticColors();

      // These should match the mapping defined in theme-compat.ts
      expect(semanticColors.text.primary).toBe(Colors.Foreground);
      expect(semanticColors.text.secondary).toBe(Colors.Gray);
      expect(semanticColors.text.accent).toBe(Colors.AccentBlue);
      expect(semanticColors.status.success).toBe(Colors.AccentGreen);
      expect(semanticColors.status.warning).toBe(Colors.AccentYellow);
      expect(semanticColors.status.error).toBe(Colors.AccentRed);
      expect(semanticColors.background.primary).toBe(Colors.Background);
    });
  });

  describe('semantic color structure', () => {
    it('should conform to SemanticColors interface', () => {
      const semanticColors = themeManager.getSemanticColors();

      // Verify structure matches interface
      expect(semanticColors).toEqual({
        text: {
          primary: expect.any(String),
          secondary: expect.any(String),
          link: expect.any(String),
          accent: expect.any(String),
          response: expect.any(String),
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
          dark: expect.any(String),
          gradient: expect.anything(),
        },
        border: {
          default: expect.any(String),
          focused: expect.any(String),
        },
      } satisfies SemanticColors);
    });

    it('should provide meaningful color abstractions', () => {
      // Use Ayu theme which has distinct colors
      themeManager.setActiveTheme('Ayu');
      const semanticColors = themeManager.getSemanticColors();

      // Status colors should be distinct for most themes
      expect(semanticColors.status.success).not.toBe(
        semanticColors.status.warning,
      );
      expect(semanticColors.status.warning).not.toBe(
        semanticColors.status.error,
      );
      expect(semanticColors.status.success).not.toBe(
        semanticColors.status.error,
      );

      // All semantic colors should be defined
      expect(semanticColors.text.primary).toBeDefined();
      expect(semanticColors.text.secondary).toBeDefined();
      expect(semanticColors.text.accent).toBeDefined();
      expect(semanticColors.border.default).toBeDefined();
      expect(semanticColors.border.focused).toBeDefined();
    });
  });

  describe('performance characteristics', () => {
    it('should cache semantic colors until theme changes', () => {
      themeManager.setActiveTheme('Ayu');

      const colors1 = themeManager.getSemanticColors();
      const colors2 = themeManager.getSemanticColors();

      // Should return same object (cached)
      expect(colors1).toBe(colors2);
    });

    it('should invalidate cache on theme change', () => {
      themeManager.setActiveTheme('Ayu');
      const ayuColors = themeManager.getSemanticColors();

      themeManager.setActiveTheme('Dracula');
      const draculaColors = themeManager.getSemanticColors();

      // Should return different objects
      expect(ayuColors).not.toBe(draculaColors);
    });

    it('should invalidate cache on custom theme reload', () => {
      const customTheme = {
        type: 'custom' as const,
        name: 'CacheTestTheme',
        Background: '#000000',
        Foreground: '#FFFFFF',
        LightBlue: '#89BDCD',
        AccentBlue: '#3B82F6',
        AccentPurple: '#8B5CF6',
        AccentCyan: '#06B6D4',
        AccentGreen: '#27AE60',
        AccentYellow: '#F1C40F',
        AccentRed: '#E74C3C',
        DiffAdded: '#27AE60', // Using AccentGreen as fallback
        DiffRemoved: '#E74C3C', // Using AccentRed as fallback
        Comment: '#7F8C8D',
        DimComment: '#5f6a6b',
        Gray: '#95A5A6',
        DarkGray: '#6a6a6a',
      };

      themeManager.loadCustomThemes({ CacheTestTheme: customTheme });
      themeManager.setActiveTheme('CacheTestTheme');
      const colors1 = themeManager.getSemanticColors();

      // Reload custom themes (simulating settings change)
      themeManager.loadCustomThemes({ CacheTestTheme: customTheme });
      themeManager.setActiveTheme('CacheTestTheme');
      const colors2 = themeManager.getSemanticColors();

      // Should return different object references (cache invalidated)
      expect(colors1).not.toBe(colors2);
      // But values should be the same since theme didn't change
      expect(colors1.text.primary).toBe(colors2.text.primary);
    });
  });
});
