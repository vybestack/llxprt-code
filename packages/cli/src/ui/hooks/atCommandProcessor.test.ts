/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleAtCommand } from './atCommandProcessor.js';
import {
  type Config,
  type DiscoveredMCPResource,
} from '@vybestack/llxprt-code-core';
import { ToolCallStatus } from '../types.js';
import * as path from 'path';
import {
  createTestFile,
  setupAtCommandTest,
  teardownAtCommandTest,
  type AtCommandTestSetup,
} from './atCommandProcessor-test-helpers.js';

describe('handleAtCommand', () => {
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

  it('should include MCP resource content for @server:uri references', async () => {
    const serverName = 'docs';
    const resourceUri = 'file:///docs/readme.md';
    const query = `Summarize @${serverName}:${resourceUri}`;

    const findResourceByUri = vi
      .fn()
      .mockImplementation((identifier: string) => {
        if (identifier === `${serverName}:${resourceUri}`) {
          return {
            serverName,
            uri: resourceUri,
            discoveredAt: Date.now(),
          } as DiscoveredMCPResource;
        }
        return undefined;
      });

    const readResource = vi.fn().mockResolvedValue({
      contents: [
        {
          uri: resourceUri,
          mimeType: 'text/plain',
          text: 'resource content from mcp',
        },
      ],
    });

    const getClient = vi.fn().mockImplementation((name: string) => {
      if (name === serverName) {
        return { readResource };
      }
      return undefined;
    });

    mockConfig = {
      ...mockConfig,
      getResourceRegistry: () => ({ findResourceByUri }),
      getMcpClientManager: () => ({ getClient }),
    } as unknown as Config;

    const result = await handleAtCommand({
      query,
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 1001,
      signal: abortController.signal,
    });

    expect(findResourceByUri).toHaveBeenCalledWith(
      `${serverName}:${resourceUri}`,
    );
    expect(readResource).toHaveBeenCalledWith(resourceUri);
    expect(result).toStrictEqual({
      processedQuery: [
        { text: query },
        { text: `\nContent from @${serverName}:${resourceUri}:\n` },
        { text: 'resource content from mcp' },
      ],
    });
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_group',
        agentId: 'primary',
        tools: [expect.objectContaining({ status: ToolCallStatus.Success })],
      }),
      1001,
    );
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

    expect(result).toStrictEqual({
      processedQuery: [{ text: query }],
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

    expect(result).toStrictEqual({
      processedQuery: [{ text: queryWithSpaces }],
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

    expect(result).toStrictEqual({
      processedQuery: [
        { text: `@${relativePath}` },
        { text: '\n--- Content from referenced files ---' },
        { text: `\nContent from @${relativePath}:\n` },
        { text: fileContent },
        { text: '\n--- End of content ---' },
      ],
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

    expect(result).toStrictEqual({
      processedQuery: [
        { text: `@${resolvedGlob}` },
        { text: '\n--- Content from referenced files ---' },
        { text: `\nContent from @${relativeFilePath}:\n` },
        { text: fileContent },
        { text: '\n--- End of content ---' },
      ],
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

    expect(result).toStrictEqual({
      processedQuery: [
        { text: `${textBefore}@${relativePath}${textAfter}` },
        { text: '\n--- Content from referenced files ---' },
        { text: `\nContent from @${relativePath}:\n` },
        { text: fileContent },
        { text: '\n--- End of content ---' },
      ],
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

    expect(result).toStrictEqual({
      processedQuery: [
        { text: `@${relativePath}` },
        { text: '\n--- Content from referenced files ---' },
        { text: `\nContent from @${relativePath}:\n` },
        { text: fileContent },
        { text: '\n--- End of content ---' },
      ],
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

    expect(result).toStrictEqual({
      processedQuery: [
        { text: query },
        { text: '\n--- Content from referenced files ---' },
        { text: `\nContent from @${relativePath1}:\n` },
        { text: content1 },
        { text: `\nContent from @${relativePath2}:\n` },
        { text: content2 },
        { text: '\n--- End of content ---' },
      ],
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

    expect(result).toStrictEqual({
      processedQuery: [
        { text: query },
        { text: '\n--- Content from referenced files ---' },
        { text: `\nContent from @${relativePath1}:\n` },
        { text: content1 },
        { text: `\nContent from @${relativePath2}:\n` },
        { text: content2 },
        { text: '\n--- End of content ---' },
      ],
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

    expect(result.processedQuery).not.toBeNull();
    expect(result.error).toBeUndefined();
    expect(result.processedQuery).toBeDefined();
    const processedQuery = result.processedQuery!;
    expect((processedQuery as Array<{ text: string }>)[0]).toStrictEqual({
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

    expect(result).toStrictEqual({
      processedQuery: [{ text: 'Check @nonexistent.txt and @ also' }],
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
