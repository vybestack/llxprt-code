/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Backward compatibility layer for existing Colors API
 *
 * This module re-exports the existing Colors API to maintain
 * backward compatibility while the codebase transitions to
 * semantic colors.
 */

// Re-export existing Colors API for backward compatibility
export { Colors, ansi } from '../colors.js';

// Export theme manager for direct access
export { themeManager } from './theme-manager.js';

// Export semantic colors for new code
export { SemanticColors } from './semantic-tokens.js';
export { resolveSemanticColors } from './semantic-resolver.js';

// Import for internal use
import { themeManager } from './theme-manager.js';
// Import Colors for dynamic access to current theme colors
import { Colors } from '../colors.js';

/**
 * Helper function to migrate from Colors to semantic colors
 * This can be used during the transition period to understand
 * how existing color usage maps to semantic tokens.
 */
export interface ColorMigrationMapping {
  /** Maps Colors.* properties to semantic color paths */
  readonly colorToSemanticMapping: Record<string, string>;

  /** Maps semantic color paths to their current values */
  readonly semanticToValueMapping: Record<
    string,
    string | string[] | undefined
  >;
}

/**
 * Gets a mapping between the existing Colors API and semantic colors
 * for the currently active theme. This is useful for migration analysis.
 *
 * @returns Migration mapping information
 */
export function getColorMigrationMapping(): ColorMigrationMapping {
  const semanticColors = themeManager.getSemanticColors();

  const colorToSemanticMapping = {
    'Colors.Foreground': 'text.primary',
    'Colors.Gray': 'text.secondary',
    'Colors.AccentBlue': 'text.accent',
    'Colors.AccentGreen': 'status.success',
    'Colors.AccentYellow': 'status.warning',
    'Colors.AccentRed': 'status.error',
    'Colors.Background': 'background.primary',
    'Colors.DiffAdded': 'background.diff.added',
  } as const;

  const semanticToValueMapping = {
    'text.primary': semanticColors.text.primary,
    'text.secondary': semanticColors.text.secondary,
    'text.accent': semanticColors.text.accent,
    'status.success': semanticColors.status.success,
    'status.warning': semanticColors.status.warning,
    'status.error': semanticColors.status.error,
    'background.primary': semanticColors.background.primary,
    'background.diff.added': semanticColors.background.diff.added,
    'background.diff.removed': semanticColors.background.diff.removed,
    'text.link': semanticColors.text.link,
    'ui.comment': semanticColors.ui.comment,
    'ui.symbol': semanticColors.ui.symbol,
    'ui.gradient': semanticColors.ui.gradient ?? 'undefined',
    'border.default': semanticColors.border.default,
    'border.focused': semanticColors.border.focused,
    // Also include current Colors API values for comparison
    'Colors.Foreground': Colors.Foreground,
    'Colors.Background': Colors.Background,
    'Colors.AccentBlue': Colors.AccentBlue,
    'Colors.AccentGreen': Colors.AccentGreen,
    'Colors.AccentYellow': Colors.AccentYellow,
    'Colors.AccentRed': Colors.AccentRed,
    'Colors.Gray': Colors.Gray,
  } as const;

  return {
    colorToSemanticMapping,
    semanticToValueMapping,
  };
}
