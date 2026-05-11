/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  clipboardHasImage,
  saveClipboardImage,
  cleanupOldClipboardImages,
  splitEscapedPaths,
  parsePastedPaths,
} from './clipboardUtils.js';

describe('clipboardUtils', () => {
  describe('clipboardHasImage', () => {
    it('should return false on unsupported platforms', async () => {
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (process.platform !== 'darwin' && process.platform !== 'win32') {
        const result = await clipboardHasImage();
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
        expect(result).toBe(false);
      } else {
        // Skip on macOS/Windows as it would require actual clipboard state
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
        expect(true).toBe(true);
      }
    });

    it('should return boolean on macOS or Windows', async () => {
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (process.platform === 'darwin' || process.platform === 'win32') {
        const result = await clipboardHasImage();
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
        expect(typeof result).toBe('boolean');
      } else {
        // Skip on unsupported platforms
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
        expect(true).toBe(true);
      }
    }, 10000);
  });

  describe('saveClipboardImage', () => {
    it('should return null on unsupported platforms', async () => {
      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (process.platform !== 'darwin' && process.platform !== 'win32') {
        const result = await saveClipboardImage();
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
        expect(result).toBe(null);
      } else {
        // Skip on macOS/Windows
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
        expect(true).toBe(true);
      }
    });

    it('should handle errors gracefully', async () => {
      // Test with invalid directory (should not throw)
      const result = await saveClipboardImage(
        '/invalid/path/that/does/not/exist',
      );

      // eslint-disable-next-line vitest/no-conditional-in-test -- intentional: narrowing/filter/parameterized-test context
      if (process.platform === 'darwin' || process.platform === 'win32') {
        // On macOS/Windows, might return null due to various errors
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
        expect(result === null || typeof result === 'string').toBe(true);
      } else {
        // On other platforms, should always return null
        // eslint-disable-next-line vitest/no-conditional-expect -- intentional: narrowing/filter/property-test context
        expect(result).toBe(null);
      }
    });
  });

  describe('cleanupOldClipboardImages', () => {
    it('should not throw errors', async () => {
      // Should handle missing directories gracefully
      await expect(
        cleanupOldClipboardImages('/path/that/does/not/exist'),
      ).resolves.not.toThrow();
    });

    it('should complete without errors on valid directory', async () => {
      await expect(cleanupOldClipboardImages('.')).resolves.not.toThrow();
    });
  });

  describe('splitEscapedPaths', () => {
    it('should return single path when no spaces', () => {
      expect(splitEscapedPaths('/path/to/image.png')).toStrictEqual([
        '/path/to/image.png',
      ]);
    });

    it('should split simple space-separated paths', () => {
      expect(splitEscapedPaths('/img1.png /img2.png')).toStrictEqual([
        '/img1.png',
        '/img2.png',
      ]);
    });

    it('should split three paths', () => {
      expect(splitEscapedPaths('/a.png /b.jpg /c.heic')).toStrictEqual([
        '/a.png',
        '/b.jpg',
        '/c.heic',
      ]);
    });

    it('should preserve escaped spaces within filenames', () => {
      expect(splitEscapedPaths('/my\\\\ image.png')).toStrictEqual([
        '/my\\\\ image.png',
      ]);
    });

    it('should handle multiple paths with escaped spaces', () => {
      expect(
        splitEscapedPaths('/my\\\\ img1.png /my\\\\ img2.png'),
      ).toStrictEqual(['/my\\\\ img1.png', '/my\\\\ img2.png']);
    });

    it('should handle path with multiple escaped spaces', () => {
      expect(
        splitEscapedPaths('/path/to/my\\\\ cool\\\\ image.png'),
      ).toStrictEqual(['/path/to/my\\\\ cool\\\\ image.png']);
    });

    it('should handle multiple consecutive spaces between paths', () => {
      expect(splitEscapedPaths('/img1.png   /img2.png')).toStrictEqual([
        '/img1.png',
        '/img2.png',
      ]);
    });

    it('should handle trailing and leading whitespace', () => {
      expect(splitEscapedPaths('  /img1.png /img2.png  ')).toStrictEqual([
        '/img1.png',
        '/img2.png',
      ]);
    });

    it('should return empty array for empty string', () => {
      expect(splitEscapedPaths('')).toStrictEqual([]);
    });

    it('should return empty array for whitespace only', () => {
      expect(splitEscapedPaths('   ')).toStrictEqual([]);
    });
  });

  describe('parsePastedPaths', () => {
    it('should return null for empty string', () => {
      const result = parsePastedPaths('', () => true);
      expect(result).toBe(null);
    });

    it('should add @ prefix to single valid path', () => {
      const result = parsePastedPaths('/path/to/file.txt', () => true);
      expect(result).toBe('@/path/to/file.txt ');
    });

    it('should return null for single invalid path', () => {
      const result = parsePastedPaths('/path/to/file.txt', () => false);
      expect(result).toBe(null);
    });

    it('should add @ prefix to all valid paths', () => {
      const validPaths = new Set(['/path/to/file1.txt', '/path/to/file2.txt']);
      const result = parsePastedPaths(
        '/path/to/file1.txt /path/to/file2.txt',
        (p) => validPaths.has(p),
      );
      expect(result).toBe('@/path/to/file1.txt @/path/to/file2.txt ');
    });

    it('should only add @ prefix to valid paths', () => {
      const result = parsePastedPaths(
        '/valid/file.txt /invalid/file.jpg',
        (p) => p.endsWith('.txt'),
      );
      expect(result).toBe('@/valid/file.txt /invalid/file.jpg ');
    });

    it('should return null if no paths are valid', () => {
      const result = parsePastedPaths(
        '/path/to/file1.txt /path/to/file2.txt',
        () => false,
      );
      expect(result).toBe(null);
    });

    it('should handle paths with escaped spaces', () => {
      const validPaths = new Set(['/path/to/my file.txt', '/other/path.txt']);
      const result = parsePastedPaths(
        '/path/to/my\\ file.txt /other/path.txt',
        (p) => validPaths.has(p),
      );
      expect(result).toBe('@/path/to/my\\ file.txt @/other/path.txt ');
    });

    it('should unescape paths before validation', () => {
      const validPaths = new Set(['/my file.txt', '/other.txt']);
      const validatedPaths: string[] = [];
      parsePastedPaths('/my\\ file.txt /other.txt', (p) => {
        validatedPaths.push(p);
        return validPaths.has(p);
      });
      expect(validatedPaths).toStrictEqual([
        '/my\\ file.txt /other.txt',
        '/my file.txt',
        '/other.txt',
      ]);
    });

    it('should handle single path with unescaped spaces from copy-paste', () => {
      const result = parsePastedPaths('/path/to/my file.txt', () => true);
      expect(result).toBe('@/path/to/my\\ file.txt ');
    });

    it('should handle Windows path', () => {
      const result = parsePastedPaths('C:\\Users\\file.txt', () => true);
      expect(result).toBe('@C:\\Users\\file.txt ');
    });

    it('should handle Windows path with unescaped spaces', () => {
      const result = parsePastedPaths('C:\\My Documents\\file.txt', () => true);
      expect(result).toBe('@C:\\My\\ Documents\\file.txt ');
    });

    it('should handle multiple Windows paths', () => {
      const validPaths = new Set(['C:\\file1.txt', 'D:\\file2.txt']);
      const result = parsePastedPaths('C:\\file1.txt D:\\file2.txt', (p) =>
        validPaths.has(p),
      );
      expect(result).toBe('@C:\\file1.txt @D:\\file2.txt ');
    });

    it('should handle Windows UNC path', () => {
      const result = parsePastedPaths(
        '\\\\server\\share\\file.txt',
        () => true,
      );
      expect(result).toBe('@\\\\server\\share\\file.txt ');
    });
  });
});
