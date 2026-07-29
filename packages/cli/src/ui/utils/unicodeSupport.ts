/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type UnicodeMode = 'auto' | 'force' | 'off';

export type BorderStyleName = 'round' | 'single';

interface CustomBorderStyle {
  readonly topLeft: string;
  readonly topRight: string;
  readonly bottomRight: string;
  readonly bottomLeft: string;
  readonly top: string;
  readonly bottom: string;
  readonly left: string;
  readonly right: string;
}

export const ASCII_BORDER_STYLES: Readonly<
  Record<BorderStyleName, CustomBorderStyle>
> = {
  round: {
    topLeft: '+',
    topRight: '+',
    bottomRight: '+',
    bottomLeft: '+',
    top: '-',
    bottom: '-',
    left: '|',
    right: '|',
  },
  single: {
    topLeft: '+',
    topRight: '+',
    bottomRight: '+',
    bottomLeft: '+',
    top: '-',
    bottom: '-',
    left: '|',
    right: '|',
  },
} as const;

// ink-spinner only accepts string keys into cli-spinners (it indexes the
// cli-spinners map by name), so the ASCII fallback must be a known spinner
// name. "line" cycles `-`, `\`, `|`, `/` — all pure ASCII.
export const ASCII_SPINNER_NAME = 'line';

export function detectUnicodeSupport(
  mode: UnicodeMode = 'auto',
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (mode === 'force') {
    return true;
  }
  if (mode === 'off') {
    return false;
  }
  if (platform === 'win32') {
    return env.LLXPRT_FORCE_UNICODE === '1';
  }
  return true;
}

let unicodeSupported = true;

export function isUnicodeSupported(): boolean {
  return unicodeSupported;
}

export function configureUnicodeSupport(mode: UnicodeMode): void {
  unicodeSupported = detectUnicodeSupport(mode);
}

export function resetUnicodeSupportForTesting(supported = true): void {
  unicodeSupported = supported;
}

export function getBorderStyle(
  style: BorderStyleName,
  supported: boolean = unicodeSupported,
): BorderStyleName | CustomBorderStyle {
  if (supported) {
    return style;
  }
  return ASCII_BORDER_STYLES[style];
}

export function getSpinnerType<T extends string>(
  type: T,
  supported: boolean = unicodeSupported,
): T | 'line' {
  if (supported) {
    return type;
  }
  return ASCII_SPINNER_NAME;
}
