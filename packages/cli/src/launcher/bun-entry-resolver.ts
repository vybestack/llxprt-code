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
}

const CLI_PACKAGE_DIR = 'cli';
const PACKAGES_DIR = 'packages';
const SOURCE_ENTRY = 'index.ts';
const DIST_ENTRY = 'index.js';
const BUNDLE_DIR = 'bundle';
const BUNDLE_ENTRY = 'llxprt.js';
const DIST_LAUNCHER_LAYOUT = ['dist', 'src', 'launcher'];

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

async function resolveSourceEntry(
  moduleDir: string,
  pathChecker: PathChecker,
): Promise<string | null> {
  for (const dir of ancestorDirs(moduleDir)) {
    if (
      basename(dir) === CLI_PACKAGE_DIR &&
      basename(dirname(dir)) === PACKAGES_DIR
    ) {
      const entry = join(dir, SOURCE_ENTRY);
      if (await isReadablePath(entry, pathChecker)) {
        return entry;
      }
      break;
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

function resolveDistProjectRoot(moduleDir: string): string | null {
  if (!hasDistLauncherLayout(moduleDir)) {
    return null;
  }
  return ascend(moduleDir, DIST_LAUNCHER_LAYOUT.length);
}

function isCliPackageDir(dir: string): boolean {
  return (
    basename(dir) === CLI_PACKAGE_DIR && basename(dirname(dir)) === PACKAGES_DIR
  );
}

function bundleSearchRoots(moduleDir: string): string[] {
  const roots: string[] = [];
  const distProjectRoot = resolveDistProjectRoot(moduleDir);
  for (const dir of ancestorDirs(moduleDir)) {
    roots.push(dir);
    if (dir === distProjectRoot && !isCliPackageDir(dir)) {
      return roots;
    }
    if (basename(dir) === PACKAGES_DIR) {
      roots.push(dirname(dir));
      return roots;
    }
  }
  return roots;
}

async function resolveBundleEntry(
  moduleDir: string,
  pathChecker: PathChecker,
): Promise<string | null> {
  for (const dir of bundleSearchRoots(moduleDir)) {
    const candidate = join(dir, BUNDLE_DIR, BUNDLE_ENTRY);
    if (await isReadablePath(candidate, pathChecker)) {
      return candidate;
    }
  }
  return null;
}

export async function resolveBunEntry(
  options: ResolveBunEntryOptions = {},
): Promise<string | null> {
  const moduleDir =
    options.moduleDir ?? dirname(fileURLToPath(import.meta.url));
  const pathChecker = options.pathChecker ?? defaultPathChecker;

  const sourceEntry = await resolveSourceEntry(moduleDir, pathChecker);
  if (sourceEntry !== null) {
    return sourceEntry;
  }

  const distEntry = await resolveDistEntry(moduleDir, pathChecker);
  if (distEntry !== null) {
    return distEntry;
  }

  return resolveBundleEntry(moduleDir, pathChecker);
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
