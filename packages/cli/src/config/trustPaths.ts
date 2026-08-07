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
  | 'not-a-directory'
  | 'not-accessible';

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
  // Windows accepts either separator after the tilde; on POSIX a backslash is a
  // legal filename character, so only "/" may introduce a home-relative path.
  const separators =
    process.platform === 'win32' ? ['~/', `~${path.sep}`] : ['~/'];
  const prefix = separators.find((candidate) => value.startsWith(candidate));
  if (prefix !== undefined) {
    return path.join(os.homedir(), value.slice(prefix.length));
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
  // The working directory is resolved too: a relative one would otherwise send
  // path.resolve back to process.cwd() instead of the directory asked for.
  const normalizedPath = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(path.resolve(workingDirectory), expanded);
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
    'not-accessible': 'That folder cannot be read.',
  };

export function getTrustPathProblemMessage(problem: TrustPathProblem): string {
  return TRUST_PATH_PROBLEM_MESSAGES[problem];
}

function describeAccessFailure(
  error: unknown,
  normalizedPath: string,
): TrustPathProblem {
  switch ((error as NodeJS.ErrnoException).code) {
    case 'ENOENT': {
      // Windows reports ENOENT, rather than ENOTDIR, when an existing parent
      // component is a file. Walk upward to distinguish that invalid shape
      // from a genuinely missing path.
      let parent = path.dirname(normalizedPath);
      while (parent !== path.dirname(parent)) {
        try {
          return fs.statSync(parent).isDirectory()
            ? 'not-found'
            : 'not-a-directory';
        } catch {
          parent = path.dirname(parent);
        }
      }
      return 'not-found';
    }
    // A component of the path exists but is a file, so the path shape is wrong
    // rather than the folder missing.
    case 'ENOTDIR':
      return 'not-a-directory';
    default:
      return 'not-accessible';
  }
}

/**
 * Normalizes raw user input and confirms it names an existing directory,
 * returning it under the same canonical identity the trust store uses.
 *
 * Trust rules are persisted under a canonical path, which `LoadedTrustedFolders`
 * derives with `fs.realpathSync`; that throws for a path which does not exist.
 * Validating here lets the dialog report a precise, actionable problem instead
 * of surfacing a commit failure. Canonicalizing here as well keeps the folder
 * the dialog reports identical to the key the rule is stored under, so a
 * symlinked spelling does not read back as a different folder.
 */
export function resolveTrustDirectory(
  rawInput: string,
  workingDirectory: string,
): ResolveTrustDirectoryResult {
  const normalized = normalizeTrustPathInput(rawInput, workingDirectory);
  if (!normalized.ok) {
    return { ok: false, problem: normalized.reason };
  }
  let canonicalPath: string;
  let stats: fs.Stats;
  try {
    canonicalPath = fs.realpathSync(normalized.normalizedPath);
    stats = fs.statSync(canonicalPath);
  } catch (error) {
    // Each failure reports its own problem: telling the user a folder does not
    // exist would send them looking for the wrong thing when the real issue is
    // that it is unreadable, or that a component of the path is a file.
    return {
      ok: false,
      problem: describeAccessFailure(error, normalized.normalizedPath),
    };
  }
  if (!stats.isDirectory()) {
    return { ok: false, problem: 'not-a-directory' };
  }
  return { ok: true, normalizedPath: canonicalPath };
}
