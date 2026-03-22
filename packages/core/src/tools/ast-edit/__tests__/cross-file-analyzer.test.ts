/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CrossFileRelationshipAnalyzer,
  getWorkspaceFiles,
} from '../cross-file-analyzer.js';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import os from 'os';

describe('CrossFileRelationshipAnalyzer', () => {
  let testDir: string;
  let analyzer: CrossFileRelationshipAnalyzer;

  beforeEach(async () => {
    testDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'cross-file-test-'),
    );
    analyzer = new CrossFileRelationshipAnalyzer();
  });

  afterEach(async () => {
    await fsPromises.rm(testDir, { recursive: true, force: true });
  });

  describe('findRelatedFiles', () => {
    it('should find related files via imports', async () => {
      // Create two related files
      const file1 = path.join(testDir, 'main.ts');
      const file2 = path.join(testDir, 'helper.ts');

      await fsPromises.writeFile(file1, `import { foo } from './helper';\n`);
      await fsPromises.writeFile(file2, `export function foo() {}\n`);

      const related = await analyzer.findRelatedFiles(file1);

      expect(related).toBeDefined();
      expect(Array.isArray(related)).toBe(true);
      expect(related.some((f) => f.includes('helper'))).toBe(true);
    });

    it('should handle files with no imports', async () => {
      const file = path.join(testDir, 'standalone.ts');
      await fsPromises.writeFile(file, 'const x = 1;');

      const related = await analyzer.findRelatedFiles(file);

      expect(related).toBeDefined();
      expect(Array.isArray(related)).toBe(true);
    });

    it('should handle nonexistent files gracefully', async () => {
      const nonexistent = path.join(testDir, 'nonexistent.ts');

      const related = await analyzer.findRelatedFiles(nonexistent);

      expect(related).toEqual([]);
    });
  });

  describe('buildSymbolIndex', () => {
    it('should skip when ENABLE_SYMBOL_INDEXING is false', async () => {
      const file = path.join(testDir, 'sample.ts');
      await fsPromises.writeFile(
        file,
        'export class MyClass {}\nexport function myFunc() {}',
      );

      // Since ENABLE_SYMBOL_INDEXING is false by default, this should be a no-op
      await analyzer.buildSymbolIndex([file]);
    });
  });

  describe('findRelatedSymbols', () => {
    it('should return empty array when symbol not found', async () => {
      const result = await analyzer.findRelatedSymbols(
        'NonExistentSymbol',
        testDir,
      );

      expect(result).toEqual([]);
    });

    it('should return empty array for unfound symbol in workspace', async () => {
      const result = await analyzer.findRelatedSymbols('SomeSymbol', testDir);

      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([]);
    });
  });
});

describe('getWorkspaceFiles', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'workspace-files-test-'),
    );
  });

  afterEach(async () => {
    await fsPromises.rm(testDir, { recursive: true, force: true });
  });

  it('should discover TypeScript and JavaScript files', async () => {
    await fsPromises.writeFile(path.join(testDir, 'file1.ts'), 'const x = 1;');
    await fsPromises.writeFile(path.join(testDir, 'file2.js'), 'const y = 2;');
    await fsPromises.writeFile(path.join(testDir, 'file3.py'), 'x = 3');

    const files = await getWorkspaceFiles(testDir);

    expect(files.length).toBeGreaterThan(0);
    const basenames = files.map((f) => path.basename(f));
    expect(basenames).toContain('file1.ts');
    expect(basenames).toContain('file2.js');
    expect(basenames).toContain('file3.py');
  });

  it('should ignore node_modules and dist directories', async () => {
    const nodeModulesDir = path.join(testDir, 'node_modules');
    const distDir = path.join(testDir, 'dist');

    await fsPromises.mkdir(nodeModulesDir);
    await fsPromises.mkdir(distDir);

    await fsPromises.writeFile(
      path.join(nodeModulesDir, 'lib.ts'),
      'export {};',
    );
    await fsPromises.writeFile(path.join(distDir, 'output.js'), 'var x;');
    await fsPromises.writeFile(path.join(testDir, 'src.ts'), 'const z = 1;');

    const files = await getWorkspaceFiles(testDir);

    const basenames = files.map((f) => path.basename(f));
    expect(basenames).not.toContain('lib.ts');
    expect(basenames).not.toContain('output.js');
    expect(basenames).toContain('src.ts');
  });

  it('should handle empty workspace', async () => {
    const files = await getWorkspaceFiles(testDir);

    expect(files).toEqual([]);
  });

  it('should return empty array on error', async () => {
    const nonexistentDir = path.join(testDir, 'nonexistent');

    const files = await getWorkspaceFiles(nonexistentDir);

    expect(files).toEqual([]);
  });
});
