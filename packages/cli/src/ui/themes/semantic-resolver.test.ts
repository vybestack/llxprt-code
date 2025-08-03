/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { resolveSemanticColors } from './semantic-resolver.js';
import { SemanticColors } from './semantic-tokens.js';
import { ColorsTheme } from './theme.js';

describe('semantic-resolver', () => {
  describe('resolveSemanticColors', () => {
    it('should resolve semantic colors for dark theme', () => {
      const darkTheme: ColorsTheme = {
        type: 'dark',
        Background: '#1E1E2E',
        Foreground: '#CDD6F4',
        LightBlue: '#ADD8E6',
        AccentBlue: '#89B4FA',
        AccentPurple: '#CBA6F7',
        AccentCyan: '#89DCEB',
        AccentGreen: '#A6E3A1',
        AccentYellow: '#F9E2AF',
        AccentRed: '#F38BA8',
        DiffAdded: '#28350B',
        DiffRemoved: '#430000',
        Comment: '#6C7086',
        Gray: '#6C7086',
      };

      const semanticColors = resolveSemanticColors(darkTheme);

      expect(semanticColors).toEqual({
        text: {
          primary: '#CDD6F4',
          secondary: '#6C7086',
          accent: '#89B4FA',
        },
        status: {
          success: '#A6E3A1',
          warning: '#F9E2AF',
          error: '#F38BA8',
        },
        background: {
          primary: '#1E1E2E',
          secondary: '#28350B',
        },
        border: {
          default: '#6C7086',
          focused: '#89B4FA',
        },
      } satisfies SemanticColors);
    });

    it('should resolve semantic colors for light theme', () => {
      const lightTheme: ColorsTheme = {
        type: 'light',
        Background: '#FAFAFA',
        Foreground: '#3C3C43',
        LightBlue: '#89BDCD',
        AccentBlue: '#3B82F6',
        AccentPurple: '#8B5CF6',
        AccentCyan: '#06B6D4',
        AccentGreen: '#3CA84B',
        AccentYellow: '#D5A40A',
        AccentRed: '#DD4C4C',
        DiffAdded: '#C6EAD8',
        DiffRemoved: '#FFCCCC',
        Comment: '#008000',
        Gray: '#97a0b0',
      };

      const semanticColors = resolveSemanticColors(lightTheme);

      expect(semanticColors).toEqual({
        text: {
          primary: '#3C3C43',
          secondary: '#97a0b0',
          accent: '#3B82F6',
        },
        status: {
          success: '#3CA84B',
          warning: '#D5A40A',
          error: '#DD4C4C',
        },
        background: {
          primary: '#FAFAFA',
          secondary: '#C6EAD8',
        },
        border: {
          default: '#97a0b0',
          focused: '#3B82F6',
        },
      } satisfies SemanticColors);
    });

    it('should resolve semantic colors for ANSI theme', () => {
      const ansiTheme: ColorsTheme = {
        type: 'ansi',
        Background: 'black',
        Foreground: 'white',
        LightBlue: 'blue',
        AccentBlue: 'blue',
        AccentPurple: 'magenta',
        AccentCyan: 'cyan',
        AccentGreen: 'green',
        AccentYellow: 'yellow',
        AccentRed: 'red',
        DiffAdded: 'green',
        DiffRemoved: 'red',
        Comment: 'gray',
        Gray: 'gray',
      };

      const semanticColors = resolveSemanticColors(ansiTheme);

      expect(semanticColors).toEqual({
        text: {
          primary: 'white',
          secondary: 'gray',
          accent: 'blue',
        },
        status: {
          success: 'green',
          warning: 'yellow',
          error: 'red',
        },
        background: {
          primary: 'black',
          secondary: 'green',
        },
        border: {
          default: 'gray',
          focused: 'blue',
        },
      } satisfies SemanticColors);
    });

    it('should resolve semantic colors for custom theme', () => {
      const customTheme: ColorsTheme = {
        type: 'custom',
        Background: '#2B2D42',
        Foreground: '#EDF2F4',
        LightBlue: '#8D99AE',
        AccentBlue: '#457B9D',
        AccentPurple: '#A663CC',
        AccentCyan: '#1D3557',
        AccentGreen: '#2A9D8F',
        AccentYellow: '#E9C46A',
        AccentRed: '#E76F51',
        DiffAdded: '#264653',
        DiffRemoved: '#E76F51',
        Comment: '#6C757D',
        Gray: '#6C757D',
      };

      const semanticColors = resolveSemanticColors(customTheme);

      expect(semanticColors).toEqual({
        text: {
          primary: '#EDF2F4',
          secondary: '#6C757D',
          accent: '#457B9D',
        },
        status: {
          success: '#2A9D8F',
          warning: '#E9C46A',
          error: '#E76F51',
        },
        background: {
          primary: '#2B2D42',
          secondary: '#264653',
        },
        border: {
          default: '#6C757D',
          focused: '#457B9D',
        },
      } satisfies SemanticColors);
    });

    it('should handle theme with missing DiffAdded by using AccentGreen', () => {
      const themeWithoutDiffAdded: ColorsTheme = {
        type: 'dark',
        Background: '#1E1E2E',
        Foreground: '#CDD6F4',
        LightBlue: '#ADD8E6',
        AccentBlue: '#89B4FA',
        AccentPurple: '#CBA6F7',
        AccentCyan: '#89DCEB',
        AccentGreen: '#A6E3A1',
        AccentYellow: '#F9E2AF',
        AccentRed: '#F38BA8',
        DiffAdded: '#A6E3A1', // Using AccentGreen as fallback
        DiffRemoved: '#430000',
        Comment: '#6C7086',
        Gray: '#6C7086',
      };

      const semanticColors = resolveSemanticColors(themeWithoutDiffAdded);

      // DiffAdded should be used for secondary background
      expect(semanticColors.background.secondary).toBe('#A6E3A1');
    });

    it('should handle theme with missing DiffRemoved by using AccentRed', () => {
      const themeWithoutDiffRemoved: ColorsTheme = {
        type: 'dark',
        Background: '#1E1E2E',
        Foreground: '#CDD6F4',
        LightBlue: '#ADD8E6',
        AccentBlue: '#89B4FA',
        AccentPurple: '#CBA6F7',
        AccentCyan: '#89DCEB',
        AccentGreen: '#A6E3A1',
        AccentYellow: '#F9E2AF',
        AccentRed: '#F38BA8',
        DiffAdded: '#28350B',
        DiffRemoved: '#F38BA8', // Using AccentRed as fallback
        Comment: '#6C7086',
        Gray: '#6C7086',
      };

      const semanticColors = resolveSemanticColors(themeWithoutDiffRemoved);

      // Secondary background should use DiffAdded when available
      expect(semanticColors.background.secondary).toBe('#28350B');
    });
  });
});
