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

const fetchWithTimeout = vi.hoisted(() => vi.fn());
vi.mock('@google/gemini-cli-core', () => ({
  fetchWithTimeout,
}));

describe('checkForUpdates', () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
    fetchWithTimeout.mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    });
    const result = await checkForUpdates();
    expect(result).toBeNull();
  });

  it('should return a message if a newer version is available', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    fetchWithTimeout.mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.1.0' }),
    });
    const result = await checkForUpdates();
    expect(result).toContain('1.0.0 → 1.1.0');
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/google-gemini/gemini-cli/main/package.json',
      5000
    );
  });

  it('should return null if the latest version is the same as the current version', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    fetchWithTimeout.mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    });
    const result = await checkForUpdates();
    expect(result).toBeNull();
  });

  it('should return null if the latest version is older than the current version', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.1.0',
    });
    fetchWithTimeout.mockResolvedValue({
      ok: true,
      json: async () => ({ version: '1.0.0' }),
    });
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
    fetchWithTimeout.mockResolvedValue({
      ok: false,
    });
    const result = await checkForUpdates();
    expect(result).toBeNull();
  });

  it('should return null if fetch throws an error', async () => {
    getPackageJson.mockResolvedValue({
      name: 'test-package',
      version: '1.0.0',
    });
    fetchWithTimeout.mockRejectedValue(new Error('Network error'));
    const result = await checkForUpdates();
    expect(result).toBeNull();
  });
});
