/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const RMRF_OPTIONS = { recursive: true, force: true };

// remove npm install/build artifacts
rmSync(join(root, 'node_modules'), RMRF_OPTIONS);
rmSync(join(root, 'bundle'), RMRF_OPTIONS);
rmSync(join(root, 'packages/cli/src/generated/'), RMRF_OPTIONS);
rmSync(join(root, '.stryker-tmp'), RMRF_OPTIONS);

// Dynamically clean dist directories in all workspaces
const rootPackageJson = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf-8'),
);
for (const workspace of rootPackageJson.workspaces) {
  // Note: this is a simple glob implementation that only supports "packages/*".
  const workspaceDir = join(root, dirname(workspace));
  let packageDirs;
  try {
    packageDirs = readdirSync(workspaceDir);
  } catch (e) {
    if (e.code === 'ENOENT') {
      continue;
    }
    throw e;
  }

  for (const pkg of packageDirs) {
    const pkgDir = join(workspaceDir, pkg);
    try {
      if (statSync(pkgDir).isDirectory()) {
        rmSync(join(pkgDir, 'dist'), RMRF_OPTIONS);
      }
    } catch (e) {
      if (e.code !== 'ENOENT') {
        throw e;
      }
    }
  }
}

// Helper function to find directories matching a pattern recursively
function findDirsRecursive(dir, predicate, results = []) {
  let entries;
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
} catch (e) {
  if (e.code !== 'ENOENT') {
    throw e;
  }
}
