/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function getPackageVersion() {
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  return packageJson.version;
}

function getShortSha() {
  return execSync('git rev-parse --short HEAD').toString().trim();
}

export function getNightlyTagName() {
  const version = getPackageVersion();
  const now = new Date();
  const year = now.getUTCFullYear().toString().slice(-2);
  const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = now.getUTCDate().toString().padStart(2, '0');
  const date = `${year}${month}${day}`;

  const sha = getShortSha();
  return `v${version}-nightly.${date}.${sha}`;
}

export function getPreviewVersion() {
  const currentVersion = getPackageVersion();
  const versionParts = currentVersion.split('.');
  // Increment minor version and reset patch to 0
  versionParts[1] = (parseInt(versionParts[1]) + 1).toString();
  versionParts[2] = '0';
  const nextVersion = versionParts.join('.');
  return `${nextVersion}-preview.0`;
}

export function getReleaseVersion() {
  const isNightly = process.env.IS_NIGHTLY === 'true';
  const isPreview = process.env.IS_PREVIEW === 'true';
  const manualVersion = process.env.MANUAL_VERSION;

  let releaseTag;

  if (isNightly) {
    console.error('Calculating next nightly version...');
    releaseTag = getNightlyTagName();
  } else if (isPreview) {
    console.error('Calculating next preview version...');
    const previewVersion = getPreviewVersion();
    console.error(`Next preview version: ${previewVersion}`);
    releaseTag = `v${previewVersion}`;
  } else if (manualVersion) {
    console.error(`Using manual version: ${manualVersion}`);
    releaseTag = manualVersion;
  } else {
    // Auto-increment patch version for automated releases
    const currentVersion = getPackageVersion();
    const versionParts = currentVersion.split('.');
    versionParts[2] = (parseInt(versionParts[2]) + 1).toString();
    const nextVersion = versionParts.join('.');
    console.error(
      `Auto-incrementing version from ${currentVersion} to ${nextVersion}`,
    );
    releaseTag = `v${nextVersion}`;
  }

  if (!releaseTag) {
    throw new Error('Error: Version could not be determined.');
  }

  if (!releaseTag.startsWith('v')) {
    console.error("Version is missing 'v' prefix. Prepending it.");
    releaseTag = `v${releaseTag}`;
  }

  if (releaseTag.includes('+')) {
    throw new Error(
      'Error: Versions with build metadata (+) are not supported for releases. Please use a pre-release version (e.g., v1.2.3-alpha.4) instead.',
    );
  }

  if (!releaseTag.match(/^v[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$/)) {
    throw new Error(
      'Error: Version must be in the format vX.Y.Z or vX.Y.Z-prerelease',
    );
  }

  const releaseVersion = releaseTag.substring(1);
  let npmTag = 'latest';
  if (releaseVersion.includes('-')) {
    // Extract the pre-release identifier (e.g., 'preview', 'nightly', 'alpha')
    const preReleaseId = releaseVersion.split('-')[1].split('.')[0];
    npmTag = preReleaseId;
  }

  return { releaseTag, releaseVersion, npmTag };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    const versions = getReleaseVersion();
    console.log(JSON.stringify(versions));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
