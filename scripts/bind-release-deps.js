/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BACKUP_SUFFIX = '.bind-backup';

const NON_NPM_RELEASE_PACKAGES = new Set([
  '@vybestack/llxprt-code-test-utils',
  '@vybestack/llxprt-code-a2a-server',
  'llxprt-code-vscode-ide-companion',
]);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function getWorkspacePaths() {
  const rootPkg = readJson(join(ROOT, 'package.json'));
  return rootPkg.workspaces || [];
}

export function deriveNpmReleasePackages() {
  return getWorkspacePaths().flatMap((workspacePath) => {
    const pkgJsonPath = join(ROOT, workspacePath, 'package.json');
    if (!existsSync(pkgJsonPath)) {
      return [];
    }

    const pkg = readJson(pkgJsonPath);
    if (pkg.private || NON_NPM_RELEASE_PACKAGES.has(pkg.name)) {
      return [];
    }

    return [pkg.name];
  });
}

export function getWorkspaceInfo() {
  const info = new Map();

  for (const workspacePath of getWorkspacePaths()) {
    const pkgJsonPath = join(ROOT, workspacePath, 'package.json');
    if (!existsSync(pkgJsonPath)) {
      continue;
    }

    const pkg = readJson(pkgJsonPath);
    info.set(pkg.name, {
      pkgJsonPath,
      version: pkg.version,
      workspacePath,
    });
  }

  return info;
}

export function rewriteDeps(deps, workspaceInfo, npmReleasePackageSet) {
  if (!deps) {
    return false;
  }

  let changed = false;
  for (const [depName, version] of Object.entries(deps)) {
    if (
      typeof version !== 'string' ||
      !version.startsWith('file:') ||
      !npmReleasePackageSet.has(depName)
    ) {
      continue;
    }

    const dependencyWorkspace = workspaceInfo.get(depName);
    if (!dependencyWorkspace) {
      continue;
    }

    deps[depName] = dependencyWorkspace.version;
    changed = true;
  }

  return changed;
}

export function verifyNoFileDeps(
  workspaces,
  npmReleasePackageSet,
  packagesByPath,
) {
  const violations = [];

  for (const workspacePath of workspaces) {
    const pkgJsonPath = join(ROOT, workspacePath, 'package.json');
    if (!existsSync(pkgJsonPath)) {
      continue;
    }

    const pkg = packagesByPath?.get(workspacePath) ?? readJson(pkgJsonPath);
    if (!npmReleasePackageSet.has(pkg.name)) {
      continue;
    }

    for (const depField of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      const deps = pkg[depField];
      if (!deps) {
        continue;
      }

      for (const [depName, version] of Object.entries(deps)) {
        if (
          typeof version === 'string' &&
          version.startsWith('file:') &&
          npmReleasePackageSet.has(depName)
        ) {
          violations.push(`${pkg.name} ${depField}.${depName}=${version}`);
        }
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Publishable packages still contain workspace file: dependencies:\n${violations.join('\n')}`,
    );
  }
}

export function bindReleaseDeps({ dryRun = false, backup = false } = {}) {
  const npmReleasePackages = deriveNpmReleasePackages();
  const npmReleasePackageSet = new Set(npmReleasePackages);
  const workspaceInfo = getWorkspaceInfo();
  const workspacePaths = getWorkspacePaths();
  const packagesByPath = new Map();
  let totalChanges = 0;

  console.log('NPM release packages:', npmReleasePackages.join(', '));

  for (const workspacePath of workspacePaths) {
    const pkgJsonPath = join(ROOT, workspacePath, 'package.json');
    if (!existsSync(pkgJsonPath)) {
      continue;
    }

    const pkg = readJson(pkgJsonPath);
    if (!npmReleasePackageSet.has(pkg.name)) {
      continue;
    }

    let changed = false;
    for (const depField of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      changed =
        rewriteDeps(pkg[depField], workspaceInfo, npmReleasePackageSet) ||
        changed;
    }

    if (!changed) {
      continue;
    }

    totalChanges++;
    packagesByPath.set(workspacePath, pkg);
    console.log(`  Rewrote workspace deps in ${pkg.name}`);

    if (dryRun) {
      continue;
    }

    if (backup) {
      const backupPath = pkgJsonPath + BACKUP_SUFFIX;
      if (!existsSync(backupPath)) {
        writeFileSync(backupPath, readFileSync(pkgJsonPath));
      }
    }
    writeJson(pkgJsonPath, pkg);
  }

  if (!dryRun && totalChanges > 0) {
    const lockPath = join(ROOT, 'package-lock.json');
    if (backup && existsSync(lockPath)) {
      const lockBackupPath = lockPath + BACKUP_SUFFIX;
      if (!existsSync(lockBackupPath)) {
        writeFileSync(lockBackupPath, readFileSync(lockPath));
      }
    }

    console.log('Updating package-lock.json...');
    execSync('npm install --package-lock-only --ignore-scripts', {
      cwd: ROOT,
      stdio: 'inherit',
    });
  }

  verifyNoFileDeps(workspacePaths, npmReleasePackageSet, packagesByPath);
  console.log(
    'Verification passed: no workspace file: deps in NPM release packages.',
  );

  return totalChanges;
}

export function restoreReleaseDeps({ dryRun = false } = {}) {
  let restored = 0;

  for (const workspacePath of getWorkspacePaths()) {
    const pkgJsonPath = join(ROOT, workspacePath, 'package.json');
    const backupPath = pkgJsonPath + BACKUP_SUFFIX;
    if (!existsSync(backupPath)) {
      continue;
    }

    if (!dryRun) {
      writeFileSync(pkgJsonPath, readFileSync(backupPath));
      unlinkSync(backupPath);
    }
    console.log(`  Restored ${workspacePath}/package.json`);
    restored++;
  }

  const lockPath = join(ROOT, 'package-lock.json');
  const lockBackupPath = lockPath + BACKUP_SUFFIX;
  if (existsSync(lockBackupPath)) {
    if (!dryRun) {
      writeFileSync(lockPath, readFileSync(lockBackupPath));
      unlinkSync(lockBackupPath);
    }
    console.log('  Restored package-lock.json');
    restored++;
  }

  if (restored === 0) {
    console.log('No backups found to restore.');
  } else {
    console.log(`Restored ${restored} file(s).`);
  }

  return restored;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  if (args.includes('--restore')) {
    restoreReleaseDeps({ dryRun });
    return;
  }

  bindReleaseDeps({ dryRun, backup: args.includes('--backup') });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
