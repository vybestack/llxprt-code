/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  readFileSync,
  readdirSync,
  lstatSync,
  statSync,
  realpathSync,
  type Dirent,
} from 'node:fs';
import {
  join,
  resolve,
  dirname,
  normalize,
  relative,
  isAbsolute,
} from 'node:path';

/**
 * Error thrown when an expected root directory is missing or unreadable.
 * This is a hard failure (fail-fast) — not a defensive swallow.
 */
export class RootMissingError extends Error {
  constructor(
    readonly rootPath: string,
    message: string,
  ) {
    super(message);
    this.name = 'RootMissingError';
  }
}

/**
 * Recursively collect all Markdown files under the given roots.
 *
 * Each root must exist and be readable — a missing/unreadable expected root
 * is a hard failure (RootMissingError). Optional nested subdirectories that
 * happen to be absent are tolerated (return empty, no error).
 *
 * Symlink policy: symlinks are resolved to their real path. Symlinked
 * directories are followed (so links inside them ARE validated). The `seen`
 * set tracks real paths to prevent infinite loops from symlink cycles.
 * Per-root `seen` sets ensure nested/overlapping roots each contribute files.
 */
export function collectMarkdownFiles(
  roots: readonly string[],
): readonly string[] {
  const result: string[] = [];
  for (const root of roots) {
    // Each root gets its own seen-set so nested/overlapping roots
    // each contribute their files.
    const seen = new Set<string>();
    const resolvedRoot = resolve(root);
    assertRootExists(resolvedRoot);
    walkDir(resolvedRoot, result, seen);
  }
  return result;
}

/**
 * Collect Markdown files sitting directly in the repository root
 * (README.md, CONTRIBUTING.md, ...). These live outside docs/ and dev-docs/
 * but routinely link into them, so their links need validating too.
 * Deliberately non-recursive: nested trees are covered by collectMarkdownFiles.
 */
export function collectRootMarkdownFiles(root: string): readonly string[] {
  const resolvedRoot = resolve(root);
  let entries: Dirent[];
  try {
    entries = readdirSync(resolvedRoot, { withFileTypes: true });
  } catch (error) {
    throw new RootMissingError(
      resolvedRoot,
      `Repository root is not readable: ${resolvedRoot} — ${errorMessage(error)}`,
    );
  }
  return entries
    .filter((entry) => entry.isFile() && isMarkdown(entry.name))
    .map((entry) => join(resolvedRoot, entry.name));
}

function walkDir(dir: string, out: string[], seen: Set<string>): void {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    processEntry(entry, dir, out, seen);
  }
}

function processEntry(
  entry: Dirent,
  dir: string,
  out: string[],
  seen: Set<string>,
): void {
  if (shouldPrune(entry.name)) return;
  const full = join(dir, entry.name);
  if (entry.isSymbolicLink()) {
    processSymlink(full, out, seen);
  } else if (entry.isDirectory()) {
    processDirectory(full, out, seen);
  } else if (entry.isFile() && isMarkdown(entry.name)) {
    out.push(full);
  }
}

function processSymlink(full: string, out: string[], seen: Set<string>): void {
  const realFull = safeRealpath(full);
  if (realFull === undefined) return; // broken symlink — skip
  if (seen.has(realFull)) return; // cycle protection
  seen.add(realFull);
  try {
    const stat = lstatSync(realFull);
    if (stat.isDirectory()) {
      walkDir(realFull, out, seen);
    } else if (stat.isFile() && isMarkdown(realFull)) {
      out.push(full);
    }
  } catch {
    // broken or unreadable symlink target — skip
  }
}

function processDirectory(
  full: string,
  out: string[],
  seen: Set<string>,
): void {
  const realFull = safeRealpath(full) ?? full;
  if (seen.has(realFull)) return;
  seen.add(realFull);
  walkDir(full, out, seen);
}

function safeRealpath(p: string): string | undefined {
  try {
    return realpathSync(p);
  } catch {
    return undefined;
  }
}

function isMarkdown(name: string): boolean {
  return name.toLowerCase().endsWith('.md');
}

const PRUNE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'bundle',
  'coverage',
  '.integration-tests',
]);

function shouldPrune(name: string): boolean {
  return PRUNE_DIRS.has(name);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Assert that a root directory exists and is readable. Throws RootMissingError
 * if it does not (fail-fast, not defensive swallow).
 *
 * Uses statSync (follows symlinks) so that a root that is itself a
 * symlink-to-directory is accepted, consistent with the module's
 * documented symlink-following policy.
 */
function assertRootExists(rootPath: string): void {
  try {
    const stat = statSync(rootPath);
    if (!stat.isDirectory()) {
      throw new RootMissingError(
        rootPath,
        `Expected root is not a directory: ${rootPath}`,
      );
    }
  } catch (error) {
    if (error instanceof RootMissingError) throw error;
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new RootMissingError(
        rootPath,
        `Expected root directory does not exist: ${rootPath}`,
      );
    }
    if (err.code === 'EACCES') {
      throw new RootMissingError(
        rootPath,
        `Expected root directory is not readable: ${rootPath}`,
      );
    }
    throw new RootMissingError(
      rootPath,
      `Cannot access expected root directory ${rootPath}: ${errorMessage(error)}`,
    );
  }
}

/**
 * Read a file's content as UTF-8 text.
 *
 * Intentionally fails fast: any read error propagates. Callers have already
 * established that the path is a readable file, so a failure here indicates an
 * environment fault (permissions, a file removed mid-scan, a full disk) rather
 * than a documentation defect. Reporting it as a validation failure would
 * misattribute the cause, so it surfaces as a crash with a non-zero exit.
 */
export function readFileText(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

const EXTERNAL_PREFIXES = ['http://', 'https://', 'mailto:'] as const;

/**
 * Resolve a link target relative to the containing file. Handles ../,
 * percent-encoding, and returns the absolute path to check.
 *
 * Returns undefined for fragment-only targets (#section), absolute URLs
 * (http://, https://, mailto:), and empty targets.
 */
export function resolveTarget(
  fromFile: string,
  target: string,
): string | undefined {
  const decoded = safeDecode(target);
  if (decoded === '' || decoded.startsWith('#')) return undefined;
  if (EXTERNAL_PREFIXES.some((prefix) => decoded.startsWith(prefix))) {
    return undefined;
  }
  const baseDir = dirname(fromFile);
  return normalize(join(baseDir, decoded));
}

function safeDecode(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/**
 * Check whether a resolved target path stays within the repository root.
 * Links that escape via ../../ are rejected (containment check).
 */
export function isWithinRoot(absTarget: string, root: string): boolean {
  const rel = relative(root, absTarget);
  return !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Check whether a path exists and is a regular file (not a directory).
 * Follows symlinks so a symlink pointing to a real file reports true.
 */
export function isFile(absPath: string): boolean {
  try {
    return statSync(absPath).isFile();
  } catch {
    return false;
  }
}

/**
 * Check whether a path exists and is a directory.
 * Follows symlinks so a symlink pointing to a real directory reports true.
 */
export function isDirectory(absPath: string): boolean {
  try {
    return statSync(absPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Check whether a path exists (file, directory, or any asset).
 * Follows symlinks.
 */
export function pathExists(absPath: string): boolean {
  try {
    statSync(absPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether a directory path contains an index.md or README.md.
 */
export function dirHasIndex(absPath: string): boolean {
  return (
    isFile(join(absPath, 'index.md')) || isFile(join(absPath, 'README.md'))
  );
}

/**
 * Resolve the canonical index file for a directory (index.md preferred,
 * README.md as fallback). Returns the absolute path to whichever exists,
 * or undefined if neither exists.
 */
export function resolveIndexFile(absPath: string): string | undefined {
  if (isFile(join(absPath, 'index.md'))) {
    return join(absPath, 'index.md');
  }
  if (isFile(join(absPath, 'README.md'))) {
    return join(absPath, 'README.md');
  }
  return undefined;
}
