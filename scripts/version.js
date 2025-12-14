/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// A script to handle versioning and ensure all related changes are in a single, atomic commit.

function run(command) {
  console.log(`> ${command}`);
  execSync(command, { stdio: 'inherit' });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

// 1. Get the version type or specific version from the command line arguments.
const versionArg = process.argv[2];
if (!versionArg) {
  console.error('Error: No version specified.');
  console.error('Usage: npm run version <patch|minor|major|prerelease|X.Y.Z>');
  process.exit(1);
}

// Check if it's a specific version number (X.Y.Z format) or a version type
const isSpecificVersion = /^\d+\.\d+\.\d+/.test(versionArg);
const versionCommand = isSpecificVersion ? versionArg : versionArg;

// 2. Bump the version in the root and all workspace package.json files.
run(`npm version ${versionCommand} --no-git-tag-version --allow-same-version`);

// 3. Get all workspaces and filter out the one we don't want to version.
// Define the actual workspaces in our monorepo (not external dependencies)
const actualWorkspaces = [
  '@vybestack/llxprt-code',
  '@vybestack/llxprt-code-core',
  '@vybestack/llxprt-code-test-utils',
  'llxprt-code-vscode-ide-companion',
];

// Filter for workspaces that actually exist (in case some are optional)
const workspacesToVersion = actualWorkspaces.filter((wsName) => {
  try {
    execSync(`npm ls ${wsName} --depth=0`, { stdio: 'pipe' });
    return true;
  } catch {
    // Workspace doesn't exist, skip it
    return false;
  }
});

for (const workspaceName of workspacesToVersion) {
  run(
    `npm version ${versionCommand} --workspace ${workspaceName} --no-git-tag-version --allow-same-version`,
  );
}

// 4. Get the new version number from the root package.json
const rootPackageJsonPath = resolve(process.cwd(), 'package.json');
const newVersion = readJson(rootPackageJsonPath).version;

// 4. Update the sandboxImageUri in the root package.json
const rootPackageJson = readJson(rootPackageJsonPath);
if (rootPackageJson.config?.sandboxImageUri) {
  rootPackageJson.config.sandboxImageUri =
    rootPackageJson.config.sandboxImageUri.replace(/:.*$/, `:${newVersion}`);
  console.log(`Updated sandboxImageUri in root to use version ${newVersion}`);
  writeJson(rootPackageJsonPath, rootPackageJson);
}

// 5. Update the sandboxImageUri in the cli package.json
const cliPackageJsonPath = resolve(process.cwd(), 'packages/cli/package.json');
const cliPackageJson = readJson(cliPackageJsonPath);
if (cliPackageJson.config?.sandboxImageUri) {
  cliPackageJson.config.sandboxImageUri =
    cliPackageJson.config.sandboxImageUri.replace(/:.*$/, `:${newVersion}`);
  console.log(
    `Updated sandboxImageUri in cli package to use version ${newVersion}`,
  );
  writeJson(cliPackageJsonPath, cliPackageJson);
}

// 6. Bump the version in the UI package (not an npm workspace).
const uiPackageJsonPath = resolve(process.cwd(), 'packages/ui/package.json');
try {
  const uiPackageJson = readJson(uiPackageJsonPath);
  uiPackageJson.version = newVersion;
  if (uiPackageJson.peerDependencies?.['@vybestack/llxprt-code-core']) {
    uiPackageJson.peerDependencies['@vybestack/llxprt-code-core'] =
      `^${newVersion}`;
  }
  console.log(`Updated ui package to version ${newVersion}`);
  writeJson(uiPackageJsonPath, uiPackageJson);
} catch (err) {
  console.error('Error updating ui package version:', err);
  process.exit(1);
}

// 7. Run `npm install` to update package-lock.json.
run('npm install');

console.log(`Successfully bumped versions to v${newVersion}.`);
