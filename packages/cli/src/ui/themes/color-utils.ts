/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import tinygradient from 'tinygradient';

// Mapping from common CSS color names (lowercase) to hex codes (lowercase)
// Excludes names directly supported by Ink
export const CSS_NAME_TO_HEX_MAP: Readonly<Record<string, string>> = {
  aliceblue: '#f0f8ff',
  antiquewhite: '#faebd7',
  aqua: '#00ffff',
  aquamarine: '#7fffd4',
  azure: '#f0ffff',
  beige: '#f5f5dc',
  bisque: '#ffe4c4',
  blanchedalmond: '#ffebcd',
  blueviolet: '#8a2be2',
  brown: '#a52a2a',
  burlywood: '#deb887',
  cadetblue: '#5f9ea0',
  chartreuse: '#7fff00',
  chocolate: '#d2691e',
  coral: '#ff7f50',
  cornflowerblue: '#6495ed',
  cornsilk: '#fff8dc',
  crimson: '#dc143c',
  darkblue: '#00008b',
  darkcyan: '#008b8b',
  darkgoldenrod: '#b8860b',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  darkgreen: '#006400',
  darkkhaki: '#bdb76b',
  darkmagenta: '#8b008b',
  darkolivegreen: '#556b2f',
  darkorange: '#ff8c00',
  darkorchid: '#9932cc',
  darkred: '#8b0000',
  darksalmon: '#e9967a',
  darkseagreen: '#8fbc8f',
  darkslateblue: '#483d8b',
  darkslategray: '#2f4f4f',
  darkslategrey: '#2f4f4f',
  darkturquoise: '#00ced1',
  darkviolet: '#9400d3',
  deeppink: '#ff1493',
  deepskyblue: '#00bfff',
  dimgray: '#696969',
  dimgrey: '#696969',
  dodgerblue: '#1e90ff',
  firebrick: '#b22222',
  floralwhite: '#fffaf0',
  forestgreen: '#228b22',
  fuchsia: '#ff00ff',
  gainsboro: '#dcdcdc',
  ghostwhite: '#f8f8ff',
  gold: '#ffd700',
  goldenrod: '#daa520',
  greenyellow: '#adff2f',
  honeydew: '#f0fff0',
  hotpink: '#ff69b4',
  indianred: '#cd5c5c',
  indigo: '#4b0082',
  ivory: '#fffff0',
  khaki: '#f0e68c',
  lavender: '#e6e6fa',
  lavenderblush: '#fff0f5',
  lawngreen: '#7cfc00',
  lemonchiffon: '#fffacd',
  lightblue: '#add8e6',
  lightcoral: '#f08080',
  lightcyan: '#e0ffff',
  lightgoldenrodyellow: '#fafad2',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  lightgreen: '#90ee90',
  lightpink: '#ffb6c1',
  lightsalmon: '#ffa07a',
  lightseagreen: '#20b2aa',
  lightskyblue: '#87cefa',
  lightslategray: '#778899',
  lightslategrey: '#778899',
  lightsteelblue: '#b0c4de',
  lightyellow: '#ffffe0',
  lime: '#00ff00',
  limegreen: '#32cd32',
  linen: '#faf0e6',
  maroon: '#800000',
  mediumaquamarine: '#66cdaa',
  mediumblue: '#0000cd',
  mediumorchid: '#ba55d3',
  mediumpurple: '#9370db',
  mediumseagreen: '#3cb371',
  mediumslateblue: '#7b68ee',
  mediumspringgreen: '#00fa9a',
  mediumturquoise: '#48d1cc',
  mediumvioletred: '#c71585',
  midnightblue: '#191970',
  mintcream: '#f5fffa',
  mistyrose: '#ffe4e1',
  moccasin: '#ffe4b5',
  navajowhite: '#ffdead',
  navy: '#000080',
  oldlace: '#fdf5e6',
  olive: '#808000',
  olivedrab: '#6b8e23',
  orange: '#ffa500',
  orangered: '#ff4500',
  orchid: '#da70d6',
  palegoldenrod: '#eee8aa',
  palegreen: '#98fb98',
  paleturquoise: '#afeeee',
  palevioletred: '#db7093',
  papayawhip: '#ffefd5',
  peachpuff: '#ffdab9',
  peru: '#cd853f',
  pink: '#ffc0cb',
  plum: '#dda0dd',
  powderblue: '#b0e0e6',
  purple: '#800080',
  rebeccapurple: '#663399',
  rosybrown: '#bc8f8f',
  royalblue: '#4169e1',
  saddlebrown: '#8b4513',
  salmon: '#fa8072',
  sandybrown: '#f4a460',
  seagreen: '#2e8b57',
  seashell: '#fff5ee',
  sienna: '#a0522d',
  silver: '#c0c0c0',
  skyblue: '#87ceeb',
  slateblue: '#6a5acd',
  slategray: '#708090',
  slategrey: '#708090',
  snow: '#fffafa',
  springgreen: '#00ff7f',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  teal: '#008080',
  thistle: '#d8bfd8',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
  wheat: '#f5deb3',
  whitesmoke: '#f5f5f5',
  yellowgreen: '#9acd32',
};

// Define the set of Ink's named colors for quick lookup
export const INK_SUPPORTED_NAMES = new Set([
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'cyan',
  'magenta',
  'white',
  'gray',
  'grey',
  'blackbright',
  'redbright',
  'greenbright',
  'yellowbright',
  'bluebright',
  'cyanbright',
  'magentabright',
  'whitebright',
]);

/**
 * Checks if a color string is valid (hex, Ink-supported color name, or CSS color name).
 * This function uses the same validation logic as the Theme class's _resolveColor method
 * to ensure consistency between validation and resolution.
 * @param color The color string to validate.
 * @returns True if the color is valid.
 */
export function isValidColor(color: string): boolean {
  const lowerColor = color.toLowerCase();

  // 1. Check if it's a hex code
  if (lowerColor.startsWith('#')) {
    return /^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/.test(color);
  }

  // 2. Check if it's an Ink supported name
  if (INK_SUPPORTED_NAMES.has(lowerColor)) {
    return true;
  }

  // 3. Check if it's a known CSS name we can map to hex
  if (CSS_NAME_TO_HEX_MAP[lowerColor]) {
    return true;
  }

  // 4. Not a valid color
  return false;
}

/**
 * Resolves a CSS color value (name or hex) into an Ink-compatible color string.
 * @param colorValue The raw color string (e.g., 'blue', '#ff0000', 'darkkhaki').
 * @returns An Ink-compatible color string (hex or name), or undefined if not resolvable.
 */
export function resolveColor(colorValue: string): string | undefined {
  const lowerColor = colorValue.toLowerCase();

  // 1. Check if it's already a hex code and valid
  if (lowerColor.startsWith('#')) {
    if (/^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/.test(colorValue)) {
      return lowerColor;
    } else {
      return undefined;
    }
  }
  // 2. Check if it's an Ink supported name (lowercase)
  else if (INK_SUPPORTED_NAMES.has(lowerColor)) {
    return lowerColor; // Use Ink name directly
  }
  // 3. Check if it's a known CSS name we can map to hex
  else if (CSS_NAME_TO_HEX_MAP[lowerColor]) {
    return CSS_NAME_TO_HEX_MAP[lowerColor]; // Use mapped hex
  }

  // 4. Could not resolve
  console.warn(
    `[ColorUtils] Could not resolve color "${colorValue}" to an Ink-compatible format.`,
  );
  return undefined;
}

export function interpolateColor(
  color1: string,
  color2: string,
  factor: number,
) {
  if (factor <= 0 && color1) {
    return color1;
  }
  if (factor >= 1 && color2) {
    return color2;
  }
  if (!color1 || !color2) {
    return '';
  }
  const gradient = tinygradient(color1, color2);
  const color = gradient.rgbAt(factor);
  return color.toHexString();
}

/**
 * Calculates relative luminance and returns 'light' or 'dark'
 * Uses W3C relative luminance formula (WCAG 2.0)
 * @param bgColor The background color in hex format (e.g., '#1E1E2E' or '1E1E2E')
 * @returns 'light' if luminance > 0.5, 'dark' if <= 0.5, undefined if invalid input
 */
export function getThemeTypeFromBackgroundColor(
  bgColor: string | undefined,
): 'light' | 'dark' | undefined {
  if (!bgColor) return undefined;

  const hex = bgColor.replace('#', '');
  if (hex.length !== 6) return undefined;

  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  // sRGB to linear RGB (WCAG 2.0 formula)
  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  // Calculate relative luminance (WCAG 2.0)
  const luminance = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;

  return luminance > 0.5 ? 'light' : 'dark';
}

/**
 * Detects terminal background color using OSC 11 escape sequence
 * Returns hex color string like '#1E1E2E' or undefined if detection fails
 *
 * ROBUSTNESS FEATURES (ALL TESTED):
 * 1. Handles split chunks: Response may arrive across multiple 'data' events
 * 2. Alternate terminators: Supports both ST (ESC \) and BEL (\x07) terminators
 * 3. Timeout protection: Returns undefined after 100ms if no valid response
 * 4. Malformed response handling: Ignores garbage data, times out gracefully
 * 5. Non-TTY detection: Returns undefined immediately if stdin is not a TTY
 * 6. Proper cleanup: Always removes listeners and restores terminal state
 */
/* eslint-disable prefer-const, no-control-regex */
export function detectTerminalBackgroundColor(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      resolve(undefined);
      return;
    }

    const wasRaw = stdin.isRaw === true;
    let timeoutHandle: NodeJS.Timeout;
    let response = '';

    const cleanup = () => {
      stdin.setRawMode(wasRaw);
      stdin.removeListener('data', dataHandler);
      clearTimeout(timeoutHandle);
    };

    const dataHandler = (data: Buffer) => {
      // Accumulate response across multiple data events (handles split chunks)
      response += data.toString();

      // OSC 11 response formats:
      // ESC ] 11 ; rgb:RRRR/GGGG/BBBB ESC \ (ST terminator - standard)
      // ESC ] 11 ; rgb:RRRR/GGGG/BBBB BEL   (BEL terminator - legacy terminals)
      // Match either terminator (case-insensitive hex)
      const matchST = response.match(
        /\x1b\]11;rgb:([0-9a-f]{4})\/([0-9a-f]{4})\/([0-9a-f]{4})\x1b\\/i,
      );
      const matchBEL = response.match(
        /\x1b\]11;rgb:([0-9a-f]{4})\/([0-9a-f]{4})\/([0-9a-f]{4})\x07/i,
      );

      const match = matchST || matchBEL;
      if (match) {
        // Convert 16-bit RGB components to 8-bit hex
        // Take first 2 hex digits of each 4-digit component (high byte)
        const r = parseInt(match[1].substring(0, 2), 16);
        const g = parseInt(match[2].substring(0, 2), 16);
        const b = parseInt(match[3].substring(0, 2), 16);
        cleanup();
        const hexColor =
          `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
        resolve(hexColor);
      }
      // If no match yet, keep accumulating response (handles split chunks)
      // Timeout will handle malformed/incomplete responses
    };

    stdin.on('data', dataHandler);
    stdin.setRawMode(true);

    // Query background color using OSC 11
    process.stdout.write('\x1b]11;?\x1b\\');

    // Timeout after 100ms (terminal doesn't support OSC 11 or no response)
    timeoutHandle = setTimeout(() => {
      cleanup();
      resolve(undefined);
    }, 100);
  });
}
/* eslint-enable prefer-const, no-control-regex */
