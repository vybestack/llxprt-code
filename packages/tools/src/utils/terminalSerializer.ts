/**
 * @plan:PLAN-20260608-ISSUE1585.P11
 * @requirement:REQ-PKG-BOUNDARY
 */

/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tools-owned structural type for terminal output.
 *
 * Replaces import of AnsiOutput from packages/core/src/utils/terminalSerializer.
 * The full AnsiOutput type requires @xterm/headless which is a core dependency.
 * Moved tool files that need AnsiOutput in their interfaces should use this
 * package-local type instead.
 *
 * The type is structurally equivalent: an array of lines, where each line
 * is an array of tokens. This avoids the @xterm/headless dependency while
 * maintaining interface compatibility.
 */

export interface AnsiToken {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
  inverse: boolean;
  fg: string;
  bg: string;
}

export type AnsiLine = AnsiToken[];
export type AnsiOutput = AnsiLine[];
