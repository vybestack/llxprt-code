/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { isErrnoException, messageOf } from './utils/error-guards.ts';
import { NON_NPM_RELEASE_PACKAGES } from './utils/release-packages.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_LOCKFILE_TIMEOUT_MS = 300_000;
const MIN_LOCKFILE_TIMEOUT_MS = 10_000;
const MAX_LOCKFILE_TIMEOUT_MS = 1_800_000;
const BACKUP_SUFFIX = '.bind-backup';

const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

type DependencyField = (typeof DEP_FIELDS)[number];
type DependencyMap = Record<string, unknown>;

type PackageJson = {
  name?: string;
  version?: string;
  private?: boolean;
  workspaces?: unknown;
  [key: string]: unknown;
} & Partial<Record<DependencyField, DependencyMap>>;

interface WorkspaceInfo {
  pkgJsonPath: string;
  version: string;
  workspacePath: string;
}

interface RollbackFile {
  content: Buffer;
}

interface ProcessOptions {
  dryRun: boolean;
  rollbackFiles: Map<string, RollbackFile>;
}

interface BindOptions {
  dryRun?: boolean;
  backup?: boolean;
}

interface RestoreOptions {
  dryRun?: boolean;
}

function readJson(filePath: string): PackageJson {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as PackageJson;
}
function atomicWriteFile(filePath: string, content: string | Buffer): void {
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmpPath, content, { flag: 'wx' });
  } catch (error) {
    removeTempFileIfPresent(tmpPath);
    throw error;
  }
  try {
    renameSync(tmpPath, filePath);
  } catch (error) {
    removeTempFileIfPresent(tmpPath);
    throw error;
  }
}

// Package manifests are generated from parsed JSON so release dependency
// rewrites are deterministic across the workspace.
function writeJson(filePath: string, data: unknown): void {
  atomicWriteFile(filePath, JSON.stringify(data, null, 2) + '\n');
}

function createBackup(backupPath: string, content: Buffer): boolean {
  try {
    writeFileSync(backupPath, content, { flag: 'wx' });
    return true;
  } catch (error) {
    if (isErrnoException(error, 'EEXIST')) {
      return false;
    }
    throw error;
  }
}

function getWorkspacePaths(): string[] {
  const rootPkg = readJson(join(ROOT, 'package.json'));
  const workspacePaths = workspacePathsFromConfig(rootPkg.workspaces);
  const globWorkspaces = workspacePaths.filter((workspace) =>
    workspace.includes('*'),
  );
  if (globWorkspaces.length > 0) {
    throw new Error(
      `Glob workspace patterns are not supported by this release binder: ${globWorkspaces.join(', ')}. Please use explicit workspace paths in the root package.json.`,
    );
  }
  return workspacePaths;
}

function workspacePathsFromConfig(workspaces: unknown): string[] {
  if (Array.isArray(workspaces)) {
    return workspaces.filter(
      (workspace): workspace is string => typeof workspace === 'string',
    );
  }
  if (isWorkspacePackageObject(workspaces)) {
    return workspaces.packages.filter(
      (workspace): workspace is string => typeof workspace === 'string',
    );
  }
  if (workspaces !== undefined) {
    console.warn(
      'Warning: unrecognized workspaces format in root package.json',
    );
  }
  return [];
}

function isWorkspacePackageObject(
  workspaces: unknown,
): workspaces is { packages: unknown[] } {
  if (typeof workspaces !== 'object' || workspaces === null) {
    return false;
  }
  return Array.isArray((workspaces as { packages?: unknown }).packages);
}

export function deriveNpmReleasePackages(): string[] {
  return deriveNpmReleasePackagesFromPaths(getWorkspacePaths());
}

function deriveNpmReleasePackagesFromPaths(
  workspacePaths: readonly string[],
): string[] {
  return workspacePaths.flatMap((workspacePath) => {
    const pkgJsonPath = join(ROOT, workspacePath, 'package.json');
    if (!existsSync(pkgJsonPath)) {
      return [];
    }

    const pkg = readJson(pkgJsonPath);
    if (
      typeof pkg.name !== 'string' ||
      pkg.private === true ||
      NON_NPM_RELEASE_PACKAGES.has(pkg.name)
    ) {
      return [];
    }

    return [pkg.name];
  });
}

export function getWorkspaceInfo(
  workspacePaths: readonly string[] = getWorkspacePaths(),
): Map<string, WorkspaceInfo> {
  const info = new Map<string, WorkspaceInfo>();

  for (const workspacePath of workspacePaths) {
    const workspaceInfo = readWorkspaceInfo(workspacePath);
    if (workspaceInfo !== null) {
      info.set(workspaceInfo.name, workspaceInfo);
    }
  }

  return info;
}

function readWorkspaceInfo(
  workspacePath: string,
): (WorkspaceInfo & { name: string }) | null {
  const pkgJsonPath = join(ROOT, workspacePath, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    return null;
  }

  const pkg = readJson(pkgJsonPath);
  if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') {
    return null;
  }

  return {
    name: pkg.name,
    pkgJsonPath,
    version: pkg.version,
    workspacePath,
  };
}

// Mutates the provided dependency map in place; callers pass package JSON objects they own.
export function rewriteDeps(
  deps: DependencyMap | undefined,
  workspaceInfo: ReadonlyMap<string, WorkspaceInfo>,
  npmReleasePackageSet: ReadonlySet<string>,
): boolean {
  if (deps === undefined) {
    return false;
  }

  let changed = false;
  for (const [depName, version] of Object.entries(deps)) {
    const dependencyWorkspace = shouldRewriteDep(
      version,
      depName,
      workspaceInfo,
      npmReleasePackageSet,
    );
    if (dependencyWorkspace === null) {
      continue;
    }

    deps[depName] = dependencyWorkspace.version;
    changed = true;
  }

  return changed;
}

function shouldRewriteDep(
  version: unknown,
  depName: string,
  workspaceInfo: ReadonlyMap<string, WorkspaceInfo>,
  npmReleasePackageSet: ReadonlySet<string>,
): WorkspaceInfo | null {
  if (typeof version !== 'string' || !version.startsWith('file:')) {
    return null;
  }

  const info = workspaceInfo.get(depName);
  if (info === undefined) {
    console.warn(
      `Warning: file: dependency "${depName}" is not a known workspace package; skipping rewrite.`,
    );
    return null;
  }
  if (!npmReleasePackageSet.has(depName)) {
    const reason = NON_NPM_RELEASE_PACKAGES.has(depName)
      ? 'is a non-NPM workspace package and must remain in devDependencies only'
      : 'is not published by the release pipeline';
    console.warn(
      `Warning: file: dependency "${depName}" ${reason}; skipping rewrite.`,
    );
    return null;
  }

  return info;
}

function processWorkspaceForBinding(
  workspacePath: string,
  workspaceInfo: ReadonlyMap<string, WorkspaceInfo>,
  npmReleasePackageSet: ReadonlySet<string>,
  options: ProcessOptions,
): { changed: boolean } {
  const pkgJsonPath = join(ROOT, workspacePath, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    return { changed: false };
  }

  const pkg = readJson(pkgJsonPath);
  if (typeof pkg.name !== 'string' || !npmReleasePackageSet.has(pkg.name)) {
    return { changed: false };
  }

  let changed = false;
  for (const depField of DEP_FIELDS) {
    changed =
      rewriteDeps(pkg[depField], workspaceInfo, npmReleasePackageSet) ||
      changed;
  }

  if (!changed) {
    return { changed: false };
  }

  if (options.dryRun) {
    console.log(`  [dry-run] Would rewrite workspace deps in ${pkg.name}`);
    return { changed: true };
  }

  console.log(`  Rewrote workspace deps in ${pkg.name}`);
  writeBoundPackageJson(pkgJsonPath, pkg, options.rollbackFiles);
  return { changed: true };
}

function writeBoundPackageJson(
  pkgJsonPath: string,
  pkg: PackageJson,
  rollbackFiles: Map<string, RollbackFile>,
): void {
  const original = readFileSync(pkgJsonPath);
  const backupPath = pkgJsonPath + BACKUP_SUFFIX;
  const createdBackup = createBackup(backupPath, original);
  if (!createdBackup) {
    throw new Error(
      `Stale backup already exists at ${backupPath}. Run --restore before binding again, or remove it manually.`,
    );
  }
  rollbackFiles.set(pkgJsonPath, {
    content: original,
  });

  try {
    writeJson(pkgJsonPath, pkg);
  } catch (error) {
    rollbackFiles.delete(pkgJsonPath);
    removeOwnedBackup(pkgJsonPath);
    throw error;
  }
}

export function verifyNoFileDeps(
  workspaces: readonly string[],
  npmReleasePackageSet: ReadonlySet<string>,
  workspaceInfo: ReadonlyMap<string, WorkspaceInfo>,
  readPackage: (pkgJsonPath: string) => PackageJson = readJson,
): void {
  const violations: string[] = [];

  for (const workspacePath of workspaces) {
    const pkgJsonPath = join(ROOT, workspacePath, 'package.json');
    if (!existsSync(pkgJsonPath)) {
      continue;
    }

    const pkg = readPackage(pkgJsonPath);
    if (typeof pkg.name === 'string' && npmReleasePackageSet.has(pkg.name)) {
      collectFileDepViolations(
        pkg,
        violations,
        npmReleasePackageSet,
        workspaceInfo,
      );
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Publishable packages still contain workspace file: dependencies:\n${violations.join('\n')}`,
    );
  }
}

function collectFileDepViolations(
  pkg: PackageJson,
  violations: string[],
  npmReleasePackageSet: ReadonlySet<string>,
  workspaceInfo: ReadonlyMap<string, WorkspaceInfo>,
): void {
  for (const depField of DEP_FIELDS) {
    const deps = pkg[depField];
    if (deps === undefined) {
      continue;
    }
    for (const [depName, version] of Object.entries(deps)) {
      if (
        isUnboundWorkspaceDep(
          depField,
          depName,
          version,
          npmReleasePackageSet,
          workspaceInfo,
        )
      ) {
        violations.push(`${pkg.name} ${depField}.${depName}=${version}`);
      }
    }
  }
}

function isUnboundWorkspaceDep(
  depField: DependencyField,
  depName: string,
  version: unknown,
  npmReleasePackageSet: ReadonlySet<string>,
  workspaceInfo: ReadonlyMap<string, WorkspaceInfo>,
): boolean {
  if (typeof version !== 'string' || !version.startsWith('file:')) {
    return false;
  }
  if (!workspaceInfo.has(depName)) {
    return false;
  }
  if (NON_NPM_RELEASE_PACKAGES.has(depName)) {
    return depField !== 'devDependencies';
  }
  return !npmReleasePackageSet.has(depName);
}

function backupLockfileForBinding(
  rollbackFiles: Map<string, RollbackFile>,
): void {
  const lockPath = join(ROOT, 'package-lock.json');
  if (!existsSync(lockPath)) {
    return;
  }

  const originalLockfile = readFileSync(lockPath);
  const lockBackupPath = lockPath + BACKUP_SUFFIX;
  const createdBackup = createBackup(lockBackupPath, originalLockfile);
  if (!createdBackup) {
    throw new Error(
      `Stale backup already exists at ${lockBackupPath}. Run --restore before binding again, or remove it manually.`,
    );
  }
  rollbackFiles.set(lockPath, {
    content: originalLockfile,
  });
}

function registerRollbackSignalHandlers(
  dryRun: boolean,
  rollbackFiles: Map<string, RollbackFile>,
  backup: boolean,
): () => void {
  if (dryRun) {
    return () => undefined;
  }
  let isRollingBack = false;
  const signalHandler = () => {
    let exitCode = 130;
    if (rollbackFiles.size > 0 && !isRollingBack) {
      isRollingBack = true;
      process.removeListener('SIGINT', signalHandler);
      process.removeListener('SIGTERM', signalHandler);
      console.error('\nInterrupted; rolling back release dependency bind.');
      try {
        restoreRollbackFiles(rollbackFiles, { preserveBackups: backup });
      } catch (error) {
        console.error(`Rollback after interrupt failed: ${messageOf(error)}`);
        exitCode = 1;
      }
    }
    process.exit(exitCode);
  };
  process.once('SIGINT', signalHandler);
  process.once('SIGTERM', signalHandler);
  return () => {
    process.off('SIGINT', signalHandler);
    process.off('SIGTERM', signalHandler);
  };
}

function updateLockfileAfterBinding(
  rollbackFiles: Map<string, RollbackFile>,
  backup: boolean,
): void {
  try {
    backupLockfileForBinding(rollbackFiles);
  } catch (error) {
    console.error('Failed to back up lockfile; rolling back changes.');
    restoreRollbackFiles(rollbackFiles, { preserveBackups: backup });
    throw error;
  }

  console.log('Updating package-lock.json...');
  try {
    const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const rawTimeout = parseInt(process.env.BIND_LOCKFILE_TIMEOUT_MS ?? '', 10);
    const lockfileTimeout =
      Number.isInteger(rawTimeout) && rawTimeout >= MIN_LOCKFILE_TIMEOUT_MS
        ? Math.min(rawTimeout, MAX_LOCKFILE_TIMEOUT_MS)
        : DEFAULT_LOCKFILE_TIMEOUT_MS;
    const result = spawnSync(
      npmBin,
      ['install', '--package-lock-only', '--ignore-scripts'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: lockfileTimeout,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    if (result.error !== undefined) {
      if (isErrnoException(result.error, 'ETIMEDOUT')) {
        throw new Error(
          `npm install timed out after ${lockfileTimeout}ms. Increase BIND_LOCKFILE_TIMEOUT_MS if needed.`,
        );
      }
      throw new Error(
        `Failed to execute ${npmBin}: ${messageOf(result.error)}. Ensure npm is installed and available on PATH.`,
      );
    }
    if (result.signal !== null) {
      throw new Error(`npm install was terminated by signal ${result.signal}`);
    }
    if (result.status === null) {
      throw new Error('npm install exited without a status code.');
    }
    if (result.status !== 0) {
      const stdout = (result.stdout ?? '').trim();
      const stderr = (result.stderr ?? '').trim();
      const details = [stdout, stderr].filter((text) => text.length > 0);
      const suffix = details.length > 0 ? `: ${details.join('\n')}` : '';
      throw new Error(
        `npm install exited with status ${result.status}${suffix}`,
      );
    }
  } catch (error) {
    console.error('Failed to update package-lock.json after binding deps.');
    restoreRollbackFiles(rollbackFiles, { preserveBackups: backup });
    throw error;
  }
}

function verifyBindingOrRollback(
  workspacePaths: readonly string[],
  npmReleasePackageSet: ReadonlySet<string>,
  workspaceInfo: ReadonlyMap<string, WorkspaceInfo>,
  rollbackFiles: Map<string, RollbackFile>,
  backup: boolean,
): void {
  try {
    verifyNoFileDeps(workspacePaths, npmReleasePackageSet, workspaceInfo);
    console.log(
      'Verification passed: no workspace file: deps in NPM release packages.',
    );
    if (backup) {
      console.log('Backups retained for --restore.');
      return;
    }
    cleanupRollbackBackups(rollbackFiles);
  } catch (error) {
    console.error('Verification failed; rolling back release dependency bind.');
    restoreRollbackFiles(rollbackFiles, { preserveBackups: backup });
    throw error;
  }
}

function bindWorkspaces(
  workspacePaths: readonly string[],
  workspaceInfo: ReadonlyMap<string, WorkspaceInfo>,
  npmReleasePackageSet: ReadonlySet<string>,
  options: ProcessOptions,
): number {
  return workspacePaths.reduce((changes, workspacePath) => {
    const result = processWorkspaceForBinding(
      workspacePath,
      workspaceInfo,
      npmReleasePackageSet,
      options,
    );
    return result.changed ? changes + 1 : changes;
  }, 0);
}

export function bindReleaseDeps({
  dryRun = false,
  backup = false,
}: BindOptions = {}): number {
  const workspacePaths = getWorkspacePaths();
  const npmReleasePackages = deriveNpmReleasePackagesFromPaths(workspacePaths);
  const npmReleasePackageSet = new Set(npmReleasePackages);
  const workspaceInfo = getWorkspaceInfo(workspacePaths);
  const rollbackFiles = new Map<string, RollbackFile>();
  let totalChanges = 0;

  console.log('NPM release packages:', npmReleasePackages.join(', '));

  const unregisterSignalHandlers = registerRollbackSignalHandlers(
    dryRun,
    rollbackFiles,
    backup,
  );

  try {
    try {
      totalChanges = bindWorkspaces(
        workspacePaths,
        workspaceInfo,
        npmReleasePackageSet,
        { dryRun, rollbackFiles },
      );
    } catch (error) {
      console.error('Error during dependency binding; rolling back changes.');
      restoreRollbackFiles(rollbackFiles, { preserveBackups: backup });
      throw error;
    }

    if (!dryRun && totalChanges > 0) {
      updateLockfileAfterBinding(rollbackFiles, backup);
    }

    if (dryRun) {
      console.log('Dry run complete; no files were written.');
      console.warn('Warning: verification skipped in dry-run mode.');
    } else if (totalChanges > 0) {
      verifyBindingOrRollback(
        workspacePaths,
        npmReleasePackageSet,
        workspaceInfo,
        rollbackFiles,
        backup,
      );
    } else {
      verifyNoFileDeps(workspacePaths, npmReleasePackageSet, workspaceInfo);
      console.log('No workspace deps needed rewriting; verification passed.');
    }

    rollbackFiles.clear();

    return totalChanges;
  } finally {
    unregisterSignalHandlers();
  }
}

function restoreRollbackFiles(
  rollbackFiles: Map<string, RollbackFile>,
  options: { preserveBackups: boolean },
): void {
  if (rollbackFiles.size === 0) {
    return;
  }

  console.error('Restoring files changed before the failure...');
  const errors: Error[] = [];
  for (const [filePath, rollbackFile] of rollbackFiles) {
    const error = restoreRollbackFile(filePath, rollbackFile, options);
    if (error !== null) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `Failed to restore ${errors.length} file(s): ${errors.map((error) => error.message).join('; ')}`,
    );
  }
  rollbackFiles.clear();
}

function cleanupRollbackBackups(
  rollbackFiles: ReadonlyMap<string, RollbackFile>,
): void {
  for (const filePath of rollbackFiles.keys()) {
    try {
      removeOwnedBackup(filePath);
    } catch (error) {
      console.warn(
        `Failed to remove backup for ${filePath}: ${messageOf(error)}`,
      );
    }
  }
}

function restoreRollbackFile(
  filePath: string,
  rollbackFile: RollbackFile,
  options: { preserveBackups: boolean },
): Error | null {
  try {
    atomicWriteFile(filePath, rollbackFile.content);
  } catch (error) {
    const message = messageOf(error);
    const backupPath = filePath + BACKUP_SUFFIX;
    console.error(`Failed to restore ${filePath}: ${message}`);
    console.error(
      `Persistent backup may still exist at ${backupPath}; run with --restore to retry.`,
    );
    return new Error(message, { cause: error });
  }
  if (options.preserveBackups) {
    return null;
  }

  try {
    removeOwnedBackup(filePath);
  } catch (error) {
    console.warn(
      `Restored ${filePath} but failed to remove backup: ${messageOf(error)}`,
    );
  }

  return null;
}

function removeTempFileIfPresent(tmpPath: string): void {
  try {
    unlinkSync(tmpPath);
  } catch (error) {
    if (!isErrnoException(error, 'ENOENT')) {
      console.warn(
        `Best-effort cleanup of ${tmpPath} failed: ${messageOf(error)}`,
      );
    }
  }
}

function removeOwnedBackup(filePath: string): void {
  const backupPath = filePath + BACKUP_SUFFIX;
  try {
    unlinkSync(backupPath);
  } catch (error) {
    if (!isErrnoException(error, 'ENOENT')) {
      throw error;
    }
  }
}

function restoreBackupFile(
  targetPath: string,
  backupPath: string,
  label: string,
): boolean {
  try {
    const content = readFileSync(backupPath);
    atomicWriteFile(targetPath, content);
  } catch (error) {
    console.error(
      `Failed to restore ${label} from ${backupPath}: ${messageOf(error)}`,
    );
    return false;
  }

  console.log(`  Restored ${label}`);
  try {
    unlinkSync(backupPath);
  } catch (error) {
    if (!isErrnoException(error, 'ENOENT')) {
      console.warn(
        `Restored ${label} but failed to delete backup: ${messageOf(error)}`,
      );
    }
  }
  return true;
}

export function restoreReleaseDeps({
  dryRun = false,
}: RestoreOptions = {}): number {
  let restored = 0;
  let restorable = 0;

  for (const workspacePath of getWorkspacePaths()) {
    const pkgJsonPath = join(ROOT, workspacePath, 'package.json');
    const backupPath = pkgJsonPath + BACKUP_SUFFIX;
    if (!existsSync(backupPath)) {
      continue;
    }

    const label = `${workspacePath}/package.json`;
    restorable++;
    if (!dryRun) {
      if (restoreBackupFile(pkgJsonPath, backupPath, label)) {
        restored++;
      }
    } else {
      console.log(`  [dry-run] Would restore ${label}`);
    }
  }

  const lockPath = join(ROOT, 'package-lock.json');
  const lockBackupPath = lockPath + BACKUP_SUFFIX;
  if (existsSync(lockBackupPath)) {
    restorable++;
    if (!dryRun) {
      if (restoreBackupFile(lockPath, lockBackupPath, 'package-lock.json')) {
        restored++;
      }
    } else {
      console.log('  [dry-run] Would restore package-lock.json');
    }
  }

  if (restorable === 0) {
    console.log('No backups found to restore.');
  } else if (dryRun) {
    console.log(`Would restore ${restorable} file(s).`);
  } else {
    console.log(`Restored ${restored} file(s).`);
  }

  if (!dryRun && restored < restorable) {
    throw new Error(
      `Only restored ${restored} of ${restorable} file(s); see errors above.`,
    );
  }

  return dryRun ? restorable : restored;
}

function printUsage(): void {
  console.log(`Usage: bun scripts/bind-release-deps.ts [options]

Options:
  --dry-run   Show what would change without writing files
  --restore   Restore files from .bind-backup files
  --backup    Keep .bind-backup files after successful binding
  --help, -h  Show this help message`);
}

function main(): void {
  const args = process.argv.slice(2);
  const knownFlags = new Set([
    '--dry-run',
    '--restore',
    '--backup',
    '--help',
    '-h',
  ]);
  const unknownArgs = args.filter((arg) => !knownFlags.has(arg));
  if (unknownArgs.length > 0) {
    console.error(`Error: unknown argument(s): ${unknownArgs.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    printUsage();
    return;
  }
  const dryRun = args.includes('--dry-run');

  try {
    if (args.includes('--restore')) {
      if (args.includes('--backup')) {
        console.warn('Warning: --backup has no effect with --restore.');
      }
      restoreReleaseDeps({ dryRun });
      return;
    }

    if (dryRun && args.includes('--backup')) {
      console.warn('Warning: --backup has no effect with --dry-run.');
    }
    bindReleaseDeps({
      dryRun,
      backup: dryRun ? false : args.includes('--backup'),
    });
  } catch (error) {
    console.error(`Error: ${messageOf(error)}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
