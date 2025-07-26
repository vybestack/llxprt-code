/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import semver from 'semver';
import { getPackageJson } from '../../utils/package.js';

const UPDATE_CHECK_URL = 'https://registry.npmjs.org/@vybestack/llxprt-code/latest';
const UPDATE_CHECK_TIMEOUT_MS = 5000;

async function fetchWithTimeout(
  url: string,
  timeout: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function checkForUpdates(): Promise<string | null> {
  try {
    // Skip update check when running from source (development mode)
    if (process.env.DEV === 'true') {
      return null;
    }

    const packageJson = await getPackageJson();
    if (!packageJson || !packageJson.name || !packageJson.version) {
      return null;
    }

    const response = await fetchWithTimeout(
      UPDATE_CHECK_URL,
      UPDATE_CHECK_TIMEOUT_MS,
    );
    if (!response.ok) {
      return null;
    }

    const latestPackageData = await response.json();

    if (
      latestPackageData &&
      latestPackageData.version &&
      semver.gt(latestPackageData.version, packageJson.version)
    ) {
      return `LLxprt Code update available! ${packageJson.version} → ${latestPackageData.version}\nRun npm install -g ${packageJson.name} to update`;
    }

    return null;
  } catch (e) {
    console.warn('Failed to check for updates: ' + e);
    return null;
  }
}
