/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleAtCommand } from './atCommandProcessor.js';
import type { Config } from '@vybestack/llxprt-code-core';
import * as path from 'path';
import * as fsPromises from 'fs/promises';
import {
  createTestFile,
  setupAtCommandTest,
  teardownAtCommandTest,
  type AtCommandTestSetup,
} from './atCommandProcessor-test-helpers.js';

describe('handleAtCommand (filtering)', () => {
  let setup: AtCommandTestSetup;
  let testRootDir: string;
  let mockConfig: Config;
  let mockAddItem: ReturnType<typeof vi.fn>;
  let mockOnDebugMessage: ReturnType<typeof vi.fn>;
  let abortController: AbortController;

  beforeEach(async () => {
    setup = await setupAtCommandTest();
    testRootDir = setup.testRootDir;
    mockConfig = setup.mockConfig;
    mockAddItem = setup.mockAddItem;
    mockOnDebugMessage = setup.mockOnDebugMessage;
    abortController = setup.abortController;
  });

  afterEach(async () => {
    await teardownAtCommandTest(setup);
  });

  describe('git-aware filtering', () => {
    beforeEach(async () => {
      await fsPromises.mkdir(path.join(testRootDir, '.git'), {
        recursive: true,
      });
    });

    it('should skip git-ignored files in @ commands', async () => {
      await createTestFile(
        path.join(testRootDir, '.gitignore'),
        'node_modules/package.json',
      );
      await createTestFile(
        path.join(testRootDir, 'node_modules', 'package.json'),
        'the file contents',
      );

      const query = '@node_modules/package.json';

      const result = await handleAtCommand({
        query,
        config: mockConfig,
        addItem: mockAddItem,
        onDebugMessage: mockOnDebugMessage,
        messageId: 200,
        signal: abortController.signal,
      });

      expect(result).toStrictEqual({
        processedQuery: [{ text: query }],
      });
      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        'Path node_modules/package.json is ignored by both git and llxprt and will be skipped.',
      );
      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        'Ignored 1 files:\nIgnored by both: node_modules/package.json',
      );
    });

    it('should process non-git-ignored files normally', async () => {
      await createTestFile(
        path.join(testRootDir, '.gitignore'),
        'node_modules/package.json',
      );

      const relativePath = path.join('src', 'index.ts');
      await createTestFile(
        path.join(testRootDir, relativePath),
        'console.log("Hello world");',
      );
      const query = `@${relativePath}`;

      const result = await handleAtCommand({
        query,
        config: mockConfig,
        addItem: mockAddItem,
        onDebugMessage: mockOnDebugMessage,
        messageId: 201,
        signal: abortController.signal,
      });

      expect(result).toStrictEqual({
        processedQuery: [
          { text: `@${relativePath}` },
          { text: '\n--- Content from referenced files ---' },
          { text: `\nContent from @${relativePath}:\n` },
          { text: 'console.log("Hello world");' },
          { text: '\n--- End of content ---' },
        ],
      });
    });

    it('should handle mixed git-ignored and valid files', async () => {
      await createTestFile(path.join(testRootDir, '.gitignore'), '.env');
      const relativePath1 = 'README.md';
      await createTestFile(
        path.join(testRootDir, relativePath1),
        '# Project README',
      );
      const relativePath2 = '.env';
      await createTestFile(path.join(testRootDir, relativePath2), 'SECRET=123');
      const query = `@${relativePath1} @${relativePath2}`;

      const result = await handleAtCommand({
        query,
        config: mockConfig,
        addItem: mockAddItem,
        onDebugMessage: mockOnDebugMessage,
        messageId: 202,
        signal: abortController.signal,
      });

      expect(result).toStrictEqual({
        processedQuery: [
          { text: `@${relativePath1} @${relativePath2}` },
          { text: '\n--- Content from referenced files ---' },
          { text: `\nContent from @${relativePath1}:\n` },
          { text: '# Project README' },
          { text: '\n--- End of content ---' },
        ],
      });
      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        `Path ${relativePath2} is ignored by both git and llxprt and will be skipped.`,
      );
      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        `Ignored 1 files:\nIgnored by both: ${relativePath2}`,
      );
    });

    it('should always ignore .git directory files', async () => {
      await createTestFile(
        path.join(testRootDir, '.git', 'config'),
        '[core]\n\trepositoryformatversion = 0\n',
      );
      const query = '@.git/config';

      const result = await handleAtCommand({
        query,
        config: mockConfig,
        addItem: mockAddItem,
        onDebugMessage: mockOnDebugMessage,
        messageId: 203,
        signal: abortController.signal,
      });

      expect(result).toStrictEqual({
        processedQuery: [{ text: query }],
      });
      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        'Path .git/config is ignored by both git and llxprt and will be skipped.',
      );
      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        'Ignored 1 files:\nIgnored by both: .git/config',
      );
    });
  });

  describe('when recursive file search is disabled', () => {
    beforeEach(() => {
      vi.mocked(mockConfig.getEnableRecursiveFileSearch).mockReturnValue(false);
    });

    it('should not use glob search for a nonexistent file', async () => {
      const invalidFile = 'nonexistent.txt';
      const query = `@${invalidFile}`;

      const result = await handleAtCommand({
        query,
        config: mockConfig,
        addItem: mockAddItem,
        onDebugMessage: mockOnDebugMessage,
        messageId: 300,
        signal: abortController.signal,
      });

      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        `Glob tool not found. Path ${invalidFile} will be skipped.`,
      );
      expect(result.processedQuery).toStrictEqual([{ text: query }]);
      expect(result.processedQuery).not.toBeNull();
      expect(result.error).toBeUndefined();
    });
  });

  describe('llxprt-ignore filtering', () => {
    it('should skip llxprt-ignored files in @ commands', async () => {
      await createTestFile(
        path.join(testRootDir, '.llxprtignore'),
        'build/output.js',
      );
      await createTestFile(
        path.join(testRootDir, 'build', 'output.js'),
        'console.log("Hello");',
      );
      const query = '@build/output.js';

      const result = await handleAtCommand({
        query,
        config: mockConfig,
        addItem: mockAddItem,
        onDebugMessage: mockOnDebugMessage,
        messageId: 204,
        signal: abortController.signal,
      });

      expect(result).toStrictEqual({
        processedQuery: [{ text: query }],
      });
      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        'Path build/output.js is llxprt-ignored and will be skipped.',
      );
      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        'Ignored 1 files:\nLlxprt-ignored: build/output.js',
      );
    });
  });

  it('should process non-ignored files when .geminiignore is present', async () => {
    await createTestFile(
      path.join(testRootDir, '.llxprtignore'),
      'build/output.js',
    );
    const relativePath = path.join('src', 'index.ts');
    await createTestFile(
      path.join(testRootDir, relativePath),
      'console.log("Hello world");',
    );
    const query = `@${relativePath}`;

    const result = await handleAtCommand({
      query,
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 205,
      signal: abortController.signal,
    });

    expect(result).toStrictEqual({
      processedQuery: [
        { text: `@${relativePath}` },
        { text: '\n--- Content from referenced files ---' },
        { text: `\nContent from @${relativePath}:\n` },
        { text: 'console.log("Hello world");' },
        { text: '\n--- End of content ---' },
      ],
    });
  });

  it('should handle mixed llxprt-ignored and valid files', async () => {
    await createTestFile(
      path.join(testRootDir, '.llxprtignore'),
      'dist/bundle.js',
    );
    const relativePath1 = path.join('src', 'main.ts');
    await createTestFile(
      path.join(testRootDir, relativePath1),
      '// Main application entry',
    );
    const relativePath2 = path.join('dist', 'bundle.js');
    await createTestFile(
      path.join(testRootDir, relativePath2),
      'console.log("bundle");',
    );
    const query = `@${relativePath1} @${relativePath2}`;

    const result = await handleAtCommand({
      query,
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 206,
      signal: abortController.signal,
    });

    expect(result).toStrictEqual({
      processedQuery: [
        { text: `@${relativePath1} @${relativePath2}` },
        { text: '\n--- Content from referenced files ---' },
        { text: `\nContent from @${relativePath1}:\n` },
        { text: '// Main application entry' },
        { text: '\n--- End of content ---' },
      ],
    });
    expect(mockOnDebugMessage).toHaveBeenCalledWith(
      `Path ${relativePath2} is llxprt-ignored and will be skipped.`,
    );
    expect(mockOnDebugMessage).toHaveBeenCalledWith(
      `Ignored 1 files:\nLlxprt-ignored: ${relativePath2}`,
    );
  });
});
