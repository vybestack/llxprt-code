/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import semver from 'semver';
import { getPackageJson } from '../../utils/package.js';

const UPDATE_CHECK_URL = 'https://raw.githubusercontent.com/google-gemini/gemini-cli/main/package.json';
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
    const packageJson = await getPackageJson();
    if (!packageJson || !packageJson.name || !packageJson.version) {
      return null;
    }

    const response = await fetchWithTimeout(UPDATE_CHECK_URL, UPDATE_CHECK_TIMEOUT_MS);
    if (!response.ok) {
      return null;
    }

    const latestPackageJson = await response.json();

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
}
