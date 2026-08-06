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

/**
 * Whether a value is a plain string-keyed record (the shape of a dependency
 * section). Mirrors the narrowing style of {@link isPackageJson}.
 */
function isDependencyRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The os-gated CLI launcher platform packages (issue #2978). packages/cli
 * declares these as exact-pinned optionalDependencies so npm's os filtering
 * installs the right launcher per platform. Their versions MUST stay in exact
 * lockstep with @vybestack/llxprt-code: a skew would make the parent reference a
 * platform package version that does not exist on the registry, so npm silently
 * skips it and the consumer is left with no `llxprt` command. The version bump
 * rewrites the pins to the new release version so they cannot drift.
 */
const CLI_LAUNCHER_PLATFORM_PACKAGES = [
  '@vybestack/llxprt-cli-posix',
  '@vybestack/llxprt-cli-win32',
] as const;

function updateCliLauncherPlatformPins(
  packageJsonPath: string,
  version: string,
): void {
  const packageJson = readJson(packageJsonPath);
  const optionalDeps = packageJson.optionalDependencies;
  if (!isDependencyRecord(optionalDeps)) {
    return;
  }
  let changed = false;
  for (const pkg of CLI_LAUNCHER_PLATFORM_PACKAGES) {
    if (optionalDeps[pkg] !== undefined && optionalDeps[pkg] !== version) {
      optionalDeps[pkg] = version;
      changed = true;
    }
  }
  if (changed) {
    console.log(`Pinned CLI launcher platform packages to v${version}`);
    writeJson(packageJsonPath, packageJson);
  }
}

const CLI_LAUNCHER_PLATFORM_PACKAGE_DIRS = [
  'packages/llxprt-cli-posix',
  'packages/llxprt-cli-win32',
] as const;

/**
 * Bumps the `version` field of the os-gated launcher packages themselves.
 * These packages are intentionally NOT npm workspaces (an `os` field on a
 * workspace makes `npm install` EBADPLATFORM on every platform), so the
 * workspace-driven bump never reaches them (issue #2978). Their own version
 * MUST stay in exact lockstep with packages/cli's optionalDependencies pin, or
 * that pin references a registry version that does not exist and npm silently
 * skips the platform package — leaving the consumer with no `llxprt` command.
 */
function updateCliLauncherPackageVersions(version: string): void {
  for (const dir of CLI_LAUNCHER_PLATFORM_PACKAGE_DIRS) {
    const packageJsonPath = resolve(process.cwd(), dir, 'package.json');
    const packageJson = readJson(packageJsonPath);
    if (packageJson.version !== version) {
      packageJson.version = version;
      writeJson(packageJsonPath, packageJson);
    }
  }
}

// 5. Update sandboxImageUri values in publishable package metadata.
const cliPackageJsonPath = resolve(process.cwd(), 'packages/cli/package.json');
updateSandboxImageUri(rootPackageJsonPath, 'root package.json', newVersion);
updateSandboxImageUri(
  cliPackageJsonPath,
  'packages/cli/package.json',
  newVersion,
);

// 5b. Re-pin the os-gated CLI launcher platform packages in lockstep with the
// release version so packages/cli's optionalDependencies can never reference a
// version that does not exist on the registry (issue #2978).
updateCliLauncherPlatformPins(cliPackageJsonPath, newVersion);

// 5c. Bump the os-gated launcher packages' own version field. They are not
// workspaces (issue #2978), so the workspace-driven bump does not reach them;
// their own version must stay in lockstep with packages/cli's pin.
updateCliLauncherPackageVersions(newVersion);

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
