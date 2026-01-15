/**
 * @license
 * Copyright 2025 Vybestack LLC
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
        DimComment: '#505564',
        Gray: '#6C7086',
        DarkGray: '#4a4a5a',
      };

      const semanticColors = resolveSemanticColors(darkTheme);

      expect(semanticColors).toEqual({
        text: {
          primary: '#CDD6F4',
          secondary: '#6C7086',
          link: '#89B4FA',
          accent: '#CBA6F7',
          response: '#CDD6F4',
        },
        background: {
          primary: '#1E1E2E',
          diff: {
            added: '#28350B',
            removed: '#430000',
          },
        },
        border: {
          default: '#6C7086',
          focused: '#89B4FA',
        },
        ui: {
          comment: '#6C7086',
          symbol: '#6C7086',
          dark: '#4a4a5a',
          gradient: undefined,
        },
        status: {
          error: '#F38BA8',
          success: '#A6E3A1',
          warning: '#F9E2AF',
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
        DimComment: '#006000',
        Gray: '#97a0b0',
        DarkGray: '#7a8090',
      };

      const semanticColors = resolveSemanticColors(lightTheme);

      expect(semanticColors).toEqual({
        text: {
          primary: '#3C3C43',
          secondary: '#97a0b0',
          link: '#3B82F6',
          accent: '#8B5CF6',
          response: '#3C3C43',
        },
        background: {
          primary: '#FAFAFA',
          diff: {
            added: '#C6EAD8',
            removed: '#FFCCCC',
          },
        },
        border: {
          default: '#97a0b0',
          focused: '#3B82F6',
        },
        ui: {
          comment: '#008000',
          symbol: '#97a0b0',
          dark: '#7a8090',
          gradient: undefined,
        },
        status: {
          error: '#DD4C4C',
          success: '#3CA84B',
          warning: '#D5A40A',
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
        DimComment: '#5a5a5a',
        Gray: 'gray',
        DarkGray: '#4a4a4a',
      };

      const semanticColors = resolveSemanticColors(ansiTheme);

      expect(semanticColors).toEqual({
        text: {
          primary: 'white',
          secondary: 'gray',
          link: 'blue',
          accent: 'magenta',
          response: 'white',
        },
        background: {
          primary: 'black',
          diff: {
            added: 'green',
            removed: 'red',
          },
        },
        border: {
          default: 'gray',
          focused: 'blue',
        },
        ui: {
          comment: 'gray',
          symbol: 'gray',
          dark: '#4a4a4a',
          gradient: undefined,
        },
        status: {
          error: 'red',
          success: 'green',
          warning: 'yellow',
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
        DimComment: '#50555d',
        Gray: '#6C757D',
        DarkGray: '#4c555d',
      };

      const semanticColors = resolveSemanticColors(customTheme);

      expect(semanticColors).toEqual({
        text: {
          primary: '#EDF2F4',
          secondary: '#6C757D',
          link: '#457B9D',
          accent: '#A663CC',
          response: '#EDF2F4',
        },
        background: {
          primary: '#2B2D42',
          diff: {
            added: '#264653',
            removed: '#E76F51',
          },
        },
        border: {
          default: '#6C757D',
          focused: '#457B9D',
        },
        ui: {
          comment: '#6C757D',
          symbol: '#6C757D',
          dark: '#4c555d',
          gradient: undefined,
        },
        status: {
          error: '#E76F51',
          success: '#2A9D8F',
          warning: '#E9C46A',
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
        DimComment: '#505564',
        Gray: '#6C7086',
        DarkGray: '#4a4a5a',
      };

      const semanticColors = resolveSemanticColors(themeWithoutDiffAdded);

      // DiffAdded should be used for diff.added background
      expect(semanticColors.background.diff.added).toBe('#A6E3A1');
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
        DimComment: '#505564',
        Gray: '#6C7086',
        DarkGray: '#4a4a5a',
      };

      const semanticColors = resolveSemanticColors(themeWithoutDiffRemoved);

      // Diff added background should use DiffAdded when available
      expect(semanticColors.background.diff.added).toBe('#28350B');
    });
  });
});
