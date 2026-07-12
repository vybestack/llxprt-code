/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach } from 'bun:test';
import { createReleaseChannelDetector } from './channel.js';

describe('channel', () => {
  let getPackageJson: ReturnType<typeof vi.fn>;
  let detector: ReturnType<typeof createReleaseChannelDetector>;
  let isNightly: typeof detector.isNightly;
  let isPreview: typeof detector.isPreview;
  let isStable: typeof detector.isStable;

  beforeEach(() => {
    getPackageJson = vi.fn();
    detector = createReleaseChannelDetector(getPackageJson);
    ({ isNightly, isPreview, isStable } = detector);
  });

  describe('isStable', () => {
    it('should return true for a stable version', async () => {
      getPackageJson.mockResolvedValue({
        name: 'test',
        version: '1.0.0',
      });
      expect(await isStable('/test/dir')).toBe(true);
    });

    it('should return false for a nightly version', async () => {
      getPackageJson.mockResolvedValue({
        name: 'test',
        version: '1.0.0-nightly.1',
      });
      expect(await isStable('/test/dir')).toBe(false);
    });

    it('should return false for a preview version', async () => {
      getPackageJson.mockResolvedValue({
        name: 'test',
        version: '1.0.0-preview.1',
      });
      expect(await isStable('/test/dir')).toBe(false);
    });

    it('should return false if package.json is not found', async () => {
      getPackageJson.mockResolvedValue(undefined);
      expect(await isStable('/test/dir')).toBe(false);
    });

    it('should return false if version is not defined', async () => {
      getPackageJson.mockResolvedValue({
        name: 'test',
      });
      expect(await isStable('/test/dir')).toBe(false);
    });
  });

  describe('isNightly', () => {
    it('should return false for a stable version', async () => {
      getPackageJson.mockResolvedValue({
        name: 'test',
        version: '1.0.0',
      });
      expect(await isNightly('/test/dir')).toBe(false);
    });

    it('should return true for a nightly version', async () => {
      getPackageJson.mockResolvedValue({
        name: 'test',
        version: '1.0.0-nightly.1',
      });
      expect(await isNightly('/test/dir')).toBe(true);
    });

    it('should return false for a preview version', async () => {
      getPackageJson.mockResolvedValue({
        name: 'test',
        version: '1.0.0-preview.1',
      });
      expect(await isNightly('/test/dir')).toBe(false);
    });

    it('should return true if package.json is not found', async () => {
      getPackageJson.mockResolvedValue(undefined);
      expect(await isNightly('/test/dir')).toBe(true);
    });

    it('should return true if version is not defined', async () => {
      getPackageJson.mockResolvedValue({
        name: 'test',
      });
      expect(await isNightly('/test/dir')).toBe(true);
    });
  });

  describe('isPreview', () => {
    it('should return false for a stable version', async () => {
      getPackageJson.mockResolvedValue({
        name: 'test',
        version: '1.0.0',
      });
      expect(await isPreview('/test/dir')).toBe(false);
    });

    it('should return false for a nightly version', async () => {
      getPackageJson.mockResolvedValue({
        name: 'test',
        version: '1.0.0-nightly.1',
      });
      expect(await isPreview('/test/dir')).toBe(false);
    });

    it('should return true for a preview version', async () => {
      getPackageJson.mockResolvedValue({
        name: 'test',
        version: '1.0.0-preview.1',
      });
      expect(await isPreview('/test/dir')).toBe(true);
    });

    it('should return false if package.json is not found', async () => {
      getPackageJson.mockResolvedValue(undefined);
      expect(await isPreview('/test/dir')).toBe(false);
    });

    it('should return false if version is not defined', async () => {
      getPackageJson.mockResolvedValue({
        name: 'test',
      });
      expect(await isPreview('/test/dir')).toBe(false);
    });
  });

  describe('memoization', () => {
    it('should only call getPackageJson once for the same cwd', async () => {
      const spy = getPackageJson.mockResolvedValue({
        name: 'test',
        version: '1.0.0',
      });

      expect(await isStable('/test/dir')).toBe(true);
      expect(await isNightly('/test/dir')).toBe(false);
      expect(await isPreview('/test/dir')).toBe(false);

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('should call getPackageJson again for a different cwd', async () => {
      const spy = getPackageJson.mockResolvedValue({
        name: 'test',
        version: '1.0.0',
      });

      expect(await isStable('/test/dir1')).toBe(true);
      expect(await isStable('/test/dir2')).toBe(true);

      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
