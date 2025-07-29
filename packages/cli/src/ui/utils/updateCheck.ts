/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import updateNotifier, { UpdateInfo } from 'update-notifier';
import semver from 'semver';
import { getPackageJson } from '../../utils/package.js';

export interface UpdateObject {
  message: string;
  update: UpdateInfo;
}

export async function checkForUpdates(): Promise<UpdateObject | null> {
  try {
    // Skip update check when running from source (development mode)
    if (process.env.DEV === 'true') {
      return null;
    }

    const packageJson = await getPackageJson();
    if (!packageJson || !packageJson.name || !packageJson.version) {
      return null;
    }

    const notifier = updateNotifier({
      pkg: packageJson,
      updateCheckInterval: 0, // Check immediately
    });

    const updateInfo = await notifier.fetchInfo();

    if (updateInfo && semver.gt(updateInfo.latest, updateInfo.current)) {
      return {
        message: `LLxprt Code update available! ${updateInfo.current} → ${updateInfo.latest}`,
        update: updateInfo,
      };
    }

    return null;
  } catch (e) {
    console.warn('Failed to check for updates: ' + e);
    return null;
  }
}
