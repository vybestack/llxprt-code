/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export type NormalizeTrustPathResult =
  | { readonly ok: true; readonly normalizedPath: string }
  | { readonly ok: false; readonly reason: 'path-required' };

export type TrustPathProblem =
  | 'path-required'
  | 'not-found'
  | 'not-a-directory';

function stripSurroundingQuotes(value: string): string {
  if (value.length < 2) {
    return value;
  }
  const first = value[0];
  const last = value[value.length - 1];
  if (first === last && (first === '"' || first === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function expandTilde(value: string): string {
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

/**
 * Normalizes a raw user-entered trust path against a working directory.
 *
 * Resolves relative paths, expands a bare `~` and `~/sub` to the home
 * directory, trims whitespace, strips a matched pair of surrounding quotes,
 * and produces an explicit error state for empty/whitespace-only input rather
 * than throwing. A `~user` form is intentionally left literal.
 */
export function normalizeTrustPathInput(
  rawInput: string,
  workingDirectory: string,
): NormalizeTrustPathResult {
  const unquoted = stripSurroundingQuotes(rawInput.trim()).trim();
  if (unquoted.length === 0) {
    return { ok: false, reason: 'path-required' };
  }
  const expanded = expandTilde(unquoted);
  const normalizedPath = path.resolve(
    path.isAbsolute(expanded)
      ? expanded
      : path.join(workingDirectory, expanded),
  );
  return { ok: true, normalizedPath };
}

export type ResolveTrustDirectoryResult =
  | { readonly ok: true; readonly normalizedPath: string }
  | { readonly ok: false; readonly problem: TrustPathProblem };

const TRUST_PATH_PROBLEM_MESSAGES: Readonly<Record<TrustPathProblem, string>> =
  {
    'path-required': 'Enter a folder path to continue.',
    'not-found': 'That folder does not exist.',
    'not-a-directory': 'That path is not a folder.',
  };

export function getTrustPathProblemMessage(problem: TrustPathProblem): string {
  return TRUST_PATH_PROBLEM_MESSAGES[problem];
}

/**
 * Normalizes raw user input and confirms it names an existing directory.
 *
 * Trust rules are persisted under a canonical path, which `LoadedTrustedFolders`
 * derives with `fs.realpathSync`; that throws for a path which does not exist.
 * Validating here lets the dialog report a precise, actionable problem instead
 * of surfacing a commit failure.
 */
export function resolveTrustDirectory(
  rawInput: string,
  workingDirectory: string,
): ResolveTrustDirectoryResult {
  const normalized = normalizeTrustPathInput(rawInput, workingDirectory);
  if (!normalized.ok) {
    return { ok: false, problem: normalized.reason };
  }
  let stats: fs.Stats;
  try {
    stats = fs.statSync(normalized.normalizedPath);
  } catch {
    return { ok: false, problem: 'not-found' };
  }
  if (!stats.isDirectory()) {
    return { ok: false, problem: 'not-a-directory' };
  }
  return { ok: true, normalizedPath: normalized.normalizedPath };
}
