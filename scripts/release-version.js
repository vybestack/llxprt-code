/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// A script to set explicit version numbers for releases

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

// 1. Get the explicit version from the command line arguments.
const newVersion = process.argv[2];
if (!newVersion) {
  console.error('Error: No version specified.');
  console.error('Usage: npm run release:version <x.y.z>');
  process.exit(1);
}

// Validate version format
if (!newVersion.match(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/)) {
  console.error(
    'Error: Version must be in the format x.y.z or x.y.z-prerelease',
  );
  process.exit(1);
}

// 2. Set the version in the root and all workspace package.json files.
run(`npm version ${newVersion} --no-git-tag-version --allow-same-version`);

// 3. Version all our workspace packages
const workspacesToVersion = [
  '@vybestack/llxprt-code-core',
  'llxprt-code-vscode-ide-companion',
];

for (const workspaceName of workspacesToVersion) {
  run(
    `npm version ${newVersion} --workspace ${workspaceName} --no-git-tag-version --allow-same-version`,
  );
}

// 4. Update the CLI package dependency to match core version
const cliPackageJsonPath = resolve(process.cwd(), 'packages/cli/package.json');
const cliPackageJson = readJson(cliPackageJsonPath);
cliPackageJson.version = newVersion;
writeJson(cliPackageJsonPath, cliPackageJson);

// 5. Update the sandboxImageUri in the root package.json
const rootPackageJsonPath = resolve(process.cwd(), 'package.json');
const rootPackageJson = readJson(rootPackageJsonPath);
if (rootPackageJson.config?.sandboxImageUri) {
  rootPackageJson.config.sandboxImageUri =
    rootPackageJson.config.sandboxImageUri.replace(/:.*$/, `:${newVersion}`);
  console.log(`Updated sandboxImageUri in root to use version ${newVersion}`);
  writeJson(rootPackageJsonPath, rootPackageJson);
}

// 6. Update the sandboxImageUri in the cli package.json
if (cliPackageJson.config?.sandboxImageUri) {
  cliPackageJson.config.sandboxImageUri =
    cliPackageJson.config.sandboxImageUri.replace(/:.*$/, `:${newVersion}`);
  console.log(
    `Updated sandboxImageUri in cli package to use version ${newVersion}`,
  );
  writeJson(cliPackageJsonPath, cliPackageJson);
}

// 7. Run `npm install` to update package-lock.json.
run('npm install');

console.log(`Successfully set all versions to v${newVersion}.`);
