/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const lockfilePath = join(root, 'package-lock.json');

function readJsonFile(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(fileContent);
  } catch (error) {
    console.error(`Error reading or parsing ${filePath}:`, error);
    return null;
  }
}

console.log('Checking lockfile...');

const lockfile = readJsonFile(lockfilePath);
if (lockfile === null) {
  process.exit(1);
}
const packages = lockfile.packages || {};
const invalidPackages = [];
const packagesWithPeerFlag = [];

for (const [location, details] of Object.entries(packages)) {
  if (
    details &&
    typeof details === 'object' &&
    Object.prototype.hasOwnProperty.call(details, 'peer')
  ) {
    packagesWithPeerFlag.push(location || '<root>');
  }

  if (shouldSkipPackage(location, details)) {
    continue;
  }

  // Mark the left dependency as invalid.
  invalidPackages.push(location);
}

function shouldSkipPackage(location, details) {
  // 1. Skip the root package itself.
  if (location === '') {
    return true;
  }

  // 2. Skip local workspace packages.
  if (
    details.link === true ||
    !location.includes('node_modules') ||
    (location.startsWith('packages/') && location.match(/\/node_modules\//))
  ) {
    return true;
  }

  // 3. Skip optional dependencies that aren't installed on this platform.
  if (details.optional === true && !details.resolved) {
    return true;
  }

  // 4. Any remaining package should be a third-party dependency.
  // 1) Registry package with both "resolved" and "integrity" fields is valid.
  if (details.resolved && details.integrity) {
    return true;
  }
  // 2) Git and file dependencies only need a "resolved" field.
  const isGitOrFileDep =
    details.resolved?.startsWith('git') ||
    details.resolved?.startsWith('file:');
  if (isGitOrFileDep) {
    return true;
  }

  return false;
}

let hasErrors = false;

if (invalidPackages.length > 0) {
  console.error(
    '\nError: The following dependencies in package-lock.json are missing the "resolved" or "integrity" field:',
  );
  invalidPackages.forEach((pkg) => console.error(`- ${pkg}`));
  hasErrors = true;
}

if (packagesWithPeerFlag.length > 0) {
  console.error(
    '\nError: package-lock.json contains unsupported "peer" flags on the following entries:',
  );
  packagesWithPeerFlag.forEach((pkg) => console.error(`- ${pkg}`));
  hasErrors = true;
}

if (hasErrors) {
  process.exitCode = 1;
} else {
  console.log('Lockfile check passed.');
  process.exitCode = 0;
}
