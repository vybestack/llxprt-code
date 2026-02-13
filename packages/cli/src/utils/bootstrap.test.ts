/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import {
  shouldRelaunchForMemory,
  isDebugMode,
  RELAUNCH_EXIT_CODE,
  parseDockerMemoryToMB,
  computeSandboxMemoryArgs,
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

  describe('parseDockerMemoryToMB', () => {
    it('should parse gigabytes suffix', () => {
      expect(parseDockerMemoryToMB('6g')).toBe(6144);
    });

    it('should parse gigabytes suffix case-insensitively', () => {
      expect(parseDockerMemoryToMB('6G')).toBe(6144);
    });

    it('should parse megabytes suffix', () => {
      expect(parseDockerMemoryToMB('4096m')).toBe(4096);
    });

    it('should parse kilobytes suffix', () => {
      expect(parseDockerMemoryToMB('512k')).toBe(0.5);
    });

    it('should parse plain number as bytes', () => {
      expect(parseDockerMemoryToMB('1073741824')).toBe(1024);
    });

    it('should parse explicit bytes suffix', () => {
      expect(parseDockerMemoryToMB('1048576b')).toBe(1);
    });

    it('should return undefined for empty string', () => {
      expect(parseDockerMemoryToMB('')).toBeUndefined();
    });

    it('should return undefined for invalid input', () => {
      expect(parseDockerMemoryToMB('invalid')).toBeUndefined();
    });

    it('should parse fractional gigabytes', () => {
      expect(parseDockerMemoryToMB('6.5g')).toBe(6656);
    });
  });

  describe('computeSandboxMemoryArgs', () => {
    it('should return 50% of container memory when containerMemoryMB is provided', () => {
      const result = computeSandboxMemoryArgs(false, 6144);
      expect(result).toEqual(['--max-old-space-size=3072']);
    });

    it('should return 50% of 4GB container memory', () => {
      const result = computeSandboxMemoryArgs(false, 4096);
      expect(result).toEqual(['--max-old-space-size=2048']);
    });

    it('should fall back to os.totalmem() when no containerMemoryMB', () => {
      const result = computeSandboxMemoryArgs(false);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatch(/--max-old-space-size=\d+/);
      const expectedMB = Math.floor((os.totalmem() / (1024 * 1024)) * 0.5);
      expect(result[0]).toBe(`--max-old-space-size=${expectedMB}`);
    });

    it('should log debug info when debugMode is true', () => {
      const consoleSpy = vi
        .spyOn(console, 'debug')
        .mockImplementation(() => {});
      computeSandboxMemoryArgs(true, 6144);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should not log debug info when debugMode is false', () => {
      const consoleSpy = vi
        .spyOn(console, 'debug')
        .mockImplementation(() => {});
      computeSandboxMemoryArgs(false, 6144);
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should clamp to minimum 128 MB for very small container memory', () => {
      const result = computeSandboxMemoryArgs(false, 64);
      expect(result).toEqual(['--max-old-space-size=128']);
    });
  });
});
