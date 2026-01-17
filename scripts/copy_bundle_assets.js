/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const bundleDir = join(root, 'bundle');

// Remove verbose logging

// Create the bundle directory if it doesn't exist
if (!existsSync(bundleDir)) {
  mkdirSync(bundleDir);
}

// Find and copy all .sb files from packages to the root of the bundle directory
const sbFiles = glob.sync('packages/**/*.sb', { cwd: root });
for (const file of sbFiles) {
  copyFileSync(join(root, file), join(bundleDir, basename(file)));
}

// Find and copy all .vsix files from packages to the root of the bundle directory
const vsixFiles = glob.sync('packages/vscode-ide-companion/*.vsix', {
  cwd: root,
});
for (const file of vsixFiles) {
  copyFileSync(join(root, file), join(bundleDir, basename(file)));
}

// Copy tiktoken WASM file
const tiktokenWasmPath = join(
  root,
  'node_modules/@dqbd/tiktoken/tiktoken_bg.wasm',
);
if (existsSync(tiktokenWasmPath)) {
  copyFileSync(tiktokenWasmPath, join(bundleDir, 'tiktoken_bg.wasm'));
}

// Copy tree-sitter WASM file for web-tree-sitter runtime
const treeSitterWasmPath = join(
  root,
  'node_modules/web-tree-sitter/tree-sitter.wasm',
);
if (existsSync(treeSitterWasmPath)) {
  copyFileSync(treeSitterWasmPath, join(bundleDir, 'tree-sitter.wasm'));
}

// Copy all markdown files from prompt-config/defaults preserving directory structure
const promptMdFiles = glob.sync(
  'packages/core/src/prompt-config/defaults/**/*.md',
  { cwd: root },
);
// Found markdown files to copy
for (const file of promptMdFiles) {
  // Extract the relative path after 'defaults/'
  // Normalize path separators to forward slashes for consistent replacement
  const normalizedFile = file.replace(/\\/g, '/');
  const relativePath = normalizedFile.replace(
    'packages/core/src/prompt-config/defaults/',
    '',
  );
  const sourcePath = join(root, file);
  const targetPath = join(bundleDir, relativePath);
  const targetDir = dirname(targetPath);

  // Create directory structure if it doesn't exist
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  copyFileSync(sourcePath, targetPath);

  // Verify the file was copied
  if (!existsSync(targetPath)) {
    console.error(`  Failed to copy: ${relativePath}`);
  }
}

// Copy generated prompt manifest into the bundle root for runtime loading
const promptManifestPath = join(
  root,
  'packages/core/dist/prompt-config/defaults/default-prompts.json',
);
if (existsSync(promptManifestPath)) {
  copyFileSync(promptManifestPath, join(bundleDir, 'default-prompts.json'));
}

// Copy provider alias config files preserving directory structure
const aliasFiles = glob.sync('packages/cli/src/providers/aliases/*.config', {
  cwd: root,
});
for (const file of aliasFiles) {
  const sourcePath = join(root, file);
  const targetPath = join(bundleDir, 'providers', 'aliases', basename(file));
  const targetDir = dirname(targetPath);

  // Create directory structure if it doesn't exist
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  copyFileSync(sourcePath, targetPath);

  // Verify the file was copied
  if (!existsSync(targetPath)) {
    console.error(`  Failed to copy alias: ${basename(file)}`);
  }
}

// Copy policy files preserving directory structure
const policyFiles = glob.sync('packages/core/src/policy/policies/*.toml', {
  cwd: root,
});
for (const file of policyFiles) {
  const sourcePath = join(root, file);
  const targetPath = join(bundleDir, 'policies', basename(file));
  const targetDir = dirname(targetPath);

  // Create directory structure if it doesn't exist
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  copyFileSync(sourcePath, targetPath);

  // Verify the file was copied
  if (!existsSync(targetPath)) {
    console.error(`  Failed to copy policy: ${basename(file)}`);
  }
}
// Assets copied to bundle/
