/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { ancestorDirs, type PathChecker } from './bun-path-resolver.js';

export interface ResolveBunEntryOptions {
  readonly moduleDir?: string;
  readonly pathChecker?: PathChecker;
  /**
   * When true (or when `LLXPRT_FORCE_SOURCE_ENTRY=1` is set), resolve the raw
   * TypeScript source entry and nothing else. This is the debugging escape
   * hatch for source checkouts and dev runs.
   *
   * This is a STRICT source-only mode: if the source entry is missing, this
   * returns `null` rather than falling back to the bundle or dist entry.
   * Falling back would defeat the purpose of the flag, whose whole point is to
   * guarantee the bundle is not what runs when you are debugging the bundle.
   */
  readonly forceSourceEntry?: boolean;
}

const CLI_PACKAGE_DIR = 'cli';
const PACKAGES_DIR = 'packages';
const SOURCE_ENTRY = 'index.ts';
const DIST_ENTRY = 'index.js';
const DIST_LAUNCHER_LAYOUT = ['dist', 'src', 'launcher'];
const BUNDLE_DIR = 'bundle';
const BUNDLE_ENTRY = 'llxprt.js';

async function isReadablePath(
  targetPath: string,
  pathChecker: PathChecker,
): Promise<boolean> {
  try {
    return await pathChecker(targetPath);
  } catch {
    return false;
  }
}

/**
 * Walks ancestors of `moduleDir` to find the CLI package directory
 * (`packages/cli`). Returns the absolute path when found, otherwise `null`.
 *
 * Used by source resolution, which must be anchored at the CLI package so it
 * never picks up an unrelated `index.ts`. Bundle resolution deliberately does
 * NOT use this: an installed package has no `packages/cli` path segment, so
 * `resolveBundleEntry` walks every ancestor looking for `bundle/llxprt.js`.
 */
function findCliPackageDir(moduleDir: string): string | null {
  for (const dir of ancestorDirs(moduleDir)) {
    if (
      basename(dir) === CLI_PACKAGE_DIR &&
      basename(dirname(dir)) === PACKAGES_DIR
    ) {
      return dir;
    }
  }
  return null;
}

async function resolveSourceEntry(
  moduleDir: string,
  pathChecker: PathChecker,
): Promise<string | null> {
  const cliDir = findCliPackageDir(moduleDir);
  if (cliDir === null) {
    return null;
  }
  const entry = join(cliDir, SOURCE_ENTRY);
  if (await isReadablePath(entry, pathChecker)) {
    return entry;
  }
  return null;
}

/**
 * Resolves the prebuilt CLI bundle (`<package-root>/bundle/llxprt.js`).
 *
 * The bundle is produced at publish time (issue #2999) so launch-time module
 * resolution of 4,274 files is eliminated. Rather than assuming a specific
 * directory layout (monorepo `packages/cli`, installed raw-TS, or compiled
 * `dist/`), this walks ancestors of `moduleDir` nearest-first and returns the
 * first readable `<ancestor>/bundle/llxprt.js`. The nearest match wins, which
 * is correct across all layouts because `bundle/` only exists in the package
 * root that owns the CLI entry.
 */
async function resolveBundleEntry(
  moduleDir: string,
  pathChecker: PathChecker,
): Promise<string | null> {
  for (const dir of ancestorDirs(moduleDir)) {
    const entry = join(dir, BUNDLE_DIR, BUNDLE_ENTRY);
    if (await isReadablePath(entry, pathChecker)) {
      return entry;
    }
  }
  return null;
}

/**
 * The compiled CLI ships the launcher under a fixed `dist/src/launcher` layout.
 * Anchoring on that exact suffix (rather than a loose `includes('dist')`) avoids
 * misresolving unrelated `dist` directories or path components whose names merely
 * contain the substring "dist" (e.g. "distribution").
 */
function hasDistLauncherLayout(moduleDir: string): boolean {
  const segments = moduleDir.split(/[/\\]/).filter((s) => s.length > 0);
  if (segments.length < DIST_LAUNCHER_LAYOUT.length) {
    return false;
  }
  const tail = segments.slice(-DIST_LAUNCHER_LAYOUT.length);
  // Case-insensitive comparison so Windows path casing does not break matching.
  return tail.every(
    (segment, index) => segment.toLowerCase() === DIST_LAUNCHER_LAYOUT[index],
  );
}

function ascend(dir: string, levels: number): string {
  let result = dir;
  for (let i = 0; i < levels; i++) {
    result = dirname(result);
  }
  return result;
}

async function resolveDistEntry(
  moduleDir: string,
  pathChecker: PathChecker,
): Promise<string | null> {
  if (!hasDistLauncherLayout(moduleDir)) {
    return null;
  }
  // With the dist/src/launcher layout confirmed, the dist root is two
  // levels above moduleDir (launcher -> src -> dist).
  const dir = ascend(moduleDir, DIST_LAUNCHER_LAYOUT.length - 1);
  const entry = join(dir, DIST_ENTRY);
  if (await isReadablePath(entry, pathChecker)) {
    return entry;
  }
  return null;
}

export async function resolveBunEntry(
  options: ResolveBunEntryOptions = {},
): Promise<string | null> {
  const moduleDir =
    options.moduleDir ?? dirname(fileURLToPath(import.meta.url));
  const pathChecker = options.pathChecker ?? defaultPathChecker;
  const forceSource =
    options.forceSourceEntry === true ||
    process.env['LLXPRT_FORCE_SOURCE_ENTRY'] === '1';

  // Entry precedence (issue #2999):
  //   1. force-source flag → raw TypeScript source (debug escape hatch)
  //   2. prebuilt bundle → bundle
  //   3. raw TypeScript source → source
  //   4. compiled dist entry → dist
  // The bundle is preferred because it eliminates per-launch module-graph
  // resolution; the source is retained as a mandatory fallback for source
  // checkouts and dev runs where no bundle exists.
  // Strict source-only: deliberately does NOT fall through to the bundle or
  // dist entry. See the `forceSourceEntry` JSDoc -- silently running the
  // bundle after being told not to would make the escape hatch useless.
  if (forceSource) {
    return resolveSourceEntry(moduleDir, pathChecker);
  }

  const bundleEntry = await resolveBundleEntry(moduleDir, pathChecker);
  if (bundleEntry !== null) {
    return bundleEntry;
  }

  const sourceEntry = await resolveSourceEntry(moduleDir, pathChecker);
  if (sourceEntry !== null) {
    return sourceEntry;
  }

  const distEntry = await resolveDistEntry(moduleDir, pathChecker);
  if (distEntry !== null) {
    return distEntry;
  }

  return null;
}

/**
 * Entry paths are loaded by Bun rather than executed directly, so existence as
 * a file is the correct contract here. The Bun binary resolver uses the same
 * PathChecker type with an executable check because it resolves a process path.
 */
async function defaultPathChecker(targetPath: string): Promise<boolean> {
  try {
    const stats = await stat(targetPath);
    return stats.isFile();
  } catch {
    return false;
  }
}
