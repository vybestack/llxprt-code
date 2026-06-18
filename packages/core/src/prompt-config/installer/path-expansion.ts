/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import * as os from 'os';
import process from 'node:process';

function isEnvVarNameChar(char: string, first: boolean): boolean {
  if (first) {
    return /^[A-Za-z_]$/.test(char);
  }
  return /^[A-Za-z0-9_]$/.test(char);
}

function lookupEnv(varName: string): string | undefined {
  return process.env[varName];
}

function isValidEnvVarName(name: string): boolean {
  if (name.length === 0) {
    return false;
  }
  if (!isEnvVarNameChar(name[0], true)) {
    return false;
  }
  for (let i = 1; i < name.length; i++) {
    if (!isEnvVarNameChar(name[i], false)) {
      return false;
    }
  }
  return true;
}

interface BracedVarMatch {
  end: number;
  value: string;
}

/** Try to match and expand a braced env var ${VAR} at position `start`. */
function tryBracedVar(input: string, start: number): BracedVarMatch | null {
  if (input[start + 1] !== '{') {
    return null;
  }
  const closeIdx = input.indexOf('}', start + 2);
  if (closeIdx === -1) {
    return null;
  }
  const varName = input.slice(start + 2, closeIdx);
  if (!isValidEnvVarName(varName)) {
    return null;
  }
  const value = lookupEnv(varName);
  if (value === undefined) {
    return null;
  }
  return { end: closeIdx + 1, value };
}

interface BareVarMatch {
  end: number;
  value: string;
}

/** Try to match and expand a bare env var $VAR at position `start`. */
function tryBareVar(input: string, start: number): BareVarMatch | null {
  if (!isEnvVarNameChar(input[start + 1] ?? '', true)) {
    return null;
  }
  let j = start + 1;
  while (j < input.length && isEnvVarNameChar(input[j], false)) {
    j++;
  }
  const varName = input.slice(start + 1, j);
  const value = lookupEnv(varName);
  if (value === undefined) {
    return null;
  }
  return { end: j, value };
}

/**
 * Expand environment variables of the form ${VAR} and $VAR using manual
 * parsing to avoid regex on potentially untrusted path input.
 */
function expandEnvVars(input: string): string {
  const parts: string[] = [];
  let i = 0;
  while (i < input.length) {
    const next = consumeEnvVar(input, i, parts);
    if (next === null) {
      parts.push(input[i]);
      i++;
    } else {
      i = next;
    }
  }
  return parts.join('');
}

/** Attempt to consume an env var reference at position `i`; return next index if consumed. */
function consumeEnvVar(
  input: string,
  i: number,
  parts: string[],
): number | null {
  if (input[i] !== '$') {
    return null;
  }
  const braced = tryBracedVar(input, i);
  if (braced) {
    parts.push(braced.value);
    return braced.end;
  }
  const bare = tryBareVar(input, i);
  if (bare) {
    parts.push(bare.value);
    return bare.end;
  }
  return null;
}

/** Expand path with home directory and environment variables. */
export function expandPath(inputPath: string): string {
  // Handle null or empty input
  if (!inputPath) {
    return '';
  }

  let expandedPath = inputPath;

  // Expand home directory
  if (expandedPath.startsWith('~')) {
    const homeDir = os.homedir();
    expandedPath = homeDir + expandedPath.slice(1);
  }

  // Expand environment variables (${VAR} and $VAR)
  expandedPath = expandEnvVars(expandedPath);

  // Resolve to absolute path
  if (!path.isAbsolute(expandedPath)) {
    expandedPath = path.resolve(expandedPath);
  }

  // Normalize path (remove redundant separators, resolve . and ..)
  return path.normalize(expandedPath);
}

/** Format a date as a local timestamp string for backup filenames. */
export function formatBackupTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

/** Classify a backup error into a user-friendly message. */
export function classifyBackupError(errorMsg: string): string {
  if (errorMsg.includes('ENOSPC')) {
    return 'Insufficient space: Not enough disk space for backup. Try a different location.';
  }
  if (errorMsg.includes('EACCES') || errorMsg.includes('Permission denied')) {
    return 'Permission denied: Cannot write to backup location. Try a different location or check permissions.';
  }
  return `Backup failed: ${errorMsg}`;
}
