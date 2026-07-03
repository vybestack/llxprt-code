/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface LockfilePackageDetails {
  link?: boolean;
  optional?: boolean;
  peer?: boolean;
  resolved?: string;
  integrity?: string;
}

interface Lockfile {
  packages?: Record<string, LockfilePackageDetails>;
}

const GIT_OR_FILE_PROTOCOLS = [
  'git+',
  'git@',
  'git://',
  'ssh:',
  'github:',
  'gitlab:',
  'bitbucket:',
  'file:',
] as const;

/**
 * Type guard: narrows a raw lockfile entry value to a LockfilePackageDetails
 * object. `Object.entries` yields `unknown` values for JSON-parsed records,
 * so shouldSkipPackage (which dereferences details.link) must only be called
 * after this guard confirms the entry is a non-null object.
 */
function isLockfileDetails(value: unknown): value is LockfilePackageDetails {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    hasValidBooleanFlags(record) &&
    isOptionalString(record['resolved']) &&
    isOptionalString(record['integrity'])
  );
}

function hasValidBooleanFlags(value: Record<string, unknown>): boolean {
  return (
    isOptionalBoolean(value['link']) &&
    isOptionalBoolean(value['optional']) &&
    isOptionalBoolean(value['peer'])
  );
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const lockfilePath = join(root, 'package-lock.json');

function readJsonFile(filePath: string): Lockfile | null {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(fileContent) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      console.error(`Error: ${filePath} does not contain a valid JSON object.`);
      return null;
    }
    return parsed as Lockfile;
  } catch (error) {
    console.error(`Error reading or parsing ${filePath}:`, error);
    return null;
  }
}

function isWorkspacePackageLocation(location: string): boolean {
  return (
    location.startsWith('packages/') ||
    location.startsWith('node_modules/packages/')
  );
}

function shouldSkipPackage(
  location: string,
  details: LockfilePackageDetails,
): boolean {
  // 1. Skip the root package itself.
  if (location === '') {
    return true;
  }

  // 2. Skip local workspace packages.
  if (details.link === true || isWorkspacePackageLocation(location)) {
    return true;
  }

  // 3. Skip optional dependencies; platform-specific optional packages may be
  // omitted entirely or installed without full registry metadata.
  if (details.optional === true) {
    return true;
  }

  // 4. Any remaining package should be a third-party dependency.
  // 1) Registry package with both "resolved" and "integrity" fields is valid.
  if (details.resolved && details.integrity) {
    return true;
  }
  // 2) Git, SSH, and file dependencies that lack an integrity hash are valid
  //    with only a "resolved" field (reached only when integrity is absent).
  const resolved = details.resolved;
  if (
    typeof resolved === 'string' &&
    GIT_OR_FILE_PROTOCOLS.some((protocol) => resolved.startsWith(protocol))
  ) {
    return true;
  }

  return false;
}

function checkLockfile(): number {
  console.log('Checking lockfile...');

  const lockfile = readJsonFile(lockfilePath);
  if (lockfile === null) {
    return 1;
  }
  const packages = lockfile.packages;
  if (
    packages === undefined ||
    packages === null ||
    Object.keys(packages).length === 0
  ) {
    console.error(
      'Error: package-lock.json contains no packages. The lockfile may be corrupted or empty.',
    );
    return 1;
  }
  const invalidPackages: string[] = [];
  const malformedPackages: string[] = [];
  const packagesWithPeerFlag: string[] = [];

  for (const [location, details] of Object.entries(packages)) {
    const isDetails = isLockfileDetails(details);
    if (!isDetails) {
      malformedPackages.push(location || '<root>');
      continue;
    }

    if (details.peer === true) {
      packagesWithPeerFlag.push(location || '<root>');
    } else if (!shouldSkipPackage(location, details)) {
      invalidPackages.push(location || '<root>');
    }
  }

  let hasErrors = false;

  if (invalidPackages.length > 0) {
    console.error(
      '\nError: The following dependencies in package-lock.json are missing required "resolved"/"integrity" fields or do not match a recognized registry/git/file protocol:',
    );
    invalidPackages.forEach((pkg) => console.error(`- ${pkg}`));
    hasErrors = true;
  }

  if (malformedPackages.length > 0) {
    console.error(
      '\nError: package-lock.json contains structurally invalid package entries:',
    );
    malformedPackages.forEach((pkg) => console.error(`- ${pkg}`));
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
    return 1;
  }

  console.log('Lockfile check passed.');
  return 0;
}

process.exitCode = checkLockfile();
