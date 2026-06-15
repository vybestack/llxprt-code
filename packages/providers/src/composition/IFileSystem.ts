/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { existsSync as fsExistsSync, readFileSync as fsReadFileSync } from 'fs';

/**
 * Interface for file system operations to enable dependency injection
 * and eliminate NODE_ENV checks in production code.
 */
export interface IFileSystem {
  /**
   * Check if a file exists at the given path.
   */
  existsSync(path: string): boolean;

  /**
   * Read a file synchronously and return its contents as a string.
   */
  readFileSync(path: string, encoding: BufferEncoding): string;
}

/**
 * Real file system implementation using Node.js fs module.
 */
export class NodeFileSystem implements IFileSystem {
  existsSync(path: string): boolean {
    return fsExistsSync(path);
  }

  readFileSync(path: string, encoding: BufferEncoding): string {
    return fsReadFileSync(path, encoding);
  }
}

/**
 * Mock file system implementation for testing that doesn't read real files.
 */
export class MockFileSystem implements IFileSystem {
  private mockFiles: Map<string, string> = new Map();

  existsSync(path: string): boolean {
    return this.mockFiles.has(path);
  }

  readFileSync(path: string, _encoding: BufferEncoding): string {
    const content = this.mockFiles.get(path);
    if (!content) {
      throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    }
    return content;
  }

  /**
   * Set mock file content for testing.
   */
  setMockFile(path: string, content: string): void {
    this.mockFiles.set(path, content);
  }

  /**
   * Clear all mock files.
   */
  clearMocks(): void {
    this.mockFiles.clear();
  }
}
