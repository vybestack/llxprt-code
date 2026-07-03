/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RmOptions, Dirent } from 'node:fs';
import { isErrnoException } from './utils/error-guards.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const RMRF_OPTIONS: RmOptions = { recursive: true, force: true };

interface WorkspacePackageJson {
  workspaces: string[];
}

// remove npm install/build artifacts
rmSync(join(root, 'node_modules'), RMRF_OPTIONS);
rmSync(join(root, 'packages/cli/src/generated/'), RMRF_OPTIONS);
rmSync(join(root, '.stryker-tmp'), RMRF_OPTIONS);

// Dynamically clean dist directories in all workspaces
const rootPackageJson = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf-8'),
) as WorkspacePackageJson;
for (const workspace of rootPackageJson.workspaces) {
  // Note: this is a simple glob implementation that only supports "packages/*".
  const workspaceDir = join(root, dirname(workspace));
  let packageDirs: string[];
  try {
    packageDirs = readdirSync(workspaceDir);
  } catch (e: unknown) {
    if (isErrnoException(e, 'ENOENT')) {
      continue;
    }
    throw e;
  }

  for (const pkg of packageDirs) {
    cleanPackageDistDir(join(workspaceDir, pkg));
  }
}

function cleanPackageDistDir(pkgDir: string): void {
  try {
    if (statSync(pkgDir).isDirectory()) {
      rmSync(join(pkgDir, 'dist'), RMRF_OPTIONS);
    }
  } catch (e: unknown) {
    if (!isErrnoException(e, 'ENOENT')) {
      throw e;
    }
  }
}

// Helper function to find directories matching a pattern recursively
function findDirsRecursive(
  dir: string,
  predicate: (name: string) => boolean,
  results: string[] = [],
): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (predicate(entry.name)) {
        results.push(fullPath);
      }
      findDirsRecursive(fullPath, predicate, results);
    }
  }
  return results;
}

// Clean Stryker sandboxes that may remain after aborted runs
const strayStrykerDirs = findDirsRecursive(
  root,
  (name) => name === '.stryker-tmp',
);
for (const dir of strayStrykerDirs) {
  rmSync(dir, RMRF_OPTIONS);
}

// Clean up vscode-ide-companion package
rmSync(join(root, 'packages/vscode-ide-companion/node_modules'), RMRF_OPTIONS);

const vscodeCompanionDir = join(root, 'packages/vscode-ide-companion');
try {
  const files = readdirSync(vscodeCompanionDir);
  for (const file of files) {
    if (file.endsWith('.vsix')) {
      rmSync(join(vscodeCompanionDir, file), RMRF_OPTIONS);
    }
  }
} catch (e: unknown) {
  if (!isErrnoException(e, 'ENOENT')) {
    throw e;
  }
}
