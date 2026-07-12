/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getPackageJson } from './package.js';

export enum ReleaseChannel {
  NIGHTLY = 'nightly',
  PREVIEW = 'preview',
  STABLE = 'stable',
}

type PackageJsonLoader = typeof getPackageJson;

export interface ReleaseChannelDetector {
  clearCache(): void;
  isNightly(cwd: string): Promise<boolean>;
  isPreview(cwd: string): Promise<boolean>;
  isStable(cwd: string): Promise<boolean>;
}

export function createReleaseChannelDetector(
  loadPackageJson: PackageJsonLoader = getPackageJson,
): ReleaseChannelDetector {
  const cache = new Map<string, ReleaseChannel>();

  const getReleaseChannel = async (cwd: string): Promise<ReleaseChannel> => {
    const cachedChannel = cache.get(cwd);
    if (cachedChannel !== undefined) {
      return cachedChannel;
    }

    const packageJson = await loadPackageJson(cwd);
    const version = packageJson?.version ?? '';
    let channel: ReleaseChannel;
    if (version.includes('nightly') || version === '') {
      channel = ReleaseChannel.NIGHTLY;
    } else if (version.includes('preview')) {
      channel = ReleaseChannel.PREVIEW;
    } else {
      channel = ReleaseChannel.STABLE;
    }
    cache.set(cwd, channel);
    return channel;
  };

  return {
    clearCache: () => cache.clear(),
    isNightly: async (cwd) =>
      (await getReleaseChannel(cwd)) === ReleaseChannel.NIGHTLY,
    isPreview: async (cwd) =>
      (await getReleaseChannel(cwd)) === ReleaseChannel.PREVIEW,
    isStable: async (cwd) =>
      (await getReleaseChannel(cwd)) === ReleaseChannel.STABLE,
  };
}

const defaultDetector = createReleaseChannelDetector();

export function _clearCache(): void {
  defaultDetector.clearCache();
}

export function isNightly(cwd: string): Promise<boolean> {
  return defaultDetector.isNightly(cwd);
}

export function isPreview(cwd: string): Promise<boolean> {
  return defaultDetector.isPreview(cwd);
}

export function isStable(cwd: string): Promise<boolean> {
  return defaultDetector.isStable(cwd);
}
