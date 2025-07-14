/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { checkForUpdates } from './updateCheck';

const getPackageJson = vi.hoisted(() => vi.fn());
vi.mock('../../utils/package.js', () => ({
  getPackageJson,
}));

// Mock global fetch instead of fetchWithTimeout
global.fetch = vi.fn();

describe('checkForUpdates', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.clearAllTimers();
  });

  it('should return null if package.json is missing', async () => {
    getPackageJson.mockResolvedValue(null);
    const result = await checkForUpdates();
    expect(result).toBeNull();
  });

  it('should return null if there is no update', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response);
    const result = await checkForUpdates();
    expect(result).toBeNull();
  });

  it('should return a message if a newer version is available', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.1.0' }),
    } as Response);
    const result = await checkForUpdates();
    expect(result).toContain('1.0.0 → 1.1.0');
    expect(result).toContain('npm install -g test-package');
  });

  it('should return null if the latest version is the same as the current version', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response);
    const result = await checkForUpdates();
    expect(result).toBeNull();
  });

  it('should return null if the latest version is older than the current version', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.1.0',
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    } as Response);
    const result = await checkForUpdates();
    expect(result).toBeNull();
  });

  it('should handle errors gracefully', async () => {
    getPackageJson.mockRejectedValue(new Error('test error'));
    const result = await checkForUpdates();
    expect(result).toBeNull();
  });

  it('should return null if fetch fails', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
    } as Response);
    const result = await checkForUpdates();
    expect(result).toBeNull();
  });

  it('should return null if fetch throws an error', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));
    const result = await checkForUpdates();
    expect(result).toBeNull();
  });
});
