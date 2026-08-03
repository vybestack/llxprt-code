/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { StandardFileSystemService } from './fileSystemService.js';

const { mockReadFile, mockWriteFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: { readFile: mockReadFile, writeFile: mockWriteFile },
  readFile: mockReadFile,
  writeFile: mockWriteFile,
}));

describe('StandardFileSystemService', () => {
  let fileSystem: StandardFileSystemService;

  beforeEach(() => {
    vi.resetAllMocks();
    fileSystem = new StandardFileSystemService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('readTextFile', () => {
    it('should read file content using fs', async () => {
      const testContent = 'Hello, World!';
      mockReadFile.mockResolvedValue(testContent);

      const result = await fileSystem.readTextFile('/test/file.txt');

      expect(mockReadFile).toHaveBeenCalledWith('/test/file.txt', 'utf-8');
      expect(result).toBe(testContent);
    });

    it('should propagate fs.readFile errors', async () => {
      const error = new Error('ENOENT: File not found');
      mockReadFile.mockRejectedValue(error);

      await expect(fileSystem.readTextFile('/test/file.txt')).rejects.toThrow(
        'ENOENT: File not found',
      );
    });
  });

  describe('writeTextFile', () => {
    it('should write file content using fs', async () => {
      mockWriteFile.mockResolvedValue();

      await fileSystem.writeTextFile('/test/file.txt', 'Hello, World!');

      expect(mockWriteFile).toHaveBeenCalledWith(
        '/test/file.txt',
        'Hello, World!',
        'utf-8',
      );
    });
  });
});
