/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ColorsTheme } from './theme.js';
import { SemanticColors } from './semantic-tokens.js';

/**
 * Resolves a theme's colors to semantic color tokens.
 * Maps theme-specific colors to meaningful semantic purposes.
 */
export function resolveSemanticColors(theme: ColorsTheme): SemanticColors {
  return {
    text: {
      primary: theme.Foreground,
      secondary: theme.Gray,
      link: theme.AccentBlue,
      accent: theme.AccentPurple,
      response: theme.Foreground,
    },
    background: {
      primary: theme.Background,
      diff: {
        added: theme.DiffAdded,
        removed: theme.DiffRemoved,
      },
    },
    border: {
      default: theme.Gray,
      focused: theme.AccentBlue,
    },
    ui: {
      comment: theme.Comment,
      symbol: theme.Gray,
      dark: theme.DarkGray,
      gradient: theme.GradientColors,
    },
    status: {
      error: theme.AccentRed,
      success: theme.AccentGreen,
      warning: theme.AccentYellow,
    },
  };
}
