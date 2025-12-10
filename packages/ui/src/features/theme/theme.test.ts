import { describe, expect, it } from 'vitest';
import { createMockTheme } from '../../test/mockTheme';
import { loadThemes } from './theme';
import type { ThemeColors } from './theme';

describe('ThemeColors message properties', () => {
  it('should require message.userBorder property', () => {
    const mockTheme = createMockTheme();
    expect(mockTheme.colors.message.userBorder).toBeDefined();
    expect(typeof mockTheme.colors.message.userBorder).toBe('string');
  });

  it('should require message.systemBorder property', () => {
    const mockTheme = createMockTheme();
    expect(mockTheme.colors.message.systemBorder).toBeDefined();
    expect(typeof mockTheme.colors.message.systemBorder).toBe('string');
  });

  it('should require message.systemText property', () => {
    const mockTheme = createMockTheme();
    expect(mockTheme.colors.message.systemText).toBeDefined();
    expect(typeof mockTheme.colors.message.systemText).toBe('string');
  });

  it('should accept optional message.groupSpacing property', () => {
    const mockTheme = createMockTheme();
    // groupSpacing is optional, so undefined is valid
    const groupSpacing = (
      mockTheme.colors.message as ThemeColors['message'] & {
        groupSpacing?: number;
      }
    ).groupSpacing;
    // Either undefined or a number is valid
    expect(groupSpacing === undefined || typeof groupSpacing === 'number').toBe(
      true,
    );
  });
});

describe('loadThemes', () => {
  it('should load themes with message color properties', () => {
    const themes = loadThemes();
    // Verify themes can be loaded
    expect(themes.length).toBeGreaterThan(0);
    // Verify first theme has message properties (all themes should have them)
    expect(themes[0].colors.message).toBeDefined();
    expect(themes[0].colors.message.userBorder).toBeDefined();
    expect(themes[0].colors.message.systemBorder).toBeDefined();
    expect(themes[0].colors.message.systemText).toBeDefined();
  });
});
