/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import updateNotifier, { UpdateInfo } from 'update-notifier';
import semver from 'semver';
import { getPackageJson } from '@vybestack/llxprt-code-core';
import type { LoadedSettings } from '../../config/settings.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const FETCH_TIMEOUT_MS = 2000;

export interface UpdateObject {
  message: string;
  update: UpdateInfo;
}

/**
 * From a nightly and stable update, determines which is the "best" one to offer.
 * The rule is to always prefer nightly if the base versions are the same.
 */
function getBestAvailableUpdate(
  nightly?: UpdateInfo,
  stable?: UpdateInfo,
): UpdateInfo | null {
  if (!nightly) return stable || null;
  if (!stable) return nightly || null;

  const nightlyVer = nightly.latest;
  const stableVer = stable.latest;

  if (
    semver.coerce(stableVer)?.version === semver.coerce(nightlyVer)?.version
  ) {
    return nightly;
  }

  return semver.gt(stableVer, nightlyVer) ? stable : nightly;
}

export async function checkForUpdates(
  settings: LoadedSettings,
): Promise<UpdateObject | null> {
  try {
    if (settings.merged.disableUpdateNag) {
      return null;
    }
    // Skip update check when running from source (development mode)
    if (process.env.DEV === 'true') {
      return null;
    }
    const packageJson = await getPackageJson(__dirname);
    if (!packageJson || !packageJson.name || !packageJson.version) {
      return null;
    }

    const { name, version: currentVersion } = packageJson;
    const isNightly = currentVersion.includes('nightly');
    const createNotifier = (distTag: 'latest' | 'nightly') =>
      updateNotifier({
        pkg: {
          name,
          version: currentVersion,
        },
        updateCheckInterval: 0,
        shouldNotifyInNpmScript: true,
        distTag,
      });

    // Add timeout wrapper to prevent blocking
    const fetchWithTimeout = async (notifier: {
      fetchInfo: () => UpdateInfo | Promise<UpdateInfo>;
    }) => {
      const timeout = new Promise<null>((resolve) =>
        setTimeout(resolve, FETCH_TIMEOUT_MS, null),
      );
      const fetchResult = notifier.fetchInfo();
      const fetchPromise = Promise.resolve(fetchResult);
      return Promise.race([
        fetchPromise,
        timeout,
      ]) as Promise<UpdateInfo | null>;
    };

    if (isNightly) {
      const [nightlyUpdateInfo, latestUpdateInfo] = await Promise.all([
        fetchWithTimeout(createNotifier('nightly')),
        fetchWithTimeout(createNotifier('latest')),
      ]);

      const bestUpdate = getBestAvailableUpdate(
        nightlyUpdateInfo || undefined,
        latestUpdateInfo || undefined,
      );

      if (bestUpdate && semver.gt(bestUpdate.latest, currentVersion)) {
        const message = `LLxprt Code update available! ${currentVersion} → ${bestUpdate.latest}`;
        return {
          message,
          update: { ...bestUpdate, current: currentVersion },
        };
      }
    } else {
      const updateInfo = await fetchWithTimeout(createNotifier('latest'));

      if (updateInfo && semver.gt(updateInfo.latest, currentVersion)) {
        const message = `LLxprt Code update available! ${currentVersion} → ${updateInfo.latest}`;
        return {
          message,
          update: { ...updateInfo, current: currentVersion },
        };
      }
    }

    return null;
  } catch (e) {
    console.warn('Failed to check for updates: ' + e);
    return null;
  }
}
