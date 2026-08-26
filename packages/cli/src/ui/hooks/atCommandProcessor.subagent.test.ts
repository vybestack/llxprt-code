/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import { handleAtCommand } from './atCommandProcessor.js';
import type { AgentToolHandle } from '@vybestack/llxprt-code-agents';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import {
  createTestFile,
  setupAtCommandTest,
  teardownAtCommandTest,
  type AtCommandTestSetup,
} from './atCommandProcessor-test-helpers.js';
import * as path from 'path';

describe('handleAtCommand (subagent @mentions)', () => {
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

  it('recognises @typescriptexpert as a subagent and injects a task-tool nudge', async () => {
    const subagentManager = {
      listSubagents: vi
        .fn()
        .mockResolvedValue(['typescriptexpert', 'deepthinker']),
    };

    const result = await handleAtCommand({
      query: '@typescriptexpert please review',
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 2001,
      signal: abortController.signal,
      getToolHandle,
      subagentManager,
    });

    expect(result.processedQuery).not.toBeNull();
    const parts = result.processedQuery as Array<{
      type: string;
      text: string;
    }>;
    expect(parts.length).toBeGreaterThan(0);

    // The nudge must be the first part and reference both the subagent and the task tool.
    const firstPart = parts[0];
    expect(firstPart.type).toBe('text');
    expect(firstPart.text).toContain('typescriptexpert');
    expect(firstPart.text).toContain('task');

    // No read_many_files tool call should be recorded for the subagent name.
    expect(mockAddItem).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool_group' }),
      2001,
    );
  });

  it('falls through to existing behaviour for unknown @agent names', async () => {
    const subagentManager = {
      listSubagents: vi.fn().mockResolvedValue(['typescriptexpert']),
    };

    const result = await handleAtCommand({
      query: '@unknownagent do something',
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 2002,
      signal: abortController.signal,
      getToolHandle,
      subagentManager,
    });

    expect(result.processedQuery).not.toBeNull();
    const parts = result.processedQuery as Array<{
      type: string;
      text: string;
    }>;
    const firstPart = parts[0];
    // No nudge: the first part is the (possibly trimmed) user query, not the nudge text.
    expect(firstPart.text).not.toContain(
      'explicitly selected the following subagent',
    );
  });

  it('does not crash or nudge when subagentManager is undefined', async () => {
    const result = await handleAtCommand({
      query: '@typescriptexpert please review',
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 2003,
      signal: abortController.signal,
      getToolHandle,
    });

    expect(result.processedQuery).not.toBeNull();
    const parts = result.processedQuery as Array<{
      type: string;
      text: string;
    }>;
    const firstPart = parts[0];
    expect(firstPart.text).not.toContain(
      'explicitly selected the following subagent',
    );
  });

  it('does not crash or nudge when listSubagents() rejects', async () => {
    const subagentManager = {
      listSubagents: vi.fn().mockRejectedValue(new Error('disk read failed')),
    };

    const result = await handleAtCommand({
      query: '@typescriptexpert please review',
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 2007,
      signal: abortController.signal,
      getToolHandle,
      subagentManager,
    });

    expect(result.processedQuery).not.toBeNull();
    const parts = result.processedQuery as Array<{
      type: string;
      text: string;
    }>;
    const firstPart = parts[0];
    expect(firstPart.text).not.toContain(
      'explicitly selected the following subagent',
    );
    expect(mockOnDebugMessage).toHaveBeenCalledWith(
      expect.stringContaining('failed to list subagents'),
    );
  });

  it('lists multiple matched subagents comma-separated in the nudge', async () => {
    const subagentManager = {
      listSubagents: vi.fn().mockResolvedValue(['a', 'b', 'c']),
    };

    const result = await handleAtCommand({
      query: '@a @b do the thing',
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 2004,
      signal: abortController.signal,
      getToolHandle,
      subagentManager,
    });

    expect(result.processedQuery).not.toBeNull();
    const parts = result.processedQuery as Array<{
      type: string;
      text: string;
    }>;
    const nudge = parts[0];
    expect(nudge.text).toContain('a, b');
  });

  const observeRepeatedSubagentMention = async (): Promise<{
    readonly processedQuery: unknown;
    readonly nudgeMentionCount: number;
  }> => {
    const subagentManager = {
      listSubagents: vi.fn().mockResolvedValue(['typescriptexpert']),
    };

    const result = await handleAtCommand({
      query: '@typescriptexpert @typescriptexpert do the thing',
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 2006,
      signal: abortController.signal,
      getToolHandle,
      subagentManager,
    });

    const firstPart = Array.isArray(result.processedQuery)
      ? result.processedQuery[0]
      : undefined;
    const nudgeText =
      firstPart !== undefined && 'text' in firstPart ? firstPart.text : '';
    // The subagent should appear exactly once in the nudge list.
    const matches = nudgeText.match(/typescriptexpert/g) ?? [];
    return {
      processedQuery: result.processedQuery,
      nudgeMentionCount: matches.length,
    };
  };

  it('does not duplicate a subagent in the nudge when mentioned twice', async () => {
    const mention = await observeRepeatedSubagentMention();
    expect(mention.processedQuery).not.toBeNull();
    expect(mention.nudgeMentionCount).toBe(1);
  });

  it('reads a real file and nudges a matched subagent in the same query', async () => {
    const realFile = await createTestFile(
      path.join(testRootDir, 'realfile.txt'),
      'real file contents',
    );

    const subagentManager = {
      listSubagents: vi.fn().mockResolvedValue(['typescriptexpert']),
    };

    const result = await handleAtCommand({
      query: '@typescriptexpert review @realfile.txt',
      config: mockConfig,
      addItem: mockAddItem,
      onDebugMessage: mockOnDebugMessage,
      messageId: 2005,
      signal: abortController.signal,
      getToolHandle,
      subagentManager,
    });

    expect(result.processedQuery).not.toBeNull();
    const parts = result.processedQuery as Array<{
      type: string;
      text: string;
    }>;

    // Nudge present.
    const nudge = parts.find((p) =>
      p.text.includes('explicitly selected the following subagent'),
    );
    expect(nudge).toBeDefined();
    expect(nudge!.text).toContain('typescriptexpert');

    // File content present.
    const fileContent = parts.find((p) =>
      p.text.includes('real file contents'),
    );
    expect(fileContent).toBeDefined();

    // A tool_group display should have been recorded for the read.
    expect(mockAddItem).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tool_group' }),
      2005,
    );

    void realFile;
  });
});
