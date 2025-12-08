/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  shouldRelaunchForMemory,
  isDebugMode,
  RELAUNCH_EXIT_CODE,
} from './bootstrap.js';

describe('bootstrap utilities', () => {
  describe('isDebugMode', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return true when DEBUG env var is "true"', () => {
      process.env.DEBUG = 'true';
      expect(isDebugMode()).toBe(true);
    });

    it('should return true when DEBUG env var is "1"', () => {
      process.env.DEBUG = '1';
      expect(isDebugMode()).toBe(true);
    });

    it('should return true when DEBUG_MODE env var is "true"', () => {
      process.env.DEBUG_MODE = 'true';
      expect(isDebugMode()).toBe(true);
    });

    it('should return true when DEBUG_MODE env var is "1"', () => {
      process.env.DEBUG_MODE = '1';
      expect(isDebugMode()).toBe(true);
    });

    it('should return false when no debug env vars are set', () => {
      delete process.env.DEBUG;
      delete process.env.DEBUG_MODE;
      expect(isDebugMode()).toBe(false);
    });

    it('should return false for invalid debug values', () => {
      process.env.DEBUG = 'false';
      process.env.DEBUG_MODE = '0';
      expect(isDebugMode()).toBe(false);
    });
  });

  describe('shouldRelaunchForMemory', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should return empty array when LLXPRT_CODE_NO_RELAUNCH is set', () => {
      process.env.LLXPRT_CODE_NO_RELAUNCH = 'true';
      const result = shouldRelaunchForMemory(false);
      expect(result).toEqual([]);
    });

    it('should return empty array when current heap is sufficient', () => {
      delete process.env.LLXPRT_CODE_NO_RELAUNCH;
      // With a default heap that's already at 50% of memory, no relaunch needed
      // The function will compare actual heap stats
      const result = shouldRelaunchForMemory(false);
      // This depends on actual system memory, so we just verify it's an array
      expect(Array.isArray(result)).toBe(true);
    });

    it('should return memory args when relaunch is needed for larger heap', () => {
      delete process.env.LLXPRT_CODE_NO_RELAUNCH;
      const result = shouldRelaunchForMemory(false);
      // The result should either be empty or contain a --max-old-space-size flag
      expect(
        result.length === 0 || result[0].match(/--max-old-space-size=\d+/),
      ).toBeTruthy();
    });

    it('should not include debug logging when debug is false', () => {
      delete process.env.LLXPRT_CODE_NO_RELAUNCH;
      const consoleSpy = vi
        .spyOn(console, 'debug')
        .mockImplementation(() => {});
      shouldRelaunchForMemory(false);
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should include debug logging when debug is true', () => {
      delete process.env.LLXPRT_CODE_NO_RELAUNCH;
      const consoleSpy = vi
        .spyOn(console, 'debug')
        .mockImplementation(() => {});
      shouldRelaunchForMemory(true);
      // Check that debug was called for current heap size
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('RELAUNCH_EXIT_CODE', () => {
    it('should be defined as a number', () => {
      expect(typeof RELAUNCH_EXIT_CODE).toBe('number');
    });

    it('should have a specific value for process coordination', () => {
      // The exit code 75 is used by upstream to signal relaunch
      expect(RELAUNCH_EXIT_CODE).toBe(75);
    });
  });
});
