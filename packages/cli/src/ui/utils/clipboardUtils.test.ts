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
} from './clipboardUtils.js';

describe('clipboardUtils', () => {
  describe('clipboardHasImage', () => {
    it.skipIf(process.platform === 'darwin')(
      'should return false on non-macOS platforms',
      async () => {
        const result = await clipboardHasImage();
        expect(result).toBe(false);
      },
    );

    it.skipIf(process.platform !== 'darwin')(
      'should return boolean on macOS',
      async () => {
        const result = await clipboardHasImage();
        expect(typeof result).toBe('boolean');
      },
    );
  });

  describe('saveClipboardImage', () => {
    it.skipIf(process.platform === 'darwin')(
      'should return null on non-macOS platforms',
      async () => {
        const result = await saveClipboardImage();
        expect(result).toBe(null);
      },
    );

    it.skipIf(process.platform !== 'darwin')(
      'should handle errors gracefully on macOS',
      async () => {
        // Test with invalid directory (should not throw)
        const result = await saveClipboardImage(
          '/invalid/path/that/does/not/exist',
        );
        // On macOS, might return null due to various errors
        expect(result === null || typeof result === 'string').toBe(true);
      },
    );

    it.skipIf(process.platform === 'darwin')(
      'should return null on non-macOS platforms with invalid path',
      async () => {
        const result = await saveClipboardImage(
          '/invalid/path/that/does/not/exist',
        );
        // On other platforms, should always return null
        expect(result).toBe(null);
      },
    );
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
});
