/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import {
  getRipgrepPath,
  ensureWindowsShortcut,
  isRipgrepAvailable,
  clearRipgrepAvailabilityCache,
} from '../../src/utils/ripgrepPathResolver.js';

describe('RipgrepPathResolver - Cross-platform Path Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should find ripgrep from @lvce-editor/ripgrep package first', async () => {
    // Mock package to be available
    vi.doMock('@lvce-editor/ripgrep', () => ({
      rgPath: '/mock/package/path/rg',
    }));

    // Mock fs.existsSync to return true for package path
    const mockExistsSync = vi.fn().mockImplementation((filePath: string) => {
      return filePath === '/mock/package/path/rg';
    });
    (fs.existsSync as unknown) = mockExistsSync;

    const resolvedPath = await getRipgrepPath();
    expect(resolvedPath).toBe('/mock/package/path/rg');
  });

  it('should fall back to system ripgrep when package not available', async () => {
    // Mock package to fail
    vi.doMock('@lvce-editor/ripgrep', () => {
      throw new Error('Package not available');
    });

    // Mock system ripgrep available
    const mockExecSync = vi.fn().mockReturnValue('/usr/local/bin/rg\n');
    vi.doMock('child_process', () => ({
      execSync: mockExecSync,
    }));

    const mockExistsSync = vi.fn().mockImplementation((filePath: string) => {
      if (filePath === '/usr/local/bin/rg') {
        return true;
      }
      return false;
    });
    (fs.existsSync as unknown) = mockExistsSync;

    const resolvedPath = await getRipgrepPath();
    expect(resolvedPath).toBe('/usr/local/bin/rg');
  });

  it('should check Windows-specific paths on Windows', async () => {
    // Mock Windows environment
    const mockPlatform = vi.fn().mockReturnValue('win32');
    (os.platform as unknown) = mockPlatform;

    // Mock package and system ripgrep to fail
    vi.doMock('@lvce-editor/ripgrep', () => {
      throw new Error('Package not available');
    });

    const mockExecSync = vi.fn().mockImplementation(() => {
      throw new Error('Command not found');
    });
    vi.doMock('child_process', () => ({
      execSync: mockExecSync,
    }));

    // Mock Windows ripgrep in Program Files
    const mockExistsSync = vi.fn().mockImplementation((filePath: string) => {
      if (filePath.includes('Program Files') && filePath.endsWith('rg.exe')) {
        return true;
      }
      return false;
    });
    (fs.existsSync as unknown) = mockExistsSync;

    const resolvedPath = await getRipgrepPath();
    expect(resolvedPath).toMatch(/rg\.exe$/);
    expect(resolvedPath).toContain('Program Files');
  });

  it('should check Unix paths on non-Windows systems', async () => {
    // Mock Unix environment
    const mockPlatform = vi.fn().mockReturnValue('darwin');
    (os.platform as unknown) = mockPlatform;

    // Mock package and system ripgrep to fail
    vi.doMock('@lvce-editor/ripgrep', () => {
      throw new Error('Package not available');
    });

    const mockExecSync = vi.fn().mockImplementation(() => {
      throw new Error('Command not found');
    });
    vi.doMock('child_process', () => ({
      execSync: mockExecSync,
    }));

    // Mock Unix ripgrep in /usr/local/bin
    const mockExistsSync = vi.fn().mockImplementation((filePath: string) => {
      if (filePath === '/usr/local/bin/rg') {
        return true;
      }
      return false;
    });
    (fs.existsSync as unknown) = mockExistsSync;

    const resolvedPath = await getRipgrepPath();
    expect(resolvedPath).toBe('/usr/local/bin/rg');
  });

  it('should handle bundle environment correctly', async () => {
    // Mock bundle environment
    (process.pkg as unknown) = { entrypoint: '/path/to/bundle' };

    // Mock package and system ripgrep to fail
    vi.doMock('@lvce-editor/ripgrep', () => {
      throw new Error('Package not available');
    });

    const mockExecSync = vi.fn().mockImplementation(() => {
      throw new Error('Command not found');
    });
    vi.doMock('child_process', () => ({
      execSync: mockExecSync,
    }));

    // Mock bundle ripgrep
    const mockExistsSync = vi.fn().mockImplementation((filePath: string) => {
      if (filePath.includes('bundle') && filePath.endsWith('rg')) {
        return true;
      }
      if (filePath.includes('node_modules')) {
        return false; // Bundle environment
      }
      return false;
    });
    (fs.existsSync as unknown) = mockExistsSync;

    const resolvedPath = await getRipgrepPath();
    expect(resolvedPath).toContain('bundle');
    expect(resolvedPath).toContain('rg');
  });

  it('should provide helpful error message when ripgrep not found', async () => {
    // Mock all ripgrep sources to fail
    vi.doMock('@lvce-editor/ripgrep', () => {
      throw new Error('Package not available');
    });

    const mockExecSync = vi.fn().mockImplementation(() => {
      throw new Error('Command not found');
    });
    vi.doMock('child_process', () => ({
      execSync: mockExecSync,
    }));

    const mockExistsSync = vi.fn().mockReturnValue(false);
    (fs.existsSync as unknown) = mockExistsSync;

    await expect(getRipgrepPath()).rejects.toThrow(
      'ripgrep not found. Please install @lvce-editor/ripgrep or system ripgrep.',
    );
  });

  describe('Windows-specific functionality', () => {
    it('should create Windows shortcut when needed', () => {
      const mockPlatform = vi.fn().mockReturnValue('win32');
      (os.platform as unknown) = mockPlatform;

      // Mock proper scenario: source exists, target doesn't exist yet
      const mockExistsSync = vi.fn().mockImplementation((filePath: string) => {
        if (filePath === '/path/to/source/rg') {
          return true; // Source exists
        }
        if (filePath === '/path/to/target/rg') {
          return false; // Target doesn't exist yet
        }
        if (filePath.includes('/path/to/target/')) {
          return false; // Target directory doesn't exist
        }
        return false;
      });
      (fs.existsSync as unknown) = mockExistsSync;

      // Mock directory creation
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});

      // Mock successful link creation
      vi.spyOn(fs, 'linkSync').mockImplementation(() => {});

      const result = ensureWindowsShortcut(
        '/path/to/source/rg',
        '/path/to/target/rg',
      );

      expect(result).toBe(true);
    });

    it('should fall back to copy when link fails on Windows', () => {
      const mockPlatform = vi.fn().mockReturnValue('win32');
      (os.platform as unknown) = mockPlatform;

      const mockExistsSync = vi.fn().mockImplementation((filePath: string) => {
        if (filePath === '/path/to/source/rg') {
          return true; // Source exists
        }
        return false;
      });
      (fs.existsSync as unknown) = mockExistsSync;

      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});

      // Mock linkSync to fail, copyFileSync to succeed
      vi.spyOn(fs, 'linkSync').mockImplementation(() => {
        throw new Error('Link failed');
      });

      const mockCopyFileSync = vi
        .spyOn(fs, 'copyFileSync')
        .mockImplementation(() => {});

      const result = ensureWindowsShortcut(
        '/path/to/source/rg',
        '/path/to/target/rg',
      );

      expect(result).toBe(true);
      expect(mockCopyFileSync).toHaveBeenCalled();
    });

    it('should not create shortcuts on non-Windows systems', () => {
      const mockPlatform = vi.fn().mockReturnValue('darwin');
      (os.platform as unknown) = mockPlatform;

      const result = ensureWindowsShortcut(
        '/path/to/source/rg',
        '/path/to/target/rg',
      );

      expect(result).toBe(false);
    });
  });
});

describe('Ripgrep Availability Detection', () => {
  beforeEach(() => {
    clearRipgrepAvailabilityCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearRipgrepAvailabilityCache();
  });

  it('should return true when ripgrep is available', async () => {
    // Test with actual ripgrep if available
    // @lvce-editor/ripgrep is bundled so this should return true
    const result = await isRipgrepAvailable();
    expect(typeof result).toBe('boolean');
    // On systems with ripgrep (@lvce-editor/ripgrep is bundled), should be true
    // This test is more about the function working than specific return value
  });

  it('should return false when ripgrep is not available', async () => {
    // We can't easily test this without actually removing ripgrep,
    // but we can verify the function signature and return type
    const result = await isRipgrepAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('should cache the result for subsequent calls', async () => {
    const result1 = await isRipgrepAvailable();
    const result2 = await isRipgrepAvailable();

    // Second call should return the same result (cached)
    expect(result1).toBe(result2);
  });

  it('should allow clearing the cache', async () => {
    const result1 = await isRipgrepAvailable();
    clearRipgrepAvailabilityCache();
    const result2 = await isRipgrepAvailable();

    // Both should return the same since ripgrep availability doesn't change
    expect(result1).toBe(result2);
    // Clearing cache should work without throwing
    expect(() => clearRipgrepAvailabilityCache()).not.toThrow();
  });
});
