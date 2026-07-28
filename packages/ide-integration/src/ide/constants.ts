/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const LLXPRT_CODE_COMPANION_EXTENSION_NAME = 'LLxprt Code Companion';

/**
 * Process executable names (basenames) that reliably identify an IDE ancestor
 * on Windows. Used by `getIdeProcessInfoForWindows()` to walk the ancestor
 * chain and select the real IDE process instead of a fixed tree offset.
 * Matching is case-insensitive and basename-based.
 *
 * This list contains VS Code and known VS Code-like / Electron IDE executable
 * basenames whose process name is a reliable identification signal. It is NOT
 * a mirror of `detectIdeFromEnv()`: several IDEs (Antigravity, Codespaces,
 * Replit, Cloud Shell, Firebase Studio) are detected via environment variables
 * or substring matching (see detect-ide.ts and terminalSetup.ts) rather than
 * by executable basename. Antigravity in particular is a VS Code fork whose
 * GUI process basename has not been confirmed in this repository; it is
 * env-detected via `ANTIGRAVITY_CLI_ALIAS` and substring matching in
 * terminalSetup.ts, so it is intentionally omitted here.
 */
export const IDE_EXECUTABLE_NAMES: readonly string[] = [
  'code.exe',
  'code',
  'code-insiders.exe',
  'code-insiders',
  'codium.exe',
  'codium',
  'cursor.exe',
  'cursor',
  'windsurf.exe',
  'windsurf',
  'trae.exe',
  'trae',
  'sublime_text.exe',
] as const;
