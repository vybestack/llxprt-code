/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared test helpers extracted from prompt-installer.test.ts to keep the
 * test file under the eslint max-lines limit.
 */

const HEX_DIGITS = '0123456789abcdefABCDEF';

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isHexDigit(ch: string): boolean {
  return HEX_DIGITS.includes(ch);
}

/** Validates a backup path of form `<dir>/prompt-backup-YYYYMMDD_HHMMSS[-XXXXXXXX]`. */
export function matchesBackupPath(value: string): boolean {
  const idx = value.lastIndexOf('prompt-backup-');
  if (idx === -1) {
    return false;
  }
  const suffix = value.slice(idx + 'prompt-backup-'.length);
  // YYYYMMDD_HHMMSS = 15 chars: 8 digits, '_', 6 digits
  if (suffix.length < 15) {
    return false;
  }
  for (let i = 0; i < 8; i++) {
    if (!isDigit(suffix[i])) return false;
  }
  if (suffix[8] !== '_') return false;
  for (let i = 9; i < 15; i++) {
    if (!isDigit(suffix[i])) return false;
  }
  // Exact timestamp with no suffix.
  if (suffix.length === 15) {
    return true;
  }
  // UUID suffix: -XXXXXXXX (8 hex chars), matching the production candidate
  // name format (prompt-backup-<ts>-<randomUUID slice(0,8)>).
  if (suffix.length === 24 && suffix[15] === '-') {
    for (let i = 16; i < 24; i++) {
      if (!isHexDigit(suffix[i])) return false;
    }
    return true;
  }
  return false;
}
