/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { handleAtCommand } from './atCommandProcessor.js';
import { type DiscoveredMCPResource } from '@vybestack/llxprt-code-core';
import type { AgentToolHandle } from '@vybestack/llxprt-code-agents';
import { MCPDiscoveryState } from '@vybestack/llxprt-code-mcp';
import type { CliUiRuntime } from '../cliUiRuntime.js';
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
  let mockConfig: CliUiRuntime;
  let mockAddItem: ReturnType<typeof vi.fn>;
  let mockOnDebugMessage: ReturnType<typeof vi.fn>;
  let abortController: AbortController;
  let getToolHandle: (name: string) => AgentToolHandle | undefined;

  beforeEach(async () => {
    setup = await setupAtCommandTest();
    testRootDir = setup.testRootDir;
    mockConfig = setup.mockConfig;
    mockAddItem = setup.mockAddItem;
    mockOnDebugMessage = setup.mockOnDebugMessage;
    abortController = setup.abortController;
    getToolHandle = setup.getToolHandle;
  });

  afterEach(async () => {
    await teardownAtCommandTest(setup);
  });

  const observeMcpResourceReference = async (): Promise<{
    readonly result: Awaited<ReturnType<typeof handleAtCommand>>;
    readonly findResourceByUri: ReturnType<typeof vi.fn>;
    readonly readResource: ReturnType<typeof vi.fn>;
    readonly addItem: ReturnType<typeof vi.fn>;
  }> => {
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
      getResourceRegistry: () => ({
        getAllResources: () => [],
        findResourceByUri,
      }),
      getMcpClientManager: () =>
        ({
          getClient,
          getDiscoveryState: () => MCPDiscoveryState.COMPLETED,
          getMcpServerCount: () => 0,
          restartServer: async () => {},
        }) as ReturnType<CliUiRuntime['getMcpClientManager']>,
    };

    const result = await handleAtCommand({
      query,
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 1001,
      signal: abortController.signal,
      getToolHandle,
    });

    return {
      result,
      findResourceByUri,
      readResource,
      addItem: mockAddItem,
    };
  };

  it('should include MCP resource content for @server:uri references', async () => {
    const resource = await observeMcpResourceReference();
    expect(resource.findResourceByUri).toHaveBeenCalledWith(
      'docs:file:///docs/readme.md',
    );
    expect(resource.readResource).toHaveBeenCalledWith(
      'file:///docs/readme.md',
    );
    expect(resource.addItem).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tool_group',
        agentId: 'primary',
        tools: [expect.objectContaining({ status: ToolCallStatus.Success })],
      }),
      1001,
    );
    expect(resource.result).toStrictEqual({
      processedQuery: [
        {
          type: 'text',
          text: 'Summarize @docs:file:///docs/readme.md',
        },
        {
          type: 'text',
          text: '\nContent from @docs:file:///docs/readme.md:\n',
        },
        { type: 'text', text: 'resource content from mcp' },
      ],
    });
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
      getToolHandle,
    });

    expect(result).toStrictEqual({
      processedQuery: [{ type: 'text', text: query }],
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
      getToolHandle,
    });

    expect(result).toStrictEqual({
      processedQuery: [{ type: 'text', text: queryWithSpaces }],
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
      getToolHandle,
    });

    expect(result).toStrictEqual({
      processedQuery: [
        { type: 'text', text: `@${relativePath}` },
        { type: 'text', text: '\n--- Content from referenced files ---' },
        { type: 'text', text: `\nContent from @${relativePath}:\n` },
        { type: 'text', text: fileContent },
        { type: 'text', text: '\n--- End of content ---' },
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
      getToolHandle,
    });

    expect(result).toStrictEqual({
      processedQuery: [
        { type: 'text', text: `@${resolvedGlob}` },
        { type: 'text', text: '\n--- Content from referenced files ---' },
        { type: 'text', text: `\nContent from @${relativeFilePath}:\n` },
        { type: 'text', text: fileContent },
        { type: 'text', text: '\n--- End of content ---' },
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
      getToolHandle,
    });

    expect(result).toStrictEqual({
      processedQuery: [
        { type: 'text', text: `${textBefore}@${relativePath}${textAfter}` },
        { type: 'text', text: '\n--- Content from referenced files ---' },
        { type: 'text', text: `\nContent from @${relativePath}:\n` },
        { type: 'text', text: fileContent },
        { type: 'text', text: '\n--- End of content ---' },
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
      getToolHandle,
    });

    expect(result).toStrictEqual({
      processedQuery: [
        { type: 'text', text: `@${relativePath}` },
        { type: 'text', text: '\n--- Content from referenced files ---' },
        { type: 'text', text: `\nContent from @${relativePath}:\n` },
        { type: 'text', text: fileContent },
        { type: 'text', text: '\n--- End of content ---' },
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
      getToolHandle,
    });

    expect(result).toStrictEqual({
      processedQuery: [
        { type: 'text', text: query },
        { type: 'text', text: '\n--- Content from referenced files ---' },
        { type: 'text', text: `\nContent from @${relativePath1}:\n` },
        { type: 'text', text: content1 },
        { type: 'text', text: `\nContent from @${relativePath2}:\n` },
        { type: 'text', text: content2 },
        { type: 'text', text: '\n--- End of content ---' },
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
      getToolHandle,
    });

    expect(result).toStrictEqual({
      processedQuery: [
        { type: 'text', text: query },
        { type: 'text', text: '\n--- Content from referenced files ---' },
        { type: 'text', text: `\nContent from @${relativePath1}:\n` },
        { type: 'text', text: content1 },
        { type: 'text', text: `\nContent from @${relativePath2}:\n` },
        { type: 'text', text: content2 },
        { type: 'text', text: '\n--- End of content ---' },
      ],
    });
  });

  const observeMixedAtReferences = async (): Promise<{
    readonly processedQuery: unknown;
    readonly error: string | undefined;
    readonly firstPart: unknown;
    readonly queryText: string;
    readonly debugMessages: ReturnType<typeof vi.fn>;
    readonly relativePath1: string;
    readonly relativePath2: string;
    readonly content1: string;
    readonly content2: string;
    readonly invalidFile: string;
  }> => {
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
      getToolHandle,
    });

    const processedParts = Array.isArray(result.processedQuery)
      ? result.processedQuery
      : [result.processedQuery];
    const queryText = processedParts
      .map((part: unknown) => {
        if (
          typeof part === 'object' &&
          part !== null &&
          'text' in part &&
          typeof part.text === 'string'
        ) {
          return part.text;
        }
        return '';
      })
      .join('');
    return {
      processedQuery: result.processedQuery,
      error: result.error,
      firstPart: processedParts[0],
      queryText,
      debugMessages: mockOnDebugMessage,
      relativePath1,
      relativePath2,
      content1,
      content2,
      invalidFile,
    };
  };

  it('should handle a mix of valid, invalid, and lone @ references', async () => {
    const references = await observeMixedAtReferences();
    expect(references.processedQuery).not.toBeNull();
    expect(references.error).toBeUndefined();
    expect(references.processedQuery).toBeDefined();
    expect(references.firstPart).toStrictEqual({
      type: 'text',
      text: `Look at @${references.relativePath1} then @${references.invalidFile} and also just @ symbol, then @${references.relativePath2}`,
    });
    expect(references.queryText).toContain(
      '--- Content from referenced files ---',
    );
    expect(references.queryText).toContain(
      `Content from @${references.relativePath1}:`,
    );
    expect(references.queryText).toContain(references.content1);
    expect(references.queryText).toContain(
      `Content from @${references.relativePath2}:`,
    );
    expect(references.queryText).toContain(references.content2);
    expect(references.debugMessages).toHaveBeenCalledWith(
      `Path ${references.invalidFile} not found directly, attempting glob search.`,
    );
    expect(references.debugMessages).toHaveBeenCalledWith(
      `Glob search for '**/*${references.invalidFile}*' found no files or an error. Path ${references.invalidFile} will be skipped.`,
    );
    expect(references.debugMessages).toHaveBeenCalledWith(
      'Lone @ detected, will be treated as text in the modified query.',
    );
    expect(references.queryText).toContain('--- End of content ---');
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
      getToolHandle,
    });

    expect(result).toStrictEqual({
      processedQuery: [
        { type: 'text', text: 'Check @nonexistent.txt and @ also' },
      ],
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
      getToolHandle,
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
