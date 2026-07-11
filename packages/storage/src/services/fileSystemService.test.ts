/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { StandardFileSystemService } from './fileSystemService.js';

describe('StandardFileSystemService', () => {
  let fileSystem: StandardFileSystemService;
  let tempDir: string;

  beforeEach(async () => {
    fileSystem = new StandardFileSystemService();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'llxprt-storage-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('readTextFile', () => {
    it('should read file content using fs', async () => {
      const filePath = path.join(tempDir, 'test.txt');
      const testContent = 'Hello, World!';
      await fs.writeFile(filePath, testContent, 'utf-8');

      const result = await fileSystem.readTextFile(filePath);

      expect(result).toBe(testContent);
    });

    it('should propagate fs.readFile errors', () => {
      const filePath = path.join(tempDir, 'missing.txt');

      expect(fileSystem.readTextFile(filePath)).rejects.toThrow('ENOENT');
    });
  });

  describe('writeTextFile', () => {
    it('should write file content using fs', async () => {
      const filePath = path.join(tempDir, 'test.txt');

      await fileSystem.writeTextFile(filePath, 'Hello, World!');

      expect(await fs.readFile(filePath, 'utf-8')).toBe('Hello, World!');
    });
  });
});
