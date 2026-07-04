/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  NON_NPM_RELEASE_PACKAGES,
  VS_CODE_EXTENSION_PACKAGE,
} from './utils/release-packages.ts';

// A script to handle versioning and ensure all related changes are in a single, atomic commit.

type PackageJson = Record<string, unknown> & {
  name?: string;
  version: string;
  private?: boolean;
  workspaces?: unknown;
  config?: Record<string, unknown> & {
    sandboxImageUri?: string;
  };
};

function npmBin(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function runNpm(args: readonly string[]): void {
  console.log(`> npm ${args.join(' ')}`);
  execFileSync(npmBin(), args, { stdio: 'inherit', timeout: 120_000 });
}

function readJson(filePath: string): PackageJson {
  const data = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
  if (!isPackageJson(data)) {
    throw new Error(`Missing or invalid "version" in ${filePath}`);
  }
  return data;
}

function isPackageJson(data: unknown): data is PackageJson {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { version?: unknown }).version === 'string'
  );
}

function workspacePathsFromRootWorkspaces(): string[] {
  const rootPackageJsonPath = resolve(process.cwd(), 'package.json');
  const workspaces = readJson(rootPackageJsonPath).workspaces;
  if (!Array.isArray(workspaces)) {
    throw new Error('Root package.json must define an array of workspaces.');
  }

  return workspaces.filter(
    (workspace): workspace is string => typeof workspace === 'string',
  );
}

function isVersionedReleasePackage(packageJson: PackageJson): boolean {
  if (packageJson.private === true || typeof packageJson.name !== 'string') {
    return false;
  }
  return (
    !NON_NPM_RELEASE_PACKAGES.has(packageJson.name) ||
    packageJson.name === VS_CODE_EXTENSION_PACKAGE
  );
}

function versionedWorkspacePathsFromRootWorkspaces(): string[] {
  return workspacePathsFromRootWorkspaces().filter((workspacePath) => {
    const packageJsonPath = resolve(
      process.cwd(),
      workspacePath,
      'package.json',
    );
    return isVersionedReleasePackage(readJson(packageJsonPath));
  });
}

function writeJson(filePath: string, data: PackageJson): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

// 1. Get the version type or specific version from the command line arguments.
const versionArg = process.argv[2];
if (!versionArg) {
  console.error('Error: No version specified.');
  console.error('Usage: npm run version <patch|minor|major|prerelease|X.Y.Z>');
  process.exit(1);
}

// 2. Bump the version in the root and all workspace package.json files.
// versionArg is passed through directly whether it is a specific version
// number or a semantic keyword (patch/minor/major/prerelease).

// 3. Bump the root package, then all declared workspace package names.
const rootPackageJsonPath = resolve(process.cwd(), 'package.json');

try {
  const workspacesToVersion = versionedWorkspacePathsFromRootWorkspaces();
  runNpm([
    'version',
    versionArg,
    '--no-git-tag-version',
    '--allow-same-version',
    '--workspaces-update=false',
  ]);

  for (const workspacePath of workspacesToVersion) {
    runNpm([
      'version',
      versionArg,
      '--workspace',
      workspacePath,
      '--no-git-tag-version',
      '--allow-same-version',
      '--workspaces-update=false',
    ]);
  }
} catch (error) {
  console.error(
    'Version bump failed before all manifests were updated. Revert package.json, packages/*/package.json, and package-lock.json before retrying.',
  );
  throw error;
}

// 4. Get the new version number from the root package.json
const newVersion = readJson(rootPackageJsonPath).version;

function updateSandboxImageUri(
  packageJsonPath: string,
  label: string,
  version: string,
): void {
  const packageJson = readJson(packageJsonPath);
  const config = packageJson.config;
  if (config === undefined) {
    return;
  }
  const uri = config.sandboxImageUri;
  if (typeof uri !== 'string' || uri.length === 0) {
    return;
  }

  const tagMatch = uri.match(/^(.+):([^:@/]+)$/);
  if (tagMatch === null) {
    throw new Error(
      `Could not parse tag from sandboxImageUri in ${label}; expected <image>:<tag>.`,
    );
  }
  config.sandboxImageUri = `${tagMatch[1]}:${version}`;
  console.log(`Updated sandboxImageUri in ${label} to use version ${version}`);
  writeJson(packageJsonPath, packageJson);
}

// 5. Update sandboxImageUri values in publishable package metadata.
const cliPackageJsonPath = resolve(process.cwd(), 'packages/cli/package.json');
updateSandboxImageUri(rootPackageJsonPath, 'root package.json', newVersion);
updateSandboxImageUri(
  cliPackageJsonPath,
  'packages/cli/package.json',
  newVersion,
);

// 6. Update package-lock.json without reinstalling node_modules.
try {
  runNpm(['install', '--package-lock-only']);
} catch (error) {
  console.error(
    'package-lock.json update failed. Revert package.json, packages/*/package.json, and package-lock.json before retrying.',
  );
  throw error;
}

console.log(`Successfully bumped versions to v${newVersion}.`);
