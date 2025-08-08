/**
 * @license
 * Copyright 2025 Google LLC
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
      accent: theme.AccentBlue,
    },
    status: {
      success: theme.AccentGreen,
      warning: theme.AccentYellow,
      error: theme.AccentRed,
    },
    background: {
      primary: theme.Background,
      secondary: theme.DiffAdded ?? theme.AccentGreen,
    },
    border: {
      default: theme.Gray,
      focused: theme.AccentBlue,
    },
  };
}
