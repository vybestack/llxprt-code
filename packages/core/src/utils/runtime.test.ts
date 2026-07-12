/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { createRuntimeDetector } from './runtime.js';

describe('runtime detection', () => {
  const detect = (processValue: unknown) =>
    createRuntimeDetector(() => processValue);

  describe('isBunRuntime', () => {
    it('returns false when process.versions.bun is undefined', () => {
      const detector = detect({
        platform: 'linux',
        versions: { bun: undefined },
      });
      expect(detector.isBunRuntime()).toBe(false);
    });

    it('returns true when process.versions.bun is a version string', () => {
      const detector = detect({
        platform: 'linux',
        versions: { bun: '1.3.14' },
      });
      expect(detector.isBunRuntime()).toBe(true);
    });

    it('is synchronous (returns a boolean, not a promise)', () => {
      const detector = detect({
        platform: 'linux',
        versions: { bun: '1.3.14' },
      });
      const result = detector.isBunRuntime();
      expect(typeof result).toBe('boolean');
    });

    it('does not throw when versions object is missing bun key entirely', () => {
      const detector = detect({
        platform: 'linux',
        versions: {},
      });
      expect(() => detector.isBunRuntime()).not.toThrow();
      expect(detector.isBunRuntime()).toBe(false);
    });

    it('does not throw when versions is undefined', () => {
      const detector = detect({
        platform: 'linux',
        versions: undefined,
      });
      expect(() => detector.isBunRuntime()).not.toThrow();
      expect(detector.isBunRuntime()).toBe(false);
    });

    it('does not throw when process global is undefined', () => {
      const detector = detect(undefined);
      expect(() => detector.isBunRuntime()).not.toThrow();
      expect(detector.isBunRuntime()).toBe(false);
    });

    it('does not throw when process global is null', () => {
      const detector = detect(null);
      expect(() => detector.isBunRuntime()).not.toThrow();
      expect(detector.isBunRuntime()).toBe(false);
    });

    it('returns false when bun version is a non-string value', () => {
      const detector = detect({
        platform: 'linux',
        versions: { bun: 1 },
      });
      expect(detector.isBunRuntime()).toBe(false);
    });

    it('returns false when bun version is null', () => {
      const detector = detect({
        platform: 'linux',
        versions: { bun: null },
      });
      expect(detector.isBunRuntime()).toBe(false);
    });

    it('returns false when bun version is an empty string', () => {
      const detector = detect({
        platform: 'linux',
        versions: { bun: '' },
      });
      expect(detector.isBunRuntime()).toBe(false);
    });
  });

  describe('isBunPosix', () => {
    it('returns false when not running under Bun', () => {
      const detector = detect({
        platform: 'linux',
        versions: { bun: undefined },
      });
      expect(detector.isBunPosix()).toBe(false);
    });

    it('returns true when under Bun on linux', () => {
      const detector = detect({
        platform: 'linux',
        versions: { bun: '1.3.14' },
      });
      expect(detector.isBunPosix()).toBe(true);
    });

    it('returns true when under Bun on darwin', () => {
      const detector = detect({
        platform: 'darwin',
        versions: { bun: '1.3.14' },
      });
      expect(detector.isBunPosix()).toBe(true);
    });

    it('returns false when under Bun on an unsupported POSIX platform', () => {
      const detector = detect({
        platform: 'freebsd',
        versions: { bun: '1.3.14' },
      });
      expect(detector.isBunPosix()).toBe(false);
    });

    it('returns false when under Bun on win32', () => {
      const detector = detect({
        platform: 'win32',
        versions: { bun: '1.3.14' },
      });
      expect(detector.isBunPosix()).toBe(false);
    });

    it('returns false when process global is undefined', () => {
      const detector = detect(undefined);
      expect(detector.isBunPosix()).toBe(false);
    });

    it('returns false when under Bun but platform key is absent', () => {
      const detector = detect({
        versions: { bun: '1.3.14' },
      });
      expect(detector.isBunPosix()).toBe(false);
    });
  });

  describe('isWindows', () => {
    it('returns true when platform is win32', () => {
      const detector = detect({ platform: 'win32', versions: {} });
      expect(detector.isWindows()).toBe(true);
    });

    it('returns false when platform is linux', () => {
      const detector = detect({ platform: 'linux', versions: {} });
      expect(detector.isWindows()).toBe(false);
    });

    it('returns false when platform is darwin', () => {
      const detector = detect({ platform: 'darwin', versions: {} });
      expect(detector.isWindows()).toBe(false);
    });

    it('returns false when platform is freebsd', () => {
      const detector = detect({ platform: 'freebsd', versions: {} });
      expect(detector.isWindows()).toBe(false);
    });

    it('returns false when platform is undefined', () => {
      const detector = detect({ platform: undefined, versions: {} });
      expect(detector.isWindows()).toBe(false);
    });

    it('does not throw when process global is undefined', () => {
      const detector = detect(undefined);
      expect(() => detector.isWindows()).not.toThrow();
      expect(detector.isWindows()).toBe(false);
    });
  });
});
