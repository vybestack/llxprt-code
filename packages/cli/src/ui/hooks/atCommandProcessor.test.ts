/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { handleAtCommand } from './atCommandProcessor.js';
import {
  Config,
  FileDiscoveryService,
  GlobTool,
  ReadManyFilesTool,
  StandardFileSystemService,
  ToolRegistry,
  COMMON_IGNORE_PATTERNS,
  DEFAULT_FILE_EXCLUDES,
} from '@vybestack/llxprt-code-core';
import * as os from 'os';
import { ToolCallStatus } from '../types.js';
import { UseHistoryManagerReturn } from './useHistoryManager.js';
import * as fsPromises from 'fs/promises';
import * as fs from 'fs';

import * as path from 'path';

// No mocking - use the real FileDiscoveryService

describe('handleAtCommand', () => {
  let testRootDir: string;
  let mockConfig: Config;

  const mockAddItem = vi.fn() as Mock<UseHistoryManagerReturn['addItem']>;
  const mockOnDebugMessage = vi.fn() as Mock<(message: string) => void>;

  let abortController: AbortController;

  async function createTestFile(fullPath: string, fileContents: string) {
    await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
    await fsPromises.writeFile(fullPath, fileContents);
    return fs.realpathSync(fullPath);
  }

  let originalCwd: string;

  beforeEach(async () => {
    vi.resetAllMocks();

    testRootDir = await fsPromises.mkdtemp(
      path.join(os.tmpdir(), 'folder-structure-test-'),
    );
    originalCwd = process.cwd();
    process.chdir(testRootDir);

    abortController = new AbortController();

    const getToolRegistry = vi.fn();

    mockConfig = {
      getToolRegistry,
      getTargetDir: () => testRootDir,
      isSandboxed: () => false,
      getMessageBus: vi.fn(() => ({
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
        publish: vi.fn(),
        respondToConfirmation: vi.fn(),
        requestConfirmation: vi.fn().mockResolvedValue(true),
        removeAllListeners: vi.fn(),
        listenerCount: vi.fn().mockReturnValue(0),
      })),
      getFileService: () => new FileDiscoveryService(testRootDir),
      getFileFilteringRespectGitIgnore: () => true,
      getFileFilteringRespectLlxprtIgnore: () => true,
      getFileFilteringOptions: () => ({
        respectGitIgnore: true,
        respectLlxprtIgnore: true,
      }),
      getFileSystemService: () => new StandardFileSystemService(),
      getEnableRecursiveFileSearch: vi.fn(() => true),
      getWorkspaceContext: () => {
        const workspaceRoot = fs.realpathSync(testRootDir);
        return {
          isPathWithinWorkspace: (inputPath: string) => {
            const absoluteInput = path.isAbsolute(inputPath)
              ? inputPath
              : path.resolve(testRootDir, inputPath);
            let resolved: string;
            try {
              resolved = fs.realpathSync(absoluteInput);
            } catch {
              if (absoluteInput.startsWith(testRootDir)) {
                resolved = path.resolve(
                  workspaceRoot,
                  path.relative(testRootDir, absoluteInput),
                );
              } else {
                resolved = path.normalize(absoluteInput);
              }
            }
            return (
              resolved === workspaceRoot ||
              resolved.startsWith(workspaceRoot + path.sep)
            );
          },
          getDirectories: () => [workspaceRoot],
        };
      },
      getEphemeralSettings: () => ({}), // No disabled tools
      getMcpServers: () => ({}),
      getMcpServerCommand: () => undefined,
      getPromptRegistry: () => ({
        getPromptsByServer: () => [],
      }),
      getDebugMode: () => false,
      getFileExclusions: () => ({
        getCoreIgnorePatterns: () => COMMON_IGNORE_PATTERNS,
        getDefaultExcludePatterns: () => DEFAULT_FILE_EXCLUDES,
        getGlobExcludes: () => COMMON_IGNORE_PATTERNS,
        buildExcludePatterns: () => DEFAULT_FILE_EXCLUDES,
        getReadManyFilesExcludes: () => DEFAULT_FILE_EXCLUDES,
      }),
      getUsageStatisticsEnabled: () => false,
      getEnableExtensionReloading: () => false,
    } as unknown as Config;

    const registry = new ToolRegistry(mockConfig);
    registry.registerTool(new ReadManyFilesTool(mockConfig));
    registry.registerTool(new GlobTool(mockConfig));
    getToolRegistry.mockReturnValue(registry);
  });

  afterEach(async () => {
    abortController.abort();
    process.chdir(originalCwd);
    await fsPromises.rm(testRootDir, { recursive: true, force: true });
  });

  it('should pass through query if no @ command is present', async () => {
    const query = 'regular user query';

    const result = await handleAtCommand({
      query,
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 123,
      signal: abortController.signal,
    });

    expect(result).toEqual({
      processedQuery: [{ text: query }],
      shouldProceed: true,
    });
  });

  it('should pass through original query if only a lone @ symbol is present', async () => {
    const queryWithSpaces = '  @  ';

    const result = await handleAtCommand({
      query: queryWithSpaces,
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 124,
      signal: abortController.signal,
    });

    expect(result).toEqual({
      processedQuery: [{ text: queryWithSpaces }],
      shouldProceed: true,
    });
    expect(mockOnDebugMessage).toHaveBeenCalledWith(
      'Lone @ detected, will be treated as text in the modified query.',
    );
  });

  it('tool registry should be properly configured', async () => {
    const registry = mockConfig.getToolRegistry();
    expect(registry).toBeDefined();
    expect(registry.getTool('read_many_files')).toBeDefined();
    expect(registry.getTool('glob')).toBeDefined();
  });

  it('should process a valid text file path', async () => {
    const fileContent = 'This is the file content.';
    // Create file in the test directory
    const relativePath = path.join('path', 'to', 'file.txt');
    await createTestFile(path.join(testRootDir, relativePath), fileContent);
    // Use relative path in the query
    const query = `@${relativePath}`;

    const result = await handleAtCommand({
      query,
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 125,
      signal: abortController.signal,
    });

    expect(result).toEqual({
      processedQuery: [
        { text: `@${relativePath}` },
        { text: '\n--- Content from referenced files ---' },
        { text: `\nContent from @${relativePath}:\n` },
        { text: fileContent },
        { text: '\n--- End of content ---' },
      ],
      shouldProceed: true,
    });
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_group',
        agentId: 'primary',
        tools: [expect.objectContaining({ status: ToolCallStatus.Success })],
      }),
      125,
    );
  });

  it('should process a valid directory path and convert to glob', async () => {
    const fileContent = 'This is the file content.';
    const relativeDirPath = path.join('path', 'to');
    const relativeFilePath = path.join(relativeDirPath, 'file.txt');
    await createTestFile(path.join(testRootDir, relativeFilePath), fileContent);
    const query = `@${relativeDirPath}`;
    const resolvedGlob = `${relativeDirPath}${path.sep}**`;

    const result = await handleAtCommand({
      query,
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 126,
      signal: abortController.signal,
    });

    expect(result).toEqual({
      processedQuery: [
        { text: `@${resolvedGlob}` },
        { text: '\n--- Content from referenced files ---' },
        { text: `\nContent from @${relativeFilePath}:\n` },
        { text: fileContent },
        { text: '\n--- End of content ---' },
      ],
      shouldProceed: true,
    });
    expect(mockOnDebugMessage).toHaveBeenCalledWith(
      `Path ${relativeDirPath} resolved to directory, using glob: ${resolvedGlob}`,
    );
  });

  it('should handle query with text before and after @command', async () => {
    const fileContent = 'Markdown content.';
    const relativePath = 'doc.md';
    await createTestFile(path.join(testRootDir, relativePath), fileContent);
    const textBefore = 'Please read ';
    const textAfter = ' and summarize.';
    const query = `${textBefore}@${relativePath}${textAfter}`;

    const result = await handleAtCommand({
      query,
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 127,
      signal: abortController.signal,
    });

    expect(result).toEqual({
      processedQuery: [
        { text: `${textBefore}@${relativePath}${textAfter}` },
        { text: '\n--- Content from referenced files ---' },
        { text: `\nContent from @${relativePath}:\n` },
        { text: fileContent },
        { text: '\n--- End of content ---' },
      ],
      shouldProceed: true,
    });
  });

  it('should correctly unescape paths with escaped spaces', async () => {
    const fileContent = 'This is the file content.';
    const relativePath = path.join('path', 'to', 'my file.txt');
    await createTestFile(path.join(testRootDir, relativePath), fileContent);
    const escapedPath = path.join('path', 'to', 'my\\ file.txt');
    const query = `@${escapedPath}`;

    const result = await handleAtCommand({
      query,
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 125,
      signal: abortController.signal,
    });

    expect(result).toEqual({
      processedQuery: [
        { text: `@${relativePath}` },
        { text: '\n--- Content from referenced files ---' },
        { text: `\nContent from @${relativePath}:\n` },
        { text: fileContent },
        { text: '\n--- End of content ---' },
      ],
      shouldProceed: true,
    });
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_group',
        agentId: 'primary',
        tools: [expect.objectContaining({ status: ToolCallStatus.Success })],
      }),
      125,
    );
  });

  it('should handle multiple @file references', async () => {
    const content1 = 'Content file1';
    const relativePath1 = 'file1.txt';
    await createTestFile(path.join(testRootDir, relativePath1), content1);
    const content2 = 'Content file2';
    const relativePath2 = 'file2.md';
    await createTestFile(path.join(testRootDir, relativePath2), content2);
    const query = `@${relativePath1} @${relativePath2}`;

    const result = await handleAtCommand({
      query,
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 130,
      signal: abortController.signal,
    });

    expect(result).toEqual({
      processedQuery: [
        { text: query },
        { text: '\n--- Content from referenced files ---' },
        { text: `\nContent from @${relativePath1}:\n` },
        { text: content1 },
        { text: `\nContent from @${relativePath2}:\n` },
        { text: content2 },
        { text: '\n--- End of content ---' },
      ],
      shouldProceed: true,
    });
  });

  it('should handle multiple @file references with interleaved text', async () => {
    const text1 = 'Check ';
    const content1 = 'C1';
    const relativePath1 = 'f1.txt';
    await createTestFile(path.join(testRootDir, relativePath1), content1);
    const text2 = ' and ';
    const content2 = 'C2';
    const relativePath2 = 'f2.md';
    await createTestFile(path.join(testRootDir, relativePath2), content2);
    const text3 = ' please.';
    const query = `${text1}@${relativePath1}${text2}@${relativePath2}${text3}`;

    const result = await handleAtCommand({
      query,
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 131,
      signal: abortController.signal,
    });

    expect(result).toEqual({
      processedQuery: [
        { text: query },
        { text: '\n--- Content from referenced files ---' },
        { text: `\nContent from @${relativePath1}:\n` },
        { text: content1 },
        { text: `\nContent from @${relativePath2}:\n` },
        { text: content2 },
        { text: '\n--- End of content ---' },
      ],
      shouldProceed: true,
    });
  });

  it('should handle a mix of valid, invalid, and lone @ references', async () => {
    const content1 = 'Valid content 1';
    const relativePath1 = 'valid1.txt';
    await createTestFile(path.join(testRootDir, relativePath1), content1);
    const invalidFile = 'nonexistent.txt';
    const content2 = 'Globbed content';
    const relativePath2 = path.join('resolved', 'valid2.actual');
    await createTestFile(path.join(testRootDir, relativePath2), content2);
    const query = `Look at @${relativePath1} then @${invalidFile} and also just @ symbol, then @${relativePath2}`;

    const result = await handleAtCommand({
      query,
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 132,
      signal: abortController.signal,
    });

    expect(result.shouldProceed).toBe(true);
    expect(result.processedQuery).toBeDefined();
    const processedQuery = result.processedQuery!;
    expect((processedQuery as Array<{ text: string }>)[0]).toEqual({
      text: `Look at @${relativePath1} then @${invalidFile} and also just @ symbol, then @${relativePath2}`,
    });

    // Check that both files are included but don't enforce order
    const queryText = (
      Array.isArray(processedQuery) ? processedQuery : [processedQuery]
    )
      .map((p: unknown) => (p as { text: string }).text)
      .join('');
    expect(queryText).toContain('--- Content from referenced files ---');
    expect(queryText).toContain(`Content from @${relativePath1}:`);
    expect(queryText).toContain(content1);
    expect(queryText).toContain(`Content from @${relativePath2}:`);
    expect(queryText).toContain(content2);
    expect(queryText).toContain('--- End of content ---');
    expect(mockOnDebugMessage).toHaveBeenCalledWith(
      `Path ${invalidFile} not found directly, attempting glob search.`,
    );
    expect(mockOnDebugMessage).toHaveBeenCalledWith(
      `Glob search for '**/*${invalidFile}*' found no files or an error. Path ${invalidFile} will be skipped.`,
    );
    expect(mockOnDebugMessage).toHaveBeenCalledWith(
      'Lone @ detected, will be treated as text in the modified query.',
    );
  });

  it('should return original query if all @paths are invalid or lone @', async () => {
    const query = 'Check @nonexistent.txt and @ also';

    const result = await handleAtCommand({
      query,
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 133,
      signal: abortController.signal,
    });

    expect(result).toEqual({
      processedQuery: [{ text: 'Check @nonexistent.txt and @ also' }],
      shouldProceed: true,
    });
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

      expect(result).toEqual({
        processedQuery: [{ text: query }],
        shouldProceed: true,
      });
      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        'Path node_modules/package.json is git-ignored and will be skipped.',
      );
      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        'Ignored 1 files:\nGit-ignored: node_modules/package.json',
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

      expect(result).toEqual({
        processedQuery: [
          { text: `@${relativePath}` },
          { text: '\n--- Content from referenced files ---' },
          { text: `\nContent from @${relativePath}:\n` },
          { text: 'console.log("Hello world");' },
          { text: '\n--- End of content ---' },
        ],
        shouldProceed: true,
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

      expect(result).toEqual({
        processedQuery: [
          { text: `@${relativePath1} @${relativePath2}` },
          { text: '\n--- Content from referenced files ---' },
          { text: `\nContent from @${relativePath1}:\n` },
          { text: '# Project README' },
          { text: '\n--- End of content ---' },
        ],
        shouldProceed: true,
      });
      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        `Path ${relativePath2} is git-ignored and will be skipped.`,
      );
      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        `Ignored 1 files:\nGit-ignored: ${relativePath2}`,
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

      expect(result).toEqual({
        processedQuery: [{ text: query }],
        shouldProceed: true,
      });
      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        'Path .git/config is git-ignored and will be skipped.',
      );
      expect(mockOnDebugMessage).toHaveBeenCalledWith(
        'Ignored 1 files:\nGit-ignored: .git/config',
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
      expect(result.processedQuery).toEqual([{ text: query }]);
      expect(result.shouldProceed).toBe(true);
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

      expect(result).toEqual({
        processedQuery: [{ text: query }],
        shouldProceed: true,
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

    expect(result).toEqual({
      processedQuery: [
        { text: `@${relativePath}` },
        { text: '\n--- Content from referenced files ---' },
        { text: `\nContent from @${relativePath}:\n` },
        { text: 'console.log("Hello world");' },
        { text: '\n--- End of content ---' },
      ],
      shouldProceed: true,
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

    expect(result).toEqual({
      processedQuery: [
        { text: `@${relativePath1} @${relativePath2}` },
        { text: '\n--- Content from referenced files ---' },
        { text: `\nContent from @${relativePath1}:\n` },
        { text: '// Main application entry' },
        { text: '\n--- End of content ---' },
      ],
      shouldProceed: true,
    });
    expect(mockOnDebugMessage).toHaveBeenCalledWith(
      `Path ${relativePath2} is llxprt-ignored and will be skipped.`,
    );
    expect(mockOnDebugMessage).toHaveBeenCalledWith(
      `Ignored 1 files:\nLlxprt-ignored: ${relativePath2}`,
    );
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

        expect(result).toEqual({
          processedQuery: [
            { text: query },
            { text: '\n--- Content from referenced files ---' },
            { text: `\nContent from @${fileInQuery}:\n` },
            { text: fileContent },
            { text: '\n--- End of content ---' },
          ],
          shouldProceed: true,
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

      expect(result).toEqual({
        processedQuery: [
          { text: query },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @first.txt:\n' },
          { text: content1 },
          { text: '\nContent from @second.txt:\n' },
          { text: content2 },
          { text: '\n--- End of content ---' },
        ],
        shouldProceed: true,
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

      expect(result).toEqual({
        processedQuery: [
          { text: 'Check @spaced file.txt, it has spaces.' },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @spaced file.txt:\n' },
          { text: fileContent },
          { text: '\n--- End of content ---' },
        ],
        shouldProceed: true,
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

      expect(result).toEqual({
        processedQuery: [
          { text: query },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @example.d.ts:\n' },
          { text: fileContent },
          { text: '\n--- End of content ---' },
        ],
        shouldProceed: true,
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

      expect(result).toEqual({
        processedQuery: [
          { text: query },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @config.json:\n' },
          { text: fileContent },
          { text: '\n--- End of content ---' },
        ],
        shouldProceed: true,
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

      expect(result).toEqual({
        processedQuery: [
          { text: query },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @package.json:\n' },
          { text: fileContent },
          { text: '\n--- End of content ---' },
        ],
        shouldProceed: true,
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

      expect(result).toEqual({
        processedQuery: [
          { text: query },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @version.1.2.3.txt:\n' },
          { text: fileContent },
          { text: '\n--- End of content ---' },
        ],
        shouldProceed: true,
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

      expect(result).toEqual({
        processedQuery: [
          { text: query },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @end.txt:\n' },
          { text: fileContent },
          { text: '\n--- End of content ---' },
        ],
        shouldProceed: true,
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

      expect(result).toEqual({
        processedQuery: [
          { text: 'Check @file$with&special#chars.txt for content.' },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @file$with&special#chars.txt:\n' },
          { text: fileContent },
          { text: '\n--- End of content ---' },
        ],
        shouldProceed: true,
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

      expect(result).toEqual({
        processedQuery: [
          { text: query },
          { text: '\n--- Content from referenced files ---' },
          { text: '\nContent from @basicfile.txt:\n' },
          { text: fileContent },
          { text: '\n--- End of content ---' },
        ],
        shouldProceed: true,
      });
    });
  });

  it("should not add the user's turn to history, as that is the caller's responsibility", async () => {
    // Arrange
    const fileContent = 'This is the file content.';
    await createTestFile(
      path.join(testRootDir, 'path', 'to', 'another-file.txt'),
      fileContent,
    );
    const query = 'A query with @path/to/another-file.txt';

    // Act
    await handleAtCommand({
      query,
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 999,
      signal: abortController.signal,
    });

    // Assert
    // It SHOULD be called for the tool_group
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool_group', agentId: 'primary' }),
      999,
    );

    // It should NOT have been called for the user turn
    const userTurnCalls = mockAddItem.mock.calls.filter(
      (call) => call[0].type === 'user',
    );
    expect(userTurnCalls).toHaveLength(0);
  });
});
