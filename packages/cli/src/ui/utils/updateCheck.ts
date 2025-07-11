/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import semver from 'semver';
import { getPackageJson } from '../../utils/package.js';
// TODO: Fix web_fetch import - currently broken
// import { web_fetch } from '@google/gemini-cli-core';

const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/acoliver/gemini-cli/main/package.json'; // Replace with your custom URL

export async function checkForUpdates(): Promise<string | null> {
  // TODO: Fix web_fetch import and re-enable update check
  return null;
  
  /*
  try {
    const packageJson = await getPackageJson();
    if (!packageJson || !packageJson.name || !packageJson.version) {
      return null;
    }

    const response = await web_fetch(`Fetch latest package.json from ${UPDATE_CHECK_URL}`);
    const latestPackageJson = JSON.parse(response.content);

    if (
      latestPackageJson &&
      latestPackageJson.version &&
      semver.gt(latestPackageJson.version, packageJson.version)
    ) {
      return `Gemini CLI update available! ${packageJson.version} → ${latestPackageJson.version}\nRun npm install -g ${packageJson.name} to update`;
    }

    return null;
  } catch (e) {
    console.warn('Failed to check for updates: ' + e);
    return null;
  }
  */
}
