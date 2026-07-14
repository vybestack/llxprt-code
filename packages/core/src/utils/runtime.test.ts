/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { isBunRuntime, isBunPosix, isWindows } from './runtime.js';

describe('runtime detection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('isBunRuntime', () => {
    it('returns false when process.versions.bun is undefined', () => {
      vi.stubGlobal('process', {
        platform: 'linux',
        versions: { bun: undefined },
      });
      expect(isBunRuntime()).toBe(false);
    });

    it('returns true when process.versions.bun is a version string', () => {
      vi.stubGlobal('process', {
        platform: 'linux',
        versions: { bun: '1.3.14' },
      });
      expect(isBunRuntime()).toBe(true);
    });

    it('is synchronous (returns a boolean, not a promise)', () => {
      vi.stubGlobal('process', {
        platform: 'linux',
        versions: { bun: '1.3.14' },
      });
      const result = isBunRuntime();
      expect(typeof result).toBe('boolean');
    });

    it('does not throw when versions object is missing bun key entirely', () => {
      vi.stubGlobal('process', {
        platform: 'linux',
        versions: {},
      });
      expect(() => isBunRuntime()).not.toThrow();
      expect(isBunRuntime()).toBe(false);
    });

    it('does not throw when versions is undefined', () => {
      vi.stubGlobal('process', {
        platform: 'linux',
        versions: undefined,
      });
      expect(() => isBunRuntime()).not.toThrow();
      expect(isBunRuntime()).toBe(false);
    });

    it('does not throw when process global is undefined', () => {
      vi.stubGlobal('process', undefined);
      expect(() => isBunRuntime()).not.toThrow();
      expect(isBunRuntime()).toBe(false);
    });

    it('does not throw when process global is null', () => {
      vi.stubGlobal('process', null);
      expect(() => isBunRuntime()).not.toThrow();
      expect(isBunRuntime()).toBe(false);
    });

    it('returns false when bun version is a non-string value', () => {
      vi.stubGlobal('process', {
        platform: 'linux',
        versions: { bun: 1 },
      });
      expect(isBunRuntime()).toBe(false);
    });

    it('returns false when bun version is null', () => {
      vi.stubGlobal('process', {
        platform: 'linux',
        versions: { bun: null },
      });
      expect(isBunRuntime()).toBe(false);
    });

    it('returns false when bun version is an empty string', () => {
      vi.stubGlobal('process', {
        platform: 'linux',
        versions: { bun: '' },
      });
      expect(isBunRuntime()).toBe(false);
    });
  });

  describe('isBunPosix', () => {
    it('returns false when not running under Bun', () => {
      vi.stubGlobal('process', {
        platform: 'linux',
        versions: { bun: undefined },
      });
      expect(isBunPosix()).toBe(false);
    });

    it('returns true when under Bun on linux', () => {
      vi.stubGlobal('process', {
        platform: 'linux',
        versions: { bun: '1.3.14' },
      });
      expect(isBunPosix()).toBe(true);
    });

    it('returns true when under Bun on darwin', () => {
      vi.stubGlobal('process', {
        platform: 'darwin',
        versions: { bun: '1.3.14' },
      });
      expect(isBunPosix()).toBe(true);
    });

    it('returns false when under Bun on an unsupported POSIX platform', () => {
      vi.stubGlobal('process', {
        platform: 'freebsd',
        versions: { bun: '1.3.14' },
      });
      expect(isBunPosix()).toBe(false);
    });

    it('returns false when under Bun on win32', () => {
      vi.stubGlobal('process', {
        platform: 'win32',
        versions: { bun: '1.3.14' },
      });
      expect(isBunPosix()).toBe(false);
    });

    it('returns false when process global is undefined', () => {
      vi.stubGlobal('process', undefined);
      expect(isBunPosix()).toBe(false);
    });

    it('returns false when under Bun but platform key is absent', () => {
      vi.stubGlobal('process', {
        versions: { bun: '1.3.14' },
      });
      expect(isBunPosix()).toBe(false);
    });
  });

  describe('isWindows', () => {
    it('returns true when platform is win32', () => {
      vi.stubGlobal('process', { platform: 'win32', versions: {} });
      expect(isWindows()).toBe(true);
    });

    it('returns false when platform is linux', () => {
      vi.stubGlobal('process', { platform: 'linux', versions: {} });
      expect(isWindows()).toBe(false);
    });

    it('returns false when platform is darwin', () => {
      vi.stubGlobal('process', { platform: 'darwin', versions: {} });
      expect(isWindows()).toBe(false);
    });

    it('returns false when platform is freebsd', () => {
      vi.stubGlobal('process', { platform: 'freebsd', versions: {} });
      expect(isWindows()).toBe(false);
    });

    it('returns false when platform is undefined', () => {
      vi.stubGlobal('process', { platform: undefined, versions: {} });
      expect(isWindows()).toBe(false);
    });

    it('does not throw when process global is undefined', () => {
      vi.stubGlobal('process', undefined);
      expect(() => isWindows()).not.toThrow();
      expect(isWindows()).toBe(false);
    });
  });
});
