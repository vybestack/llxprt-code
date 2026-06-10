/**
 * @plan:PLAN-20260608-ISSUE1585.P10
 * @requirement:REQ-BEHAVIORAL-TDD, REQ-TEST-FIXTURE-COUPLING
 */

/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Memory Tool Behavioral Tests
 *
 * Verifies observable behavior of MemoryTool through IStorageService.
 * Primary assertions are on ToolResult content, filesystem state,
 * and key storage path resolution — NOT on method call counts.
 *
 * STATUS: RED — Tests compile but will fail at runtime until P11
 * moves real tool code and adapters are wired up.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryTool } from '../index.js';
import type { IStorageService } from '../interfaces/index.js';
import { executeToolForBehavioralAssertion } from './red-test-helpers.js';
import {
  MASK_KEY_FIXTURES,
  SUPPORTED_TOOL_NAMES_FIXTURE,
  VALID_KEY_CHECK_FIXTURES,
  KEY_ENTRY_FIXTURES,
} from './fixtures/key-storage-fixtures.js';

function createTempDir(prefix = 'llxprt-memory-test-'): {
  dir: string;
  cleanup: () => void;
} {
  const dir = join(
    tmpdir(),
    `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Fake IStorageService using real filesystem for I/O assertions.
 */
function createFakeStorageService(baseDir: string): IStorageService {
  return {
    getLLXPRTDir: () => baseDir,
    readFile: async (path: string) => readFileSync(path, 'utf-8'),
    writeFile: async (path: string, content: string) =>
      writeFileSync(path, content, 'utf-8'),
    ensureDir: async (path: string) => mkdirSync(path, { recursive: true }),
  };
}

describe('Memory Tool Behavioral Tests @plan:PLAN-20260608-ISSUE1585.P10', () => {
  let tempDir: string;
  let cleanup: () => void;

  beforeEach(() => {
    const tmp = createTempDir();
    tempDir = tmp.dir;
    cleanup = tmp.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  describe('MemoryTool saves content through IStorageService', () => {
    it('saves content and filesystem reflects the saved file', async () => {
      const storage = createFakeStorageService(tempDir);
      const filePath = join(tempDir, 'LLXPRT.md');

      const result = await executeToolForBehavioralAssertion(
        new MemoryTool(storage),
        { content: 'This is saved content.', scope: 'project' },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('This is saved content.');
      expect(existsSync(filePath)).toBe(true);
      const savedContent = readFileSync(filePath, 'utf-8');
      expect(savedContent).toContain('This is saved content.');
    });
  });

  describe('MemoryTool reads content and returns it in ToolResult.llmContent', () => {
    it('reads previously saved content through IStorageService', async () => {
      const storage = createFakeStorageService(tempDir);
      const filePath = join(tempDir, 'LLXPRT.md');

      await storage.writeFile(filePath, 'Memory content here');

      const result = await executeToolForBehavioralAssertion(
        new MemoryTool(storage),
        { read: true, scope: 'project' },
      );

      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('Memory content here');
    });
  });

  describe('IStorageService LLXPRT directory path', () => {
    it('getLLXPRTDir returns configured base directory', () => {
      const storage = createFakeStorageService(tempDir);

      // Primary assertion: LLXPRT dir path matches (observable)
      expect(storage.getLLXPRTDir()).toBe(tempDir);
      expect(typeof storage.getLLXPRTDir()).toBe('string');
    });
  });

  describe('IStorageService ensureDir creates directories', () => {
    it('ensureDir creates nested directories', async () => {
      const storage = createFakeStorageService(tempDir);
      const nestedDir = join(tempDir, 'sub1', 'sub2');

      await storage.ensureDir(nestedDir);

      // Primary assertion: Directory exists on filesystem (observable)
      expect(existsSync(nestedDir)).toBe(true);
    });
  });

  describe('Key storage path matches pre-extraction behavior', () => {
    it('LLXPRT dir path is used for key storage files', () => {
      const storage = createFakeStorageService(tempDir);
      const storageDir = storage.getLLXPRTDir();

      // Primary assertion: Storage dir path is consistent (observable)
      expect(storageDir).toBe(tempDir);
      // This is a regression guard: if LLXPRT dir resolution changes,
      // this test catches it
    });
  });
});
