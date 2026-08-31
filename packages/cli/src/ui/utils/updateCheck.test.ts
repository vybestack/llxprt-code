/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  advanceTimersByTimeAsync,
  runAllTimersAsync,
} from '@vybestack/llxprt-code-test-utils';
import { vi, describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { checkForUpdates, FETCH_TIMEOUT_MS } from './updateCheck.js';
import type { Settings, UpdateInfo } from 'update-notifier';
import type { LoadedSettings } from '../../config/settings.js';

const getPackageJson = vi.fn();
const debugLogger = {
  warn: vi.fn(),
};
void vi.mock('@vybestack/llxprt-code-core', () => ({
  getPackageJson,
  debugLogger,
}));

const updateNotifier = vi.fn();
void vi.mock('update-notifier', () => ({
  default: updateNotifier,
}));

function createNightlyFetchInfoMock(latestStable: string) {
  return vi.fn(({ distTag }: Settings) => {
    if (distTag === 'nightly') {
      return Promise.resolve({
        latest: '1.2.3-nightly.2',
        current: '1.2.3-nightly.1',
      });
    }
    if (distTag === 'latest') {
      return Promise.resolve({
        latest: latestStable,
        current: '1.2.3-nightly.1',
      });
    }
    return Promise.resolve(null);
  });
}

describe('checkForUpdates', () => {
  let mockSettings: LoadedSettings;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    // Clear DEV environment variable before each test
    delete process.env.DEV;

    mockSettings = {
      merged: {
        enableAutoUpdateNotification: true,
      },
    } as unknown as LoadedSettings;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should return null if enableAutoUpdateNotification is false', async () => {
    mockSettings.merged.enableAutoUpdateNotification = false;
    const result = await checkForUpdates(mockSettings);
    expect(result).toBeNull();
    expect(getPackageJson).not.toHaveBeenCalled();
    expect(updateNotifier).not.toHaveBeenCalled();
  });

  it('should return null when running from source (DEV=true)', async () => {
    process.env.DEV = 'true';
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    updateNotifier.mockReturnValue({
      fetchInfo: vi
        .fn()
        .mockResolvedValue({ current: '1.0.0', latest: '1.1.0' }),
    });
    const result = await checkForUpdates(mockSettings);
    expect(result).toBeNull();
    expect(getPackageJson).not.toHaveBeenCalled();
    expect(updateNotifier).not.toHaveBeenCalled();
  });

  it('should return null if package.json is missing', async () => {
    getPackageJson.mockResolvedValue(null);
    const result = await checkForUpdates(mockSettings);
    expect(result).toBeNull();
  });

  it('should return null if there is no update', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    updateNotifier.mockReturnValue({
      fetchInfo: vi.fn().mockResolvedValue(null),
    });
    const result = await checkForUpdates(mockSettings);
    expect(result).toBeNull();
  });

  it('should return a message if a newer version is available', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    updateNotifier.mockReturnValue({
      fetchInfo: vi
        .fn()
        .mockResolvedValue({ current: '1.0.0', latest: '1.1.0' }),
    });

    const result = await checkForUpdates(mockSettings);
    expect(result?.message).toContain('1.0.0 → 1.1.0');
    expect(result?.update).toStrictEqual({
      current: '1.0.0',
      latest: '1.1.0',
      // UpdateInfo also requires type/name which the mock omits.
    } as unknown as UpdateInfo);
  });

  it('should return null if the latest version is the same as the current version', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    updateNotifier.mockReturnValue({
      fetchInfo: vi
        .fn()
        .mockResolvedValue({ current: '1.0.0', latest: '1.0.0' }),
    });
    const result = await checkForUpdates(mockSettings);
    expect(result).toBeNull();
  });

  it('should return null if the latest version is older than the current version', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.1.0',
    });
    updateNotifier.mockReturnValue({
      fetchInfo: vi
        .fn()
        .mockResolvedValue({ current: '1.1.0', latest: '1.0.0' }),
    });
    const result = await checkForUpdates(mockSettings);
    expect(result).toBeNull();
  });

  it('should return null if fetchInfo rejects', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    updateNotifier.mockReturnValue({
      fetchInfo: vi.fn().mockRejectedValue(new Error('Timeout')),
    });

    const result = await checkForUpdates(mockSettings);
    expect(result).toBeNull();
  });

  it('should handle errors gracefully', async () => {
    getPackageJson.mockRejectedValue(new Error('test error'));
    const result = await checkForUpdates(mockSettings);
    expect(result).toBeNull();
  });

  it('should return null if update notifier fails', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    updateNotifier.mockReturnValue({
      fetchInfo: vi.fn(async () => {
        throw new Error('Network error');
      }),
    });
    const result = await checkForUpdates(mockSettings);
    expect(result).toBeNull();
  });

  describe('nightly updates', () => {
    it('should notify for a newer nightly version when current is nightly', async () => {
      getPackageJson.mockResolvedValue({
        name: 'test-package',
        version: '1.2.3-nightly.1',
      });

      const fetchInfoMock = createNightlyFetchInfoMock('1.2.3');

      updateNotifier.mockImplementation(({ pkg, distTag }) => ({
        fetchInfo: () => fetchInfoMock({ pkg, distTag }),
      }));

      const result = await checkForUpdates(mockSettings);
      expect(result?.message).toContain('1.2.3-nightly.1 → 1.2.3-nightly.2');
      expect(result?.update.latest).toBe('1.2.3-nightly.2');
    });

    it('should prefer a newer stable version over an older nightly', async () => {
      getPackageJson.mockResolvedValue({
        name: 'test-package',
        version: '1.2.3-nightly.1',
      });

      const fetchInfoMock = createNightlyFetchInfoMock('1.3.0');

      updateNotifier.mockImplementation(({ pkg, distTag }) => ({
        fetchInfo: () => fetchInfoMock({ pkg, distTag }),
      }));

      const result = await checkForUpdates(mockSettings);
      expect(result?.message).toContain('1.2.3-nightly.1 → 1.3.0');
      expect(result?.update.latest).toBe('1.3.0');
    });

    it('should handle timeout gracefully for nightly checks', async () => {
      vi.useFakeTimers();
      getPackageJson.mockResolvedValue({
        name: 'test-package',
        version: '1.2.3-nightly.1',
      });

      updateNotifier.mockImplementation(() => ({
        fetchInfo: () => new Promise(() => {}), // Never resolves
      }));

      const checkPromise = checkForUpdates(mockSettings);

      // Advance timers to trigger the timeout
      await advanceTimersByTimeAsync(FETCH_TIMEOUT_MS + 100);
      await runAllTimersAsync();

      const result = await checkPromise;
      expect(result).toBeNull();

      vi.useRealTimers();
    });
  });
});
