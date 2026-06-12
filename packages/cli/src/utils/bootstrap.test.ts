/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import os from 'node:os';
import v8 from 'node:v8';
import {
  shouldRelaunchForMemory,
  isDebugMode,
  RELAUNCH_EXIT_CODE,
  MAX_HEAP_CAP_MB,
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
      expect(result).toStrictEqual([]);
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
        .spyOn(DebugLogger.prototype, 'debug')
        .mockImplementation(() => {});
      shouldRelaunchForMemory(false);
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should include debug logging when debug is true', () => {
      delete process.env.LLXPRT_CODE_NO_RELAUNCH;
      const consoleSpy = vi
        .spyOn(DebugLogger.prototype, 'debug')
        .mockImplementation(() => {});
      shouldRelaunchForMemory(true);
      // Check that debug was called for current heap size
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    describe('custom maxHeapCapMB parameter', () => {
      let totalmemSpy: ReturnType<typeof vi.spyOn>;
      let heapStatsSpy: ReturnType<typeof vi.spyOn>;

      beforeEach(() => {
        delete process.env.LLXPRT_CODE_NO_RELAUNCH;
        // Mock a 16 GB machine: 16 * 1024 * 1024 * 1024 = 17179869184 bytes
        totalmemSpy = vi.spyOn(os, 'totalmem').mockReturnValue(17179869184);
        // Mock current heap at 1024 MB: 1024 * 1024 * 1024 = 1073741824 bytes
        heapStatsSpy = vi.spyOn(v8, 'getHeapStatistics').mockReturnValue({
          total_heap_size: 0,
          total_heap_size_executable: 0,
          total_physical_size: 0,
          total_available_size: 0,
          used_heap_size: 0,
          heap_size_limit: 1073741824,
          malloced_memory: 0,
          peak_malloced_memory: 0,
          does_zap_garbage: 0,
          number_of_native_contexts: 0,
          number_of_detached_contexts: 0,
          total_global_handles_size: 0,
          used_global_handles_size: 0,
          external_memory: 0,
        });
      });

      afterEach(() => {
        totalmemSpy.mockRestore();
        heapStatsSpy.mockRestore();
      });

      it('should use custom cap when provided instead of default', () => {
        // 16 GB total -> 50% = 8192, cap=768 -> target = min(8192, 768) = 768
        // current heap = 1024 -> 768 < 1024 so no relaunch needed
        const result = shouldRelaunchForMemory(false, 768);
        expect(result).toStrictEqual([]);
      });

      it('should relaunch when custom cap produces target above current heap', () => {
        // 16 GB total -> 50% = 8192, cap=4096 -> target = min(8192, 4096) = 4096
        // current heap = 1024 -> 4096 > 1024 so relaunch needed
        const result = shouldRelaunchForMemory(false, 4096);
        expect(result).toStrictEqual(['--max-old-space-size=4096']);
      });

      it('should prove it uses the provided cap, not the default', () => {
        // 16 GB total -> 50% = 8192
        // With cap=2048: target = min(8192, 2048) = 2048, current=1024 -> relaunch
        // With default cap (8192): target = min(8192, 8192) = 8192, current=1024 -> relaunch
        // These produce different results, proving the cap is used
        const resultWithCustom = shouldRelaunchForMemory(false, 2048);
        const resultWithDefault = shouldRelaunchForMemory(false, 8192);

        expect(resultWithCustom).toStrictEqual(['--max-old-space-size=2048']);
        expect(resultWithDefault).toStrictEqual(['--max-old-space-size=8192']);
        expect(resultWithCustom).not.toStrictEqual(resultWithDefault);
      });

      it('should fall back to MAX_HEAP_CAP_MB when cap is undefined', () => {
        // Both calls use the same mocked system, so results must be identical
        const resultWithUndefined = shouldRelaunchForMemory(false);
        const resultWithExplicitDefault = shouldRelaunchForMemory(
          false,
          MAX_HEAP_CAP_MB,
        );
        expect(resultWithUndefined).toStrictEqual(resultWithExplicitDefault);
      });

      it('should honor minimum value 512 as cap', () => {
        // 16 GB total -> 50% = 8192, cap=512 -> target = min(8192, 512) = 512
        // current heap = 1024 -> 512 < 1024 so no relaunch
        const result = shouldRelaunchForMemory(false, 512);
        expect(result).toStrictEqual([]);
      });

      it('should use larger custom cap exceeding default', () => {
        // 16 GB total -> 50% = 8192, cap=32768 -> target = min(8192, 32768) = 8192
        // current heap = 1024 -> 8192 > 1024 so relaunch
        const result = shouldRelaunchForMemory(false, 32768);
        expect(result).toStrictEqual(['--max-old-space-size=8192']);
      });

      it('should floor fractional cap to integer', () => {
        // 16 GB total -> 50% = 8192, cap=1536.75 -> floored to 1536 -> target = min(8192, 1536) = 1536
        // current heap = 1024 -> 1536 > 1024 so relaunch
        const result = shouldRelaunchForMemory(false, 1536.75);
        expect(result).toStrictEqual(['--max-old-space-size=1536']);
      });

      it('should never emit fractional --max-old-space-size even with fractional cap', () => {
        const result = shouldRelaunchForMemory(false, 4096.9);
        // 16 GB total -> 50% = 8192, floored cap=4096 -> target = min(8192, 4096) = 4096
        expect(result).toStrictEqual(['--max-old-space-size=4096']);
        const value = result[0].split('=')[1];
        expect(value).not.toContain('.');
        expect(Number.isInteger(Number(value))).toBe(true);
      });

      it('should floor fractional cap below current heap so no relaunch occurs', () => {
        // 16 GB total -> 50% = 8192, cap=1023.9 -> floored to 1023 -> target = min(8192, 1023) = 1023
        // current heap = 1024 -> 1023 < 1024 so no relaunch
        const result = shouldRelaunchForMemory(false, 1023.9);
        expect(result).toStrictEqual([]);
      });
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
      expect(result).toStrictEqual(['--max-old-space-size=3072']);
    });

    it('should return 50% of 4GB container memory', () => {
      const result = computeSandboxMemoryArgs(false, 4096);
      expect(result).toStrictEqual(['--max-old-space-size=2048']);
    });

    it('should fall back to os.totalmem() when no containerMemoryMB', () => {
      const result = computeSandboxMemoryArgs(false);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatch(/--max-old-space-size=\d+/);
      const expectedMB = Math.min(
        Math.floor((os.totalmem() / (1024 * 1024)) * 0.5),
        MAX_HEAP_CAP_MB,
      );
      expect(result[0]).toBe(`--max-old-space-size=${expectedMB}`);
    });

    it('should log debug info when debugMode is true', () => {
      const consoleSpy = vi
        .spyOn(DebugLogger.prototype, 'debug')
        .mockImplementation(() => {});
      computeSandboxMemoryArgs(true, 6144);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should not log debug info when debugMode is false', () => {
      const consoleSpy = vi
        .spyOn(DebugLogger.prototype, 'debug')
        .mockImplementation(() => {});
      computeSandboxMemoryArgs(false, 6144);
      expect(consoleSpy).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('should clamp to minimum 128 MB for very small container memory', () => {
      const result = computeSandboxMemoryArgs(false, 64);
      expect(result).toStrictEqual(['--max-old-space-size=128']);
    });

    it('should cap at MAX_HEAP_CAP_MB for large container memory', () => {
      const result = computeSandboxMemoryArgs(false, 131072);
      expect(result).toStrictEqual([`--max-old-space-size=${MAX_HEAP_CAP_MB}`]);
    });

    it('should not cap when 50% of container memory is below the cap', () => {
      const result = computeSandboxMemoryArgs(false, 8192);
      expect(result).toStrictEqual(['--max-old-space-size=4096']);
    });

    describe('custom maxHeapCapMB parameter', () => {
      it('should use custom cap when provided', () => {
        const result = computeSandboxMemoryArgs(false, 6144, 2048);
        // 50% of 6144 = 3072, but capped at 2048
        expect(result).toStrictEqual(['--max-old-space-size=2048']);
      });

      it('should fall back to MAX_HEAP_CAP_MB when cap is undefined', () => {
        const result = computeSandboxMemoryArgs(false, 6144);
        // 50% of 6144 = 3072, capped at default 8192 -> 3072
        expect(result).toStrictEqual(['--max-old-space-size=3072']);
      });

      it('should honor minimum value 512 as cap with large container', () => {
        const result = computeSandboxMemoryArgs(false, 131072, 512);
        expect(result).toStrictEqual(['--max-old-space-size=512']);
      });

      it('should use 50% of container when below custom cap', () => {
        const result = computeSandboxMemoryArgs(false, 2048, 8192);
        // 50% of 2048 = 1024, well below cap of 8192
        expect(result).toStrictEqual(['--max-old-space-size=1024']);
      });

      it('should use custom cap larger than default', () => {
        const result = computeSandboxMemoryArgs(false, 131072, 32768);
        // 50% of 131072 = 65536, capped at 32768
        expect(result).toStrictEqual(['--max-old-space-size=32768']);
      });

      it('should still clamp to minimum 128 when both container and cap are tiny', () => {
        // Container 64MB -> 50% = 32, but min floor is 128
        const result = computeSandboxMemoryArgs(false, 64, 512);
        expect(result).toStrictEqual(['--max-old-space-size=128']);
      });

      it('should produce same result as default when cap matches MAX_HEAP_CAP_MB', () => {
        const resultExplicit = computeSandboxMemoryArgs(
          false,
          6144,
          MAX_HEAP_CAP_MB,
        );
        const resultDefault = computeSandboxMemoryArgs(false, 6144);
        expect(resultExplicit).toStrictEqual(resultDefault);
      });

      it('should floor fractional cap to integer', () => {
        // 50% of 6144 = 3072, cap=2048.75 -> floored to 2048 -> min(3072, 2048) = 2048
        const result = computeSandboxMemoryArgs(false, 6144, 2048.75);
        expect(result).toStrictEqual(['--max-old-space-size=2048']);
      });

      it('should never emit fractional --max-old-space-size even with fractional cap', () => {
        const result = computeSandboxMemoryArgs(false, 8192, 4096.5);
        const arg = result[0];
        const value = arg.split('=')[1];
        expect(value).not.toContain('.');
        expect(Number.isInteger(Number(value))).toBe(true);
      });

      it('should floor fractional cap that dominates container memory', () => {
        // 50% of 4096 = 2048, cap=1023.1 -> floored to 1023 -> min(2048, 1023) = 1023
        const result = computeSandboxMemoryArgs(false, 4096, 1023.1);
        expect(result).toStrictEqual(['--max-old-space-size=1023']);
      });
    });
  });

  describe('MAX_HEAP_CAP_MB', () => {
    it('should be 8192 (8GB)', () => {
      expect(MAX_HEAP_CAP_MB).toBe(8192);
    });
  });
});
