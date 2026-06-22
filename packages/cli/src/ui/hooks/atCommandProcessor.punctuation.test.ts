/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleAtCommand } from './atCommandProcessor.js';
import type { Config } from '@vybestack/llxprt-code-core';
import * as path from 'path';
import {
  createTestFile,
  setupAtCommandTest,
  teardownAtCommandTest,
  type AtCommandTestSetup,
} from './atCommandProcessor-test-helpers.js';

describe('handleAtCommand (punctuation)', () => {
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

  describe('punctuation termination in @ commands', () => {
    const punctuationTestCases = [
      {
        name: 'comma',
        fileName: 'test.txt',
        fileContent: 'File content here',
        queryTemplate: (filePath: string) =>
          `Look at @${filePath}, then explain it.`,
        messageId: 400,
      },
      {
        name: 'period',
        fileName: 'readme.md',
        fileContent: 'File content here',
        queryTemplate: (filePath: string) =>
          `Check @${filePath}. What does it say?`,
        messageId: 401,
      },
      {
        name: 'semicolon',
        fileName: 'example.js',
        fileContent: 'Code example',
        queryTemplate: (filePath: string) =>
          `Review @${filePath}; check for bugs.`,
        messageId: 402,
      },
      {
        name: 'exclamation mark',
        fileName: 'important.txt',
        fileContent: 'Important content',
        queryTemplate: (filePath: string) =>
          `Look at @${filePath}! This is critical.`,
        messageId: 403,
      },
      {
        name: 'question mark',
        fileName: 'config.json',
        fileContent: 'Config settings',
        queryTemplate: (filePath: string) =>
          `What is in @${filePath}? Please explain.`,
        messageId: 404,
      },
      {
        name: 'opening parenthesis',
        fileName: 'func.ts',
        fileContent: 'Function definition',
        queryTemplate: (filePath: string) =>
          `Analyze @${filePath}(the main function).`,
        messageId: 405,
      },
      {
        name: 'closing parenthesis',
        fileName: 'data.json',
        fileContent: 'Test data',
        queryTemplate: (filePath: string) =>
          `Use data from @${filePath}) for testing.`,
        messageId: 406,
      },
      {
        name: 'opening square bracket',
        fileName: 'array.js',
        fileContent: 'Array data',
        queryTemplate: (filePath: string) =>
          `Check @${filePath}[0] for the first element.`,
        messageId: 407,
      },
      {
        name: 'closing square bracket',
        fileName: 'list.md',
        fileContent: 'List content',
        queryTemplate: (filePath: string) =>
          `Review item @${filePath}] from the list.`,
        messageId: 408,
      },
      {
        name: 'opening curly brace',
        fileName: 'object.ts',
        fileContent: 'Object definition',
        queryTemplate: (filePath: string) =>
          `Parse @${filePath}{prop1: value1}.`,
        messageId: 409,
      },
      {
        name: 'closing curly brace',
        fileName: 'config.yaml',
        fileContent: 'Configuration',
        queryTemplate: (filePath: string) =>
          `Use settings from @${filePath}} for deployment.`,
        messageId: 410,
      },
    ];

    it.each(punctuationTestCases)(
      'should terminate @path at $name',
      async ({ fileName, fileContent, queryTemplate, messageId }) => {
        await createTestFile(path.join(testRootDir, fileName), fileContent);
        const query = queryTemplate(fileName);

        const result = await handleAtCommand({
          query,
          config: mockConfig,
          addItem: mockAddItem,
          onDebugMessage: mockOnDebugMessage,
          messageId,
          signal: abortController.signal,
        });

        const fileInQuery = fileName;

        expect(result).toStrictEqual({
          processedQuery: [
            { text: query },
            { text: '\n--- Content from referenced files ---' },
            { text: `\nContent from @${fileInQuery}:\n` },
            { text: fileContent },
            { text: '\n--- End of content ---' },
          ],
        });
      },
    );

    it('should handle multiple @paths terminated by different punctuation', async () => {
      const content1 = 'First file';
      await createTestFile(path.join(testRootDir, 'first.txt'), content1);
      const content2 = 'Second file';
      await createTestFile(path.join(testRootDir, 'second.txt'), content2);
      const query = "Compare @first.txt, @second.txt; what's different?";

      const result = await handleAtCommand({
        query,
        config: mockConfig,
        addItem: mockAddItem,
        onDebugMessage: mockOnDebugMessage,
        messageId: 411,
        signal: abortController.signal,
      });

      expect(result).toStrictEqual({
        processedQuery: [
          { text: query },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @first.txt:\n' },
          { text: content1 },
          { text: '\nContent from @second.txt:\n' },
          { text: content2 },
          { text: '\n--- End of content ---' },
        ],
      });
    });

    it('should still handle escaped spaces in paths before punctuation', async () => {
      const fileContent = 'Spaced file content';
      await createTestFile(
        path.join(testRootDir, 'spaced file.txt'),
        fileContent,
      );
      const escapedPath = path.join('spaced\\ file.txt');
      const query = `Check @${escapedPath}, it has spaces.`;

      const result = await handleAtCommand({
        query,
        config: mockConfig,
        addItem: mockAddItem,
        onDebugMessage: mockOnDebugMessage,
        messageId: 412,
        signal: abortController.signal,
      });

      expect(result).toStrictEqual({
        processedQuery: [
          { text: 'Check @spaced file.txt, it has spaces.' },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @spaced file.txt:\n' },
          { text: fileContent },
          { text: '\n--- End of content ---' },
        ],
      });
    });

    it('should not break file paths with periods in extensions', async () => {
      const fileContent = 'TypeScript content';
      await createTestFile(path.join(testRootDir, 'example.d.ts'), fileContent);
      const query = 'Analyze @example.d.ts for type definitions.';

      const result = await handleAtCommand({
        query,
        config: mockConfig,
        addItem: mockAddItem,
        onDebugMessage: mockOnDebugMessage,
        messageId: 413,
        signal: abortController.signal,
      });

      expect(result).toStrictEqual({
        processedQuery: [
          { text: query },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @example.d.ts:\n' },
          { text: fileContent },
          { text: '\n--- End of content ---' },
        ],
      });
    });

    it('should handle file paths ending with period followed by space', async () => {
      const fileContent = 'Config content';
      await createTestFile(path.join(testRootDir, 'config.json'), fileContent);
      const query = 'Check @config.json. This file contains settings.';

      const result = await handleAtCommand({
        query,
        config: mockConfig,
        addItem: mockAddItem,
        onDebugMessage: mockOnDebugMessage,
        messageId: 414,
        signal: abortController.signal,
      });

      expect(result).toStrictEqual({
        processedQuery: [
          { text: query },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @config.json:\n' },
          { text: fileContent },
          { text: '\n--- End of content ---' },
        ],
      });
    });

    it('should handle comma termination with complex file paths', async () => {
      const fileContent = 'Package info';
      await createTestFile(path.join(testRootDir, 'package.json'), fileContent);
      const query = 'Review @package.json, then check dependencies.';

      const result = await handleAtCommand({
        query,
        config: mockConfig,
        addItem: mockAddItem,
        onDebugMessage: mockOnDebugMessage,
        messageId: 415,
        signal: abortController.signal,
      });

      expect(result).toStrictEqual({
        processedQuery: [
          { text: query },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @package.json:\n' },
          { text: fileContent },
          { text: '\n--- End of content ---' },
        ],
      });
    });

    it('should not terminate at period within file name', async () => {
      const fileContent = 'Version info';
      await createTestFile(
        path.join(testRootDir, 'version.1.2.3.txt'),
        fileContent,
      );
      const query = 'Check @version.1.2.3.txt contains version information.';

      const result = await handleAtCommand({
        query,
        config: mockConfig,
        addItem: mockAddItem,
        onDebugMessage: mockOnDebugMessage,
        messageId: 416,
        signal: abortController.signal,
      });

      expect(result).toStrictEqual({
        processedQuery: [
          { text: query },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @version.1.2.3.txt:\n' },
          { text: fileContent },
          { text: '\n--- End of content ---' },
        ],
      });
    });

    it('should handle end of string termination for period and comma', async () => {
      const fileContent = 'End file content';
      await createTestFile(path.join(testRootDir, 'end.txt'), fileContent);
      const query = 'Show me @end.txt.';

      const result = await handleAtCommand({
        query,
        config: mockConfig,
        addItem: mockAddItem,
        onDebugMessage: mockOnDebugMessage,
        messageId: 417,
        signal: abortController.signal,
      });

      expect(result).toStrictEqual({
        processedQuery: [
          { text: query },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @end.txt:\n' },
          { text: fileContent },
          { text: '\n--- End of content ---' },
        ],
      });
    });

    it('should handle files with special characters in names', async () => {
      const fileContent = 'File with special chars content';
      await createTestFile(
        path.join(testRootDir, 'file$with&special#chars.txt'),
        fileContent,
      );
      const query = 'Check @file$with&special#chars.txt for content.';

      const result = await handleAtCommand({
        query,
        config: mockConfig,
        addItem: mockAddItem,
        onDebugMessage: mockOnDebugMessage,
        messageId: 418,
        signal: abortController.signal,
      });

      expect(result).toStrictEqual({
        processedQuery: [
          { text: 'Check @file$with&special#chars.txt for content.' },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @file$with&special#chars.txt:\n' },
          { text: fileContent },
          { text: '\n--- End of content ---' },
        ],
      });
    });

    it('should handle basic file names without special characters', async () => {
      const fileContent = 'Basic file content';
      await createTestFile(
        path.join(testRootDir, 'basicfile.txt'),
        fileContent,
      );
      const query = 'Check @basicfile.txt please.';

      const result = await handleAtCommand({
        query,
        config: mockConfig,
        addItem: mockAddItem,
        onDebugMessage: mockOnDebugMessage,
        messageId: 421,
        signal: abortController.signal,
      });

      expect(result).toStrictEqual({
        processedQuery: [
          { text: query },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @basicfile.txt:\n' },
          { text: fileContent },
          { text: '\n--- End of content ---' },
        ],
      });
    });
  });
});
