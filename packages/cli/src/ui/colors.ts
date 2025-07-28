/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { themeManager } from './themes/theme-manager.js';
import { ColorsTheme } from './themes/theme.js';
import chalk from 'chalk';

export const Colors: ColorsTheme = {
  get type() {
    return themeManager.getActiveTheme().colors.type;
  },
  get Foreground() {
    return themeManager.getActiveTheme().colors.Foreground;
  },
  get Background() {
    return themeManager.getActiveTheme().colors.Background;
  },
  get LightBlue() {
    return themeManager.getActiveTheme().colors.LightBlue;
  },
  get AccentBlue() {
    return themeManager.getActiveTheme().colors.AccentBlue;
  },
  get AccentPurple() {
    return themeManager.getActiveTheme().colors.AccentPurple;
  },
  get AccentCyan() {
    return themeManager.getActiveTheme().colors.AccentCyan;
  },
  get AccentGreen() {
    return themeManager.getActiveTheme().colors.AccentGreen;
  },
  get AccentYellow() {
    return themeManager.getActiveTheme().colors.AccentYellow;
  },
  get AccentRed() {
    return themeManager.getActiveTheme().colors.AccentRed;
  },
  get DiffAdded() {
    return themeManager.getActiveTheme().colors.DiffAdded;
  },
  get DiffRemoved() {
    return themeManager.getActiveTheme().colors.DiffRemoved;
  },
  get Comment() {
    return themeManager.getActiveTheme().colors.Comment;
  },
  get Gray() {
    return themeManager.getActiveTheme().colors.Gray;
  },
  get GradientColors() {
    return themeManager.getActiveTheme().colors.GradientColors;
  },
};

/**
 * Helper function to apply theme color to text using chalk
 * Handles both hex colors and named colors
 */
function applyColor(color: string, text: string): string {
  if (color.startsWith('#')) {
    return chalk.hex(color)(text);
  }
  // Handle named colors - map to specific chalk methods
  switch (color.toLowerCase()) {
    case 'black':
      return chalk.black(text);
    case 'red':
      return chalk.red(text);
    case 'green':
      return chalk.green(text);
    case 'yellow':
      return chalk.yellow(text);
    case 'blue':
      return chalk.blue(text);
    case 'magenta':
      return chalk.magenta(text);
    case 'cyan':
      return chalk.cyan(text);
    case 'white':
      return chalk.white(text);
    case 'gray':
    case 'grey':
      return chalk.gray(text);
    default:
      return text;
  }
}

/**
 * ANSI-styled text using theme colors
 * For use in console output and string returns (not React components)
 */
export const ansi = {
  foreground: (text: string) => applyColor(Colors.Foreground, text),
  background: (text: string) => {
    const bg = Colors.Background;
    if (bg.startsWith('#')) {
      return chalk.bgHex(bg)(text);
    }
    // Handle named background colors
    switch (bg.toLowerCase()) {
      case 'black':
        return chalk.bgBlack(text);
      case 'red':
        return chalk.bgRed(text);
      case 'green':
        return chalk.bgGreen(text);
      case 'yellow':
        return chalk.bgYellow(text);
      case 'blue':
        return chalk.bgBlue(text);
      case 'magenta':
        return chalk.bgMagenta(text);
      case 'cyan':
        return chalk.bgCyan(text);
      case 'white':
        return chalk.bgWhite(text);
      default:
        return text;
    }
  },
  lightBlue: (text: string) => applyColor(Colors.LightBlue, text),
  accentBlue: (text: string) => applyColor(Colors.AccentBlue, text),
  accentPurple: (text: string) => applyColor(Colors.AccentPurple, text),
  accentCyan: (text: string) => applyColor(Colors.AccentCyan, text),
  accentGreen: (text: string) => applyColor(Colors.AccentGreen, text),
  accentYellow: (text: string) => applyColor(Colors.AccentYellow, text),
  accentRed: (text: string) => applyColor(Colors.AccentRed, text),
  comment: (text: string) => applyColor(Colors.Comment, text),
  gray: (text: string) => applyColor(Colors.Gray, text),
  bold: (text: string) => chalk.bold(text),
};
