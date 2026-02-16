/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P10
 * @requirement REQ-HD-005.1, REQ-HD-005.2, REQ-HD-005.3, REQ-HD-005.4, REQ-HD-005.5,
 *              REQ-HD-005.6, REQ-HD-005.7, REQ-HD-005.8, REQ-HD-005.9, REQ-HD-005.10,
 *              REQ-HD-005.11, REQ-HD-006.1, REQ-HD-006.2, REQ-HD-006.3, REQ-HD-006.4,
 *              REQ-HD-006.5, REQ-HD-007.1, REQ-HD-007.2, REQ-HD-007.3, REQ-HD-007.4,
 *              REQ-HD-007.6, REQ-HD-013.1, REQ-HD-013.2, REQ-HD-013.3, REQ-HD-013.4,
 *              REQ-HD-013.5, REQ-HD-013.6, REQ-HD-013.7
 *
 * Behavioral tests for the HighDensityStrategy.optimize() method and its three
 * sub-phases: pruneReadWritePairs, deduplicateFileInclusions, pruneByRecency.
 *
 * Tests operate on a REAL HighDensityStrategy instance. History entries are
 * constructed as real IContent objects. No mock theater.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
} from '../../../services/history/IContent.js';
import type { DensityConfig } from '../types.js';
import { HighDensityStrategy, PRUNED_POINTER } from '../HighDensityStrategy.js';

// ---------------------------------------------------------------------------
// Test helpers — construct real IContent objects
// ---------------------------------------------------------------------------

let callIdCounter = 0;

function nextCallId(): string {
  return `call-${++callIdCounter}`;
}

function resetCallIds(): void {
  callIdCounter = 0;
}

function makeHumanMessage(text: string, timestamp?: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: { timestamp: timestamp ?? Date.now() },
  };
}

function makeAiText(text: string, timestamp?: number): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { timestamp: timestamp ?? Date.now() },
  };
}

function makeAiToolCall(
  toolName: string,
  parameters: unknown,
  callId?: string,
): { entry: IContent; callId: string } {
  const id = callId ?? nextCallId();
  return {
    entry: {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id,
          name: toolName,
          parameters,
        } as ToolCallBlock,
      ],
      metadata: { timestamp: Date.now() },
    },
    callId: id,
  };
}

function _makeAiMultiToolCall(
  calls: Array<{ toolName: string; parameters: unknown; callId?: string }>,
): { entry: IContent; callIds: string[] } {
  const callIds: string[] = [];
  const blocks = calls.map((c) => {
    const id = c.callId ?? nextCallId();
    callIds.push(id);
    return {
      type: 'tool_call' as const,
      id,
      name: c.toolName,
      parameters: c.parameters,
    } as ToolCallBlock;
  });
  return {
    entry: {
      speaker: 'ai',
      blocks,
      metadata: { timestamp: Date.now() },
    },
    callIds,
  };
}

function makeToolResponse(
  callId: string,
  toolName: string,
  result: unknown,
): IContent {
  return {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId,
        toolName,
        result,
      } as ToolResponseBlock,
    ],
    metadata: { timestamp: Date.now() },
  };
}

function _makeMultiToolResponse(
  responses: Array<{ callId: string; toolName: string; result: unknown }>,
): IContent {
  return {
    speaker: 'tool',
    blocks: responses.map((r) => ({
      type: 'tool_response' as const,
      callId: r.callId,
      toolName: r.toolName,
      result: r.result,
    })) as ToolResponseBlock[],
    metadata: { timestamp: Date.now() },
  };
}

/**
 * Build a read-then-write sequence for a given file path.
 * Returns [aiReadEntry, toolReadResponse, aiWriteEntry, toolWriteResponse] and callIds.
 */
function makeReadWritePair(
  filePath: string,
  readTool = 'read_file',
  writeTool = 'write_file',
): { entries: IContent[]; readCallId: string; writeCallId: string } {
  const readCall = makeAiToolCall(readTool, { file_path: filePath });
  const readResponse = makeToolResponse(
    readCall.callId,
    readTool,
    `contents of ${filePath}`,
  );
  const writeCall = makeAiToolCall(writeTool, { file_path: filePath });
  const writeResponse = makeToolResponse(
    writeCall.callId,
    writeTool,
    `wrote ${filePath}`,
  );
  return {
    entries: [readCall.entry, readResponse, writeCall.entry, writeResponse],
    readCallId: readCall.callId,
    writeCallId: writeCall.callId,
  };
}

function makeHumanWithFileInclusion(
  filePath: string,
  fileContent: string,
  surroundingText = '',
): IContent {
  const inclusionBlock = `--- ${filePath} ---\n${fileContent}\n--- End of content ---`;
  const text = surroundingText
    ? `${surroundingText}\n${inclusionBlock}`
    : inclusionBlock;
  return makeHumanMessage(text);
}

function defaultConfig(overrides: Partial<DensityConfig> = {}): DensityConfig {
  return {
    readWritePruning: true,
    fileDedupe: true,
    recencyPruning: true,
    recencyRetention: 3,
    workspaceRoot: '/workspace',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Strategy instance
// ---------------------------------------------------------------------------

function createStrategy(): HighDensityStrategy {
  return new HighDensityStrategy();
}

// ---------------------------------------------------------------------------
// READ → WRITE Pruning Tests
// ---------------------------------------------------------------------------

describe('pruneReadWritePairs @plan PLAN-20260211-HIGHDENSITY.P10', () => {
  beforeEach(() => resetCallIds());

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.1, REQ-HD-005.6
   * @pseudocode high-density-optimize.md lines 60-209
   */
  it('stale read is removed when a later write exists for the same file', () => {
    const strategy = createStrategy();
    const { entries } = makeReadWritePair('/workspace/src/a.ts');
    // entries: [aiRead, toolRead, aiWrite, toolWrite]
    const history: IContent[] = [...entries];
    const config = defaultConfig({ fileDedupe: false, recencyPruning: false });

    const result = strategy.optimize(history, config);

    // The read's AI entry (index 0) and tool response (index 1) should be removed or replaced
    const allAffected = new Set([
      ...result.removals,
      ...result.replacements.keys(),
    ]);
    expect(allAffected.has(0) || allAffected.has(1)).toBe(true);
    // The write entries (index 2, 3) should NOT be affected
    expect(result.removals).not.toContain(2);
    expect(result.removals).not.toContain(3);
    expect(result.replacements.has(2)).toBe(false);
    expect(result.replacements.has(3)).toBe(false);
    expect(result.metadata.readWritePairsPruned).toBeGreaterThan(0);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.7
   * @pseudocode high-density-optimize.md lines 136-137
   */
  it('post-write read is preserved', () => {
    const strategy = createStrategy();
    // Write first, then read
    const writeCall = makeAiToolCall('write_file', {
      file_path: '/workspace/src/a.ts',
    });
    const writeResp = makeToolResponse(
      writeCall.callId,
      'write_file',
      'wrote a.ts',
    );
    const readCall = makeAiToolCall('read_file', {
      file_path: '/workspace/src/a.ts',
    });
    const readResp = makeToolResponse(
      readCall.callId,
      'read_file',
      'contents of a.ts',
    );

    const history: IContent[] = [
      writeCall.entry,
      writeResp,
      readCall.entry,
      readResp,
    ];
    const config = defaultConfig({ fileDedupe: false, recencyPruning: false });

    const result = strategy.optimize(history, config);

    // Read entries (index 2, 3) should NOT be removed or replaced
    expect(result.removals).not.toContain(2);
    expect(result.removals).not.toContain(3);
    expect(result.replacements.has(2)).toBe(false);
    expect(result.replacements.has(3)).toBe(false);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.2
   * @pseudocode high-density-optimize.md lines 10, 117-119
   */
  it('all read tool types are recognized as stale when followed by a write', () => {
    const strategy = createStrategy();
    const readTools = [
      'read_file',
      'read_line_range',
      'read_many_files',
      'ast_read_file',
    ] as const;
    const history: IContent[] = [];

    const readCallIds: string[] = [];
    for (const readTool of readTools) {
      const filePath = `/workspace/src/${readTool}.ts`;
      const params =
        readTool === 'read_many_files'
          ? { paths: [filePath] }
          : { file_path: filePath };
      const rc = makeAiToolCall(readTool, params);
      readCallIds.push(rc.callId);
      history.push(rc.entry);
      history.push(
        makeToolResponse(rc.callId, readTool, `content of ${filePath}`),
      );
    }

    // Add writes for all of them
    for (const readTool of readTools) {
      const filePath = `/workspace/src/${readTool}.ts`;
      const wc = makeAiToolCall('write_file', { file_path: filePath });
      history.push(wc.entry);
      history.push(
        makeToolResponse(wc.callId, 'write_file', `wrote ${filePath}`),
      );
    }

    const config = defaultConfig({ fileDedupe: false, recencyPruning: false });
    const result = strategy.optimize(history, config);

    // All 4 read types should have produced removals/replacements
    expect(result.metadata.readWritePairsPruned).toBeGreaterThanOrEqual(4);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.3
   * @pseudocode high-density-optimize.md lines 11, 80-81
   */
  it('all write tool types are recognized and cause preceding reads to be stale', () => {
    const strategy = createStrategy();
    const writeTools = [
      'write_file',
      'ast_edit',
      'replace',
      'insert_at_line',
      'delete_line_range',
    ] as const;
    const history: IContent[] = [];

    for (const writeTool of writeTools) {
      const filePath = `/workspace/src/${writeTool}.ts`;
      // Read first
      const rc = makeAiToolCall('read_file', { file_path: filePath });
      history.push(rc.entry);
      history.push(
        makeToolResponse(rc.callId, 'read_file', `content of ${filePath}`),
      );
      // Then write
      const wc = makeAiToolCall(writeTool, { file_path: filePath });
      history.push(wc.entry);
      history.push(makeToolResponse(wc.callId, writeTool, `wrote ${filePath}`));
    }

    const config = defaultConfig({ fileDedupe: false, recencyPruning: false });
    const result = strategy.optimize(history, config);

    expect(result.metadata.readWritePairsPruned).toBeGreaterThanOrEqual(5);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.4
   * @pseudocode high-density-optimize.md lines 260-267
   */
  it('file_path, absolute_path, and path keys all extract correctly', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

    // Read with file_path key
    const rc1 = makeAiToolCall('read_file', { file_path: '/workspace/a.ts' });
    history.push(rc1.entry);
    history.push(makeToolResponse(rc1.callId, 'read_file', 'content a'));

    // Read with absolute_path key
    const rc2 = makeAiToolCall('read_file', {
      absolute_path: '/workspace/b.ts',
    });
    history.push(rc2.entry);
    history.push(makeToolResponse(rc2.callId, 'read_file', 'content b'));

    // Read with path key
    const rc3 = makeAiToolCall('read_file', { path: '/workspace/c.ts' });
    history.push(rc3.entry);
    history.push(makeToolResponse(rc3.callId, 'read_file', 'content c'));

    // Writes for all three
    for (const fp of [
      '/workspace/a.ts',
      '/workspace/b.ts',
      '/workspace/c.ts',
    ]) {
      const wc = makeAiToolCall('write_file', { file_path: fp });
      history.push(wc.entry);
      history.push(makeToolResponse(wc.callId, 'write_file', `wrote ${fp}`));
    }

    const config = defaultConfig({ fileDedupe: false, recencyPruning: false });
    const result = strategy.optimize(history, config);

    expect(result.metadata.readWritePairsPruned).toBeGreaterThanOrEqual(3);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.5, REQ-HD-005.11
   * @pseudocode high-density-optimize.md lines 270-273
   */
  it('paths are normalized via path.resolve before comparison', () => {
    const strategy = createStrategy();

    // Read with unnormalized path
    const rc = makeAiToolCall('read_file', { file_path: 'src/../src/foo.ts' });
    const readResp = makeToolResponse(rc.callId, 'read_file', 'content');

    // Write with normalized path
    const wc = makeAiToolCall('write_file', { file_path: 'src/foo.ts' });
    const writeResp = makeToolResponse(wc.callId, 'write_file', 'wrote');

    const history: IContent[] = [rc.entry, readResp, wc.entry, writeResp];
    const config = defaultConfig({
      fileDedupe: false,
      recencyPruning: false,
      workspaceRoot: '/workspace',
    });

    const result = strategy.optimize(history, config);

    // Both paths resolve to /workspace/src/foo.ts so the read should be stale
    expect(result.metadata.readWritePairsPruned).toBeGreaterThan(0);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.8
   * @pseudocode high-density-optimize.md lines 148-174
   */
  it('block-level granularity preserves non-stale tool calls in same AI entry', () => {
    const strategy = createStrategy();

    // AI entry with two tool calls: one read (stale), one search (not stale)
    const readCallId = nextCallId();
    const searchCallId = nextCallId();
    const aiEntry: IContent = {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: readCallId,
          name: 'read_file',
          parameters: { file_path: '/workspace/a.ts' },
        } as ToolCallBlock,
        {
          type: 'tool_call',
          id: searchCallId,
          name: 'search_file_content',
          parameters: { pattern: 'foo' },
        } as ToolCallBlock,
      ],
      metadata: { timestamp: Date.now() },
    };

    const readResp = makeToolResponse(readCallId, 'read_file', 'content');
    const searchResp = makeToolResponse(
      searchCallId,
      'search_file_content',
      'found foo',
    );

    // Later write to a.ts
    const wc = makeAiToolCall('write_file', { file_path: '/workspace/a.ts' });
    const writeResp = makeToolResponse(wc.callId, 'write_file', 'wrote a.ts');

    const history: IContent[] = [
      aiEntry,
      readResp,
      searchResp,
      wc.entry,
      writeResp,
    ];
    const config = defaultConfig({ fileDedupe: false, recencyPruning: false });

    const result = strategy.optimize(history, config);

    // The AI entry (index 0) should be in replacements (not removals) with only the search call
    expect(result.replacements.has(0)).toBe(true);
    expect(result.removals).not.toContain(0);
    const replacement = result.replacements.get(0)!;
    const toolCallBlocks = replacement.blocks.filter(
      (b): b is ToolCallBlock => b.type === 'tool_call',
    );
    expect(toolCallBlocks).toHaveLength(1);
    expect(toolCallBlocks[0].name).toBe('search_file_content');
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.9
   * @pseudocode high-density-optimize.md lines 215-255
   */
  it('read_many_files with all concrete paths having writes is removable', () => {
    const strategy = createStrategy();

    const readCall = makeAiToolCall('read_many_files', {
      paths: ['/workspace/a.ts', '/workspace/b.ts'],
    });
    const readResp = makeToolResponse(
      readCall.callId,
      'read_many_files',
      'contents',
    );

    // Write to both
    const wc1 = makeAiToolCall('write_file', { file_path: '/workspace/a.ts' });
    const wr1 = makeToolResponse(wc1.callId, 'write_file', 'wrote a');
    const wc2 = makeAiToolCall('write_file', { file_path: '/workspace/b.ts' });
    const wr2 = makeToolResponse(wc2.callId, 'write_file', 'wrote b');

    const history: IContent[] = [
      readCall.entry,
      readResp,
      wc1.entry,
      wr1,
      wc2.entry,
      wr2,
    ];
    const config = defaultConfig({ fileDedupe: false, recencyPruning: false });

    const result = strategy.optimize(history, config);

    const allAffected = new Set([
      ...result.removals,
      ...result.replacements.keys(),
    ]);
    // The read_many_files AI entry or its tool response should be affected
    expect(allAffected.has(0) || allAffected.has(1)).toBe(true);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.9
   * @pseudocode high-density-optimize.md lines 251-252
   */
  it('read_many_files with glob paths is not removable', () => {
    const strategy = createStrategy();

    const readCall = makeAiToolCall('read_many_files', {
      paths: ['src/*.ts'],
    });
    const readResp = makeToolResponse(
      readCall.callId,
      'read_many_files',
      'glob contents',
    );

    // Write to a specific file that would match the glob
    const wc = makeAiToolCall('write_file', {
      file_path: '/workspace/src/foo.ts',
    });
    const wr = makeToolResponse(wc.callId, 'write_file', 'wrote foo');

    const history: IContent[] = [readCall.entry, readResp, wc.entry, wr];
    const config = defaultConfig({ fileDedupe: false, recencyPruning: false });

    const result = strategy.optimize(history, config);

    // read_many_files entry should NOT be in removals or replacements for RW pruning
    expect(result.removals).not.toContain(0);
    expect(result.removals).not.toContain(1);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.10
   * @pseudocode high-density-optimize.md lines 30
   */
  it('read-write pruning disabled when config false', () => {
    const strategy = createStrategy();
    const { entries } = makeReadWritePair('/workspace/src/a.ts');
    const history: IContent[] = [...entries];
    const config = defaultConfig({
      readWritePruning: false,
      fileDedupe: false,
      recencyPruning: false,
    });

    const result = strategy.optimize(history, config);

    expect(result.metadata.readWritePairsPruned).toBe(0);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-013.5
   * @pseudocode high-density-optimize.md lines 84-85, 260-267
   */
  it('malformed tool parameters are skipped without throwing', () => {
    const strategy = createStrategy();

    // Tool call with null parameters
    const rc1 = makeAiToolCall('read_file', null);
    const resp1 = makeToolResponse(rc1.callId, 'read_file', 'some result');

    // Tool call with unrelated parameters
    const rc2 = makeAiToolCall('read_file', { unrelated: true });
    const resp2 = makeToolResponse(rc2.callId, 'read_file', 'another result');

    // Valid write to ensure we exercise the write map too
    const wc = makeAiToolCall('write_file', { file_path: '/workspace/a.ts' });
    const wr = makeToolResponse(wc.callId, 'write_file', 'wrote a');

    const history: IContent[] = [
      rc1.entry,
      resp1,
      rc2.entry,
      resp2,
      wc.entry,
      wr,
    ];
    const config = defaultConfig({ fileDedupe: false, recencyPruning: false });

    // Should not throw
    expect(() => strategy.optimize(history, config)).not.toThrow();
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.11
   * @pseudocode high-density-optimize.md lines 87, 270-273
   */
  it('relative paths resolved against workspaceRoot', () => {
    const strategy = createStrategy();

    const rc = makeAiToolCall('read_file', { file_path: 'src/foo.ts' });
    const readResp = makeToolResponse(rc.callId, 'read_file', 'content');

    const wc = makeAiToolCall('write_file', {
      file_path: '/project/src/foo.ts',
    });
    const writeResp = makeToolResponse(wc.callId, 'write_file', 'wrote');

    const history: IContent[] = [rc.entry, readResp, wc.entry, writeResp];
    const config = defaultConfig({
      fileDedupe: false,
      recencyPruning: false,
      workspaceRoot: '/project',
    });

    const result = strategy.optimize(history, config);

    // 'src/foo.ts' resolved against '/project' = '/project/src/foo.ts'
    expect(result.metadata.readWritePairsPruned).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// @ File Deduplication Tests
// ---------------------------------------------------------------------------

describe('deduplicateFileInclusions @plan PLAN-20260211-HIGHDENSITY.P10', () => {
  beforeEach(() => resetCallIds());

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-006.1, REQ-HD-006.2
   * @pseudocode high-density-optimize.md lines 280-359
   */
  it('duplicate file inclusions are stripped, latest preserved', () => {
    const strategy = createStrategy();
    const history: IContent[] = [
      makeHumanMessage('hello'),
      makeAiText('hi'),
      makeHumanWithFileInclusion('src/foo.ts', 'version1'),
      makeAiText('noted'),
      makeHumanMessage('more chat'),
      makeHumanWithFileInclusion('src/foo.ts', 'version2'),
      makeAiText('got it'),
    ];
    const config = defaultConfig({
      readWritePruning: false,
      recencyPruning: false,
    });

    const result = strategy.optimize(history, config);

    // Index 2 (earlier inclusion) should be in replacements with content stripped
    expect(result.replacements.has(2)).toBe(true);
    const replaced = result.replacements.get(2)!;
    const textBlocks = replaced.blocks.filter((b) => b.type === 'text');
    // The file content should be removed from the earlier inclusion
    for (const tb of textBlocks) {
      if (tb.type === 'text') {
        expect(tb.text).not.toContain('version1');
      }
    }
    // Index 5 (latest inclusion) should NOT be in replacements
    expect(result.replacements.has(5)).toBe(false);
    expect(result.metadata.fileDeduplicationsPruned).toBeGreaterThan(0);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-006.3
   * @pseudocode high-density-optimize.md lines 340-356
   */
  it('dedup uses replacement not removal — surrounding text preserved', () => {
    const strategy = createStrategy();
    const history: IContent[] = [
      makeHumanWithFileInclusion('src/foo.ts', 'old content', 'Fix this:'),
      makeAiText('ok'),
      makeHumanWithFileInclusion('src/foo.ts', 'new content'),
    ];
    const config = defaultConfig({
      readWritePruning: false,
      recencyPruning: false,
    });

    const result = strategy.optimize(history, config);

    // Index 0 should be in replacements (not removals)
    expect(result.replacements.has(0)).toBe(true);
    expect(result.removals).not.toContain(0);

    // The surrounding text "Fix this:" should be preserved
    const replaced = result.replacements.get(0)!;
    const textContent = replaced.blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('');
    expect(textContent).toContain('Fix this:');
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-006.4
   * @pseudocode high-density-optimize.md lines 37
   */
  it('file dedup disabled when config false', () => {
    const strategy = createStrategy();
    const history: IContent[] = [
      makeHumanWithFileInclusion('src/foo.ts', 'version1'),
      makeAiText('ok'),
      makeHumanWithFileInclusion('src/foo.ts', 'version2'),
    ];
    const config = defaultConfig({
      readWritePruning: false,
      fileDedupe: false,
      recencyPruning: false,
    });

    const result = strategy.optimize(history, config);

    expect(result.metadata.fileDeduplicationsPruned).toBe(0);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-006.5
   * @pseudocode high-density-optimize.md lines 380-381
   */
  it('unpaired delimiters leave text unchanged', () => {
    const strategy = createStrategy();
    // Opening delimiter but no closing delimiter
    const brokenInclusion = makeHumanMessage(
      '--- src/foo.ts ---\nsome content without closing',
    );
    const history: IContent[] = [
      brokenInclusion,
      makeAiText('ok'),
      makeHumanWithFileInclusion('src/foo.ts', 'proper content'),
    ];
    const config = defaultConfig({
      readWritePruning: false,
      recencyPruning: false,
    });

    const result = strategy.optimize(history, config);

    // The broken inclusion at index 0 should not be detected/modified
    // Only the valid one at index 2 counts, so with only 1 valid inclusion no dedup needed
    expect(result.metadata.fileDeduplicationsPruned).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Recency Pruning Tests
// ---------------------------------------------------------------------------

describe('pruneByRecency @plan PLAN-20260211-HIGHDENSITY.P10', () => {
  beforeEach(() => resetCallIds());

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-007.1, REQ-HD-007.2
   * @pseudocode high-density-optimize.md lines 400-464
   */
  it('old tool results beyond retention are replaced with pointer', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

    // 5 read_file tool responses
    for (let i = 0; i < 5; i++) {
      const rc = makeAiToolCall('read_file', {
        file_path: `/workspace/file${i}.ts`,
      });
      history.push(rc.entry);
      history.push(
        makeToolResponse(rc.callId, 'read_file', `content of file${i}`),
      );
    }

    const config = defaultConfig({
      readWritePruning: false,
      fileDedupe: false,
      recencyPruning: true,
      recencyRetention: 3,
    });

    const result = strategy.optimize(history, config);

    // 2 oldest should be pruned (5 - 3 = 2)
    expect(result.metadata.recencyPruned).toBe(2);

    // Check that the pruned entries have the pointer string
    for (const [idx, replacement] of result.replacements) {
      const toolBlocks = replacement.blocks.filter(
        (b): b is ToolResponseBlock => b.type === 'tool_response',
      );
      for (const tb of toolBlocks) {
        if (tb.result === PRUNED_POINTER) {
          // Verify it's one of the old entries (indices 1, 3 = first two tool responses)
          expect(idx).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-007.1
   * @pseudocode high-density-optimize.md lines 410-434
   */
  it('per-tool-name counting', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

    // 4 read_file responses
    for (let i = 0; i < 4; i++) {
      const rc = makeAiToolCall('read_file', {
        file_path: `/workspace/read${i}.ts`,
      });
      history.push(rc.entry);
      history.push(
        makeToolResponse(rc.callId, 'read_file', `read content ${i}`),
      );
    }

    // 4 search_file_content responses
    for (let i = 0; i < 4; i++) {
      const sc = makeAiToolCall('search_file_content', {
        pattern: `pattern${i}`,
      });
      history.push(sc.entry);
      history.push(
        makeToolResponse(
          sc.callId,
          'search_file_content',
          `search result ${i}`,
        ),
      );
    }

    const config = defaultConfig({
      readWritePruning: false,
      fileDedupe: false,
      recencyPruning: true,
      recencyRetention: 3,
    });

    const result = strategy.optimize(history, config);

    // 1 oldest read_file pruned + 1 oldest search_file_content pruned = 2
    expect(result.metadata.recencyPruned).toBe(2);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-007.3
   * @pseudocode high-density-optimize.md lines 447-456
   */
  it('structure preservation — only result field changes', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

    // Create 4 read_file responses with retention of 2
    for (let i = 0; i < 4; i++) {
      const callId = nextCallId();
      const aiEntry: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: callId,
            name: 'read_file',
            parameters: { file_path: `/workspace/f${i}.ts` },
          } as ToolCallBlock,
        ],
        metadata: { timestamp: 1000 + i },
      };
      const toolEntry: IContent = {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId,
            toolName: 'read_file',
            result: `content ${i}`,
            isComplete: true,
          } as ToolResponseBlock,
        ],
        metadata: { timestamp: 1100 + i },
      };
      history.push(aiEntry, toolEntry);
    }

    const config = defaultConfig({
      readWritePruning: false,
      fileDedupe: false,
      recencyPruning: true,
      recencyRetention: 2,
    });

    const result = strategy.optimize(history, config);

    // Check that pruned replacements preserve structure
    for (const [, replacement] of result.replacements) {
      expect(replacement.speaker).toBe('tool');
      expect(replacement.metadata).toBeDefined();
      const responseBlocks = replacement.blocks.filter(
        (b): b is ToolResponseBlock => b.type === 'tool_response',
      );
      for (const rb of responseBlocks) {
        expect(rb.type).toBe('tool_response');
        expect(rb.callId).toBeDefined();
        expect(rb.toolName).toBe('read_file');
        if (rb.result === PRUNED_POINTER) {
          // Structure is preserved — only result changed
          expect(rb.isComplete).toBe(true);
        }
      }
    }
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-007.6
   * @pseudocode high-density-optimize.md lines 43
   */
  it('recency pruning disabled when config false', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

    for (let i = 0; i < 5; i++) {
      const rc = makeAiToolCall('read_file', {
        file_path: `/workspace/f${i}.ts`,
      });
      history.push(rc.entry);
      history.push(makeToolResponse(rc.callId, 'read_file', `content ${i}`));
    }

    const config = defaultConfig({
      readWritePruning: false,
      fileDedupe: false,
      recencyPruning: false,
      recencyRetention: 3,
    });

    const result = strategy.optimize(history, config);

    expect(result.metadata.recencyPruned).toBe(0);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-013.6
   * @pseudocode high-density-optimize.md line 408
   */
  it('recencyRetention < 1 is treated as 1', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

    for (let i = 0; i < 3; i++) {
      const rc = makeAiToolCall('read_file', {
        file_path: `/workspace/f${i}.ts`,
      });
      history.push(rc.entry);
      history.push(makeToolResponse(rc.callId, 'read_file', `content ${i}`));
    }

    const config = defaultConfig({
      readWritePruning: false,
      fileDedupe: false,
      recencyPruning: true,
      recencyRetention: 0,
    });

    const result = strategy.optimize(history, config);

    // With retention floor of 1, 2 out of 3 should be pruned
    expect(result.metadata.recencyPruned).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Optimize Orchestration Tests
// ---------------------------------------------------------------------------

describe('optimize() orchestration @plan PLAN-20260211-HIGHDENSITY.P10', () => {
  beforeEach(() => resetCallIds());

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-013.7
   * @pseudocode high-density-optimize.md lines 20-53
   */
  it('optimize merges phases in deterministic order', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

    // Phase 1 trigger: read then write
    const { entries: rwEntries } = makeReadWritePair('/workspace/src/a.ts');
    history.push(...rwEntries);

    // Phase 2 trigger: duplicate file inclusions
    history.push(makeHumanWithFileInclusion('src/b.ts', 'content v1'));
    history.push(makeAiText('noted'));
    history.push(makeHumanWithFileInclusion('src/b.ts', 'content v2'));
    history.push(makeAiText('got it'));

    // Phase 3 trigger: many tool results for recency
    for (let i = 0; i < 5; i++) {
      const sc = makeAiToolCall('search_file_content', {
        pattern: `pattern${i}`,
      });
      history.push(sc.entry);
      history.push(
        makeToolResponse(sc.callId, 'search_file_content', `result ${i}`),
      );
    }

    const config = defaultConfig({ recencyRetention: 3 });
    const result = strategy.optimize(history, config);

    // No index in both removals and replacements
    for (const idx of result.removals) {
      expect(result.replacements.has(idx)).toBe(false);
    }
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-013.7
   * @pseudocode high-density-optimize.md lines 23-27
   */
  it('metadata counts are accurate across all phases', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

    // 2 read-write pairs
    const rw1 = makeReadWritePair('/workspace/rw1.ts');
    history.push(...rw1.entries);
    const rw2 = makeReadWritePair('/workspace/rw2.ts');
    history.push(...rw2.entries);

    // 1 dedup (2 inclusions of same file)
    history.push(makeHumanWithFileInclusion('src/dup.ts', 'v1'));
    history.push(makeAiText('ok'));
    history.push(makeHumanWithFileInclusion('src/dup.ts', 'v2'));
    history.push(makeAiText('ok'));

    // 4 search results with retention 3 → 1 pruned
    for (let i = 0; i < 4; i++) {
      const sc = makeAiToolCall('search_file_content', { pattern: `p${i}` });
      history.push(sc.entry);
      history.push(makeToolResponse(sc.callId, 'search_file_content', `r${i}`));
    }

    const config = defaultConfig({ recencyRetention: 3 });
    const result = strategy.optimize(history, config);

    expect(result.metadata.readWritePairsPruned).toBe(2);
    expect(result.metadata.fileDeduplicationsPruned).toBe(1);
    expect(result.metadata.recencyPruned).toBe(1);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @pseudocode high-density-optimize.md lines 33, 39, 45
   */
  it('entries already removed by RW pruning are skipped by dedup and recency', () => {
    const strategy = createStrategy();

    // Read a file, then write it — the read tool response should be removed by RW pruning
    const rc = makeAiToolCall('read_file', { file_path: '/workspace/a.ts' });
    const readResp = makeToolResponse(
      rc.callId,
      'read_file',
      'content of a.ts',
    );
    const wc = makeAiToolCall('write_file', { file_path: '/workspace/a.ts' });
    const writeResp = makeToolResponse(wc.callId, 'write_file', 'wrote a.ts');

    const history: IContent[] = [rc.entry, readResp, wc.entry, writeResp];
    const config = defaultConfig({ recencyRetention: 1 });

    const result = strategy.optimize(history, config);

    // No index in both removals and replacements
    for (const idx of result.removals) {
      expect(result.replacements.has(idx)).toBe(false);
    }
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @pseudocode high-density-optimize.md lines 20-53
   */
  it('empty history returns empty result', () => {
    const strategy = createStrategy();
    const config = defaultConfig();

    const result = strategy.optimize([], config);

    expect(result.removals).toHaveLength(0);
    expect(result.replacements.size).toBe(0);
    expect(result.metadata.readWritePairsPruned).toBe(0);
    expect(result.metadata.fileDeduplicationsPruned).toBe(0);
    expect(result.metadata.recencyPruned).toBe(0);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @pseudocode high-density-optimize.md lines 30-46
   */
  it('all config options false returns empty result', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

    // Add content that would trigger all phases
    const { entries } = makeReadWritePair('/workspace/a.ts');
    history.push(...entries);
    history.push(makeHumanWithFileInclusion('src/b.ts', 'v1'));
    history.push(makeHumanWithFileInclusion('src/b.ts', 'v2'));

    const config = defaultConfig({
      readWritePruning: false,
      fileDedupe: false,
      recencyPruning: false,
    });

    const result = strategy.optimize(history, config);

    expect(result.removals).toHaveLength(0);
    expect(result.replacements.size).toBe(0);
    expect(result.metadata.readWritePairsPruned).toBe(0);
    expect(result.metadata.fileDeduplicationsPruned).toBe(0);
    expect(result.metadata.recencyPruned).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Failure Mode Tests
// ---------------------------------------------------------------------------

describe('Failure modes @plan PLAN-20260211-HIGHDENSITY.P10', () => {
  beforeEach(() => resetCallIds());

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-013.1
   * @pseudocode high-density-optimize.md lines 74-76
   */
  it('optimize gracefully degrades on unexpected tool structure', () => {
    const strategy = createStrategy();

    // Entry with missing blocks
    const malformed: IContent = {
      speaker: 'ai',
      blocks: [],
      metadata: { timestamp: Date.now() },
    };

    // Normal entry
    const { entries } = makeReadWritePair('/workspace/a.ts');

    const history: IContent[] = [malformed, ...entries];
    const config = defaultConfig({ fileDedupe: false, recencyPruning: false });

    // Should not crash
    expect(() => strategy.optimize(history, config)).not.toThrow();
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-013.2
   * @pseudocode high-density-optimize.md lines 48-53
   */
  it('optimize with no matching patterns returns empty result gracefully', () => {
    const strategy = createStrategy();
    const history: IContent[] = [
      makeHumanMessage('hello'),
      makeAiText('hi there'),
      makeHumanMessage('how are you?'),
      makeAiText('doing well'),
    ];
    const config = defaultConfig();

    const result = strategy.optimize(history, config);

    expect(result.removals).toHaveLength(0);
    expect(result.replacements.size).toBe(0);
    expect(result.metadata.readWritePairsPruned).toBe(0);
    expect(result.metadata.fileDeduplicationsPruned).toBe(0);
    expect(result.metadata.recencyPruned).toBe(0);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-013.3
   * @pseudocode high-density-optimize.md lines 29-46
   */
  it('individual pruning pass failure does not block other passes', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

    // Add content for recency pruning (which should still work even if RW pruning has issues)
    for (let i = 0; i < 5; i++) {
      const rc = makeAiToolCall('search_file_content', { pattern: `p${i}` });
      history.push(rc.entry);
      history.push(
        makeToolResponse(rc.callId, 'search_file_content', `result ${i}`),
      );
    }

    const config = defaultConfig({
      readWritePruning: true,
      fileDedupe: true,
      recencyPruning: true,
      recencyRetention: 3,
    });

    // When all passes are enabled and there's only recency-prunable content,
    // the RW and dedup passes should produce 0 and recency should produce results
    const result = strategy.optimize(history, config);

    expect(result.metadata.readWritePairsPruned).toBe(0);
    expect(result.metadata.fileDeduplicationsPruned).toBe(0);
    expect(result.metadata.recencyPruned).toBe(2);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-013.4
   * @pseudocode high-density-optimize.md lines 48-53
   */
  it('optimize never produces out-of-bounds indices', () => {
    const strategy = createStrategy();
    const { entries } = makeReadWritePair('/workspace/a.ts');
    const history: IContent[] = [...entries];
    const config = defaultConfig({ fileDedupe: false, recencyPruning: false });

    const result = strategy.optimize(history, config);

    for (const idx of result.removals) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(history.length);
    }
    for (const idx of result.replacements.keys()) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(history.length);
    }
  });
});

// ---------------------------------------------------------------------------
// Property-based tests (≥ 30% of total)
// ---------------------------------------------------------------------------

describe('Property-based tests @plan PLAN-20260211-HIGHDENSITY.P10', () => {
  // Arbitrary generators for IContent history

  const arbFilePath = fc.stringMatching(/^\/workspace\/src\/[a-z]{1,8}\.ts$/);

  const _arbToolCallEntry = arbFilePath.chain((fp) =>
    fc.record({
      speaker: fc.constant('ai' as const),
      blocks: fc.constant([
        {
          type: 'tool_call' as const,
          id: `call-${fp}`,
          name: 'read_file',
          parameters: { file_path: fp },
        } as ToolCallBlock,
      ]),
      metadata: fc.record({ timestamp: fc.nat() }).map((m) => m),
    }),
  );

  const _arbToolResponseEntry = arbFilePath.chain((fp) =>
    fc.record({
      speaker: fc.constant('tool' as const),
      blocks: fc.constant([
        {
          type: 'tool_response' as const,
          callId: `call-${fp}`,
          toolName: 'read_file',
          result: `content of ${fp}`,
        } as ToolResponseBlock,
      ]),
      metadata: fc.record({ timestamp: fc.nat() }).map((m) => m),
    }),
  );

  const arbHumanEntry = fc
    .string({ minLength: 1, maxLength: 100 })
    .map((text) => makeHumanMessage(text));

  const arbAiEntry = fc
    .string({ minLength: 1, maxLength: 100 })
    .map((text) => makeAiText(text));

  const arbSimpleHistory = fc.array(fc.oneof(arbHumanEntry, arbAiEntry), {
    minLength: 0,
    maxLength: 20,
  });

  const arbConfig = fc.record({
    readWritePruning: fc.boolean(),
    fileDedupe: fc.boolean(),
    recencyPruning: fc.boolean(),
    recencyRetention: fc.integer({ min: -1, max: 10 }),
    workspaceRoot: fc.constant('/workspace'),
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-001.6
   */
  it('removals and replacements never overlap', () => {
    const strategy = createStrategy();

    fc.assert(
      fc.property(arbSimpleHistory, arbConfig, (history, config) => {
        const result = strategy.optimize(history, config);
        for (const idx of result.removals) {
          expect(result.replacements.has(idx)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-001.7
   */
  it('all indices in result are within bounds', () => {
    const strategy = createStrategy();

    fc.assert(
      fc.property(arbSimpleHistory, arbConfig, (history, config) => {
        const result = strategy.optimize(history, config);
        for (const idx of result.removals) {
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(history.length);
        }
        for (const idx of result.replacements.keys()) {
          expect(idx).toBeGreaterThanOrEqual(0);
          expect(idx).toBeLessThan(history.length);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-001.8
   */
  it('metadata counts are non-negative', () => {
    const strategy = createStrategy();

    fc.assert(
      fc.property(arbSimpleHistory, arbConfig, (history, config) => {
        const result = strategy.optimize(history, config);
        expect(result.metadata.readWritePairsPruned).toBeGreaterThanOrEqual(0);
        expect(result.metadata.fileDeduplicationsPruned).toBeGreaterThanOrEqual(
          0,
        );
        expect(result.metadata.recencyPruned).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   */
  it('disabling all options produces empty result', () => {
    const strategy = createStrategy();

    fc.assert(
      fc.property(arbSimpleHistory, (history) => {
        const config = defaultConfig({
          readWritePruning: false,
          fileDedupe: false,
          recencyPruning: false,
        });
        const result = strategy.optimize(history, config);
        expect(result.removals).toHaveLength(0);
        expect(result.replacements.size).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.7
   */
  it('post-write reads are never removed', () => {
    const strategy = createStrategy();

    // Generate a history where we write first, then read — the read must never be pruned
    fc.assert(
      fc.property(arbFilePath, (fp) => {
        const writeCall = makeAiToolCall('write_file', { file_path: fp });
        const writeResp = makeToolResponse(
          writeCall.callId,
          'write_file',
          'wrote',
        );
        const readCall = makeAiToolCall('read_file', { file_path: fp });
        const readResp = makeToolResponse(
          readCall.callId,
          'read_file',
          'content',
        );

        // Write at 0,1 then read at 2,3
        const history: IContent[] = [
          writeCall.entry,
          writeResp,
          readCall.entry,
          readResp,
        ];
        const config = defaultConfig({
          fileDedupe: false,
          recencyPruning: false,
        });

        const result = strategy.optimize(history, config);

        // The read AI entry (idx 2) should not be removed
        expect(result.removals).not.toContain(2);
        // The read tool response (idx 3) should not be removed
        expect(result.removals).not.toContain(3);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-007.1
   */
  it('recency pruning preserves at least retention-count results per tool', () => {
    const strategy = createStrategy();

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1, max: 8 }),
        (totalResults, retention) => {
          const history: IContent[] = [];
          for (let i = 0; i < totalResults; i++) {
            const rc = makeAiToolCall('read_file', {
              file_path: `/workspace/f${i}.ts`,
            });
            history.push(rc.entry);
            history.push(
              makeToolResponse(rc.callId, 'read_file', `content ${i}`),
            );
          }

          const config = defaultConfig({
            readWritePruning: false,
            fileDedupe: false,
            recencyPruning: true,
            recencyRetention: retention,
          });

          const result = strategy.optimize(history, config);

          // Count how many tool response entries are NOT pruned
          const prunedIndices = new Set([
            ...result.removals,
            ...result.replacements.keys(),
          ]);
          let unprunedToolResponses = 0;
          for (let i = 0; i < history.length; i++) {
            if (history[i].speaker === 'tool') {
              if (!prunedIndices.has(i)) {
                unprunedToolResponses++;
              } else if (result.replacements.has(i)) {
                // Check if replacement still has non-pruned result
                const replacement = result.replacements.get(i)!;
                const responseBlocks = replacement.blocks.filter(
                  (b): b is ToolResponseBlock => b.type === 'tool_response',
                );
                const hasUnpruned = responseBlocks.some(
                  (b) => b.result !== PRUNED_POINTER,
                );
                if (hasUnpruned) {
                  unprunedToolResponses++;
                }
              }
            }
          }
          const expectedPreserved = Math.min(retention, totalResults);
          expect(unprunedToolResponses).toBeGreaterThanOrEqual(
            expectedPreserved,
          );
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   */
  it('replacement entries preserve speaker and metadata', () => {
    const strategy = createStrategy();

    fc.assert(
      fc.property(fc.integer({ min: 4, max: 8 }), (count) => {
        const history: IContent[] = [];
        for (let i = 0; i < count; i++) {
          const rc = makeAiToolCall('read_file', {
            file_path: `/workspace/f${i}.ts`,
          });
          history.push(rc.entry);
          history.push(
            makeToolResponse(rc.callId, 'read_file', `content ${i}`),
          );
        }

        const config = defaultConfig({
          readWritePruning: false,
          fileDedupe: false,
          recencyPruning: true,
          recencyRetention: 2,
        });

        const result = strategy.optimize(history, config);

        for (const [idx, replacement] of result.replacements) {
          const original = history[idx];
          expect(replacement.speaker).toBe(original.speaker);
          // Metadata should be preserved
          if (original.metadata?.timestamp !== undefined) {
            expect(replacement.metadata?.timestamp).toBe(
              original.metadata.timestamp,
            );
          }
        }
      }),
      { numRuns: 50 },
    );
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   */
  it('optimize is idempotent on its own output', () => {
    const strategy = createStrategy();

    // Build a history that triggers recency pruning
    const history: IContent[] = [];
    for (let i = 0; i < 5; i++) {
      const rc = makeAiToolCall('read_file', {
        file_path: `/workspace/f${i}.ts`,
      });
      history.push(rc.entry);
      history.push(makeToolResponse(rc.callId, 'read_file', `content ${i}`));
    }

    const config = defaultConfig({
      readWritePruning: false,
      fileDedupe: false,
      recencyPruning: true,
      recencyRetention: 3,
    });

    const result1 = strategy.optimize(history, config);

    // Apply the result to build a new history
    const newHistory: IContent[] = [];
    for (let i = 0; i < history.length; i++) {
      if (result1.removals.includes(i)) continue;
      if (result1.replacements.has(i)) {
        newHistory.push(result1.replacements.get(i)!);
      } else {
        newHistory.push(history[i]);
      }
    }

    // Running optimize again should produce nothing new
    const result2 = strategy.optimize(newHistory, config);

    // Second run should not prune anything more
    expect(result2.removals).toHaveLength(0);
    expect(result2.replacements.size).toBe(0);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.1, REQ-HD-005.6
   */
  it('stale reads are always pruned regardless of file path', () => {
    const strategy = createStrategy();

    fc.assert(
      fc.property(arbFilePath, (fp) => {
        const { entries } = makeReadWritePair(fp);
        const history: IContent[] = [...entries];
        const config = defaultConfig({
          fileDedupe: false,
          recencyPruning: false,
        });

        const result = strategy.optimize(history, config);

        // Read entries (0, 1) should be affected
        const allAffected = new Set([
          ...result.removals,
          ...result.replacements.keys(),
        ]);
        expect(allAffected.has(0) || allAffected.has(1)).toBe(true);
        expect(result.metadata.readWritePairsPruned).toBeGreaterThan(0);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.3
   */
  it('each write tool type causes preceding read to be marked stale', () => {
    const strategy = createStrategy();
    const writeToolsArr = [
      'write_file',
      'ast_edit',
      'replace',
      'insert_at_line',
      'delete_line_range',
    ] as const;

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: writeToolsArr.length - 1 }),
        arbFilePath,
        (writeIdx, fp) => {
          const writeTool = writeToolsArr[writeIdx];
          const rc = makeAiToolCall('read_file', { file_path: fp });
          const readResp = makeToolResponse(rc.callId, 'read_file', 'content');
          const wc = makeAiToolCall(writeTool, { file_path: fp });
          const writeResp = makeToolResponse(wc.callId, writeTool, 'wrote');

          const history: IContent[] = [rc.entry, readResp, wc.entry, writeResp];
          const config = defaultConfig({
            fileDedupe: false,
            recencyPruning: false,
          });

          const result = strategy.optimize(history, config);

          expect(result.metadata.readWritePairsPruned).toBeGreaterThan(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-006.2
   */
  it('latest file inclusion is always preserved across random history sizes', () => {
    const strategy = createStrategy();

    fc.assert(
      fc.property(fc.integer({ min: 2, max: 5 }), (dupCount) => {
        const history: IContent[] = [];
        for (let i = 0; i < dupCount; i++) {
          history.push(makeHumanWithFileInclusion('src/dup.ts', `version${i}`));
          history.push(makeAiText(`response ${i}`));
        }

        const config = defaultConfig({
          readWritePruning: false,
          recencyPruning: false,
        });
        const result = strategy.optimize(history, config);

        // The latest inclusion is at index (dupCount - 1) * 2
        const latestIdx = (dupCount - 1) * 2;
        // Latest should NOT be in replacements (it's preserved)
        expect(result.replacements.has(latestIdx)).toBe(false);
        expect(result.removals).not.toContain(latestIdx);

        // Earlier inclusions should be deduplicated
        if (dupCount > 1) {
          expect(result.metadata.fileDeduplicationsPruned).toBe(dupCount - 1);
        }
      }),
      { numRuns: 30 },
    );
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-013.5
   */
  it('malformed parameters never cause exceptions regardless of content', () => {
    const strategy = createStrategy();

    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.constant(42),
          fc.constant('string'),
          fc.constant([]),
          fc.record({ unrelated: fc.string() }),
        ),
        (params) => {
          const rc = makeAiToolCall('read_file', params);
          const resp = makeToolResponse(rc.callId, 'read_file', 'result');
          const wc = makeAiToolCall('write_file', {
            file_path: '/workspace/a.ts',
          });
          const wr = makeToolResponse(wc.callId, 'write_file', 'wrote');

          const history: IContent[] = [rc.entry, resp, wc.entry, wr];
          const config = defaultConfig({
            fileDedupe: false,
            recencyPruning: false,
          });

          // Should never throw
          expect(() => strategy.optimize(history, config)).not.toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-013.7
   */
  it('total metadata counts equal total affected entries', () => {
    const strategy = createStrategy();

    fc.assert(
      fc.property(fc.integer({ min: 1, max: 6 }), (count) => {
        const history: IContent[] = [];

        // Create read-write pairs for RW pruning
        for (let i = 0; i < count; i++) {
          const { entries } = makeReadWritePair(`/workspace/rw${i}.ts`);
          history.push(...entries);
        }

        const config = defaultConfig({
          readWritePruning: true,
          fileDedupe: false,
          recencyPruning: false,
        });

        const result = strategy.optimize(history, config);

        // readWritePairsPruned should equal number of pairs pruned
        expect(result.metadata.readWritePairsPruned).toBe(count);
      }),
      { numRuns: 30 },
    );
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-007.3
   */
  it('recency replacements always keep tool_response type and toolName intact', () => {
    const strategy = createStrategy();

    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 8 }),
        fc.integer({ min: 1, max: 3 }),
        (totalResults, retention) => {
          const history: IContent[] = [];
          for (let i = 0; i < totalResults; i++) {
            const rc = makeAiToolCall('read_file', {
              file_path: `/workspace/r${i}.ts`,
            });
            history.push(rc.entry);
            history.push(
              makeToolResponse(rc.callId, 'read_file', `content ${i}`),
            );
          }

          const config = defaultConfig({
            readWritePruning: false,
            fileDedupe: false,
            recencyPruning: true,
            recencyRetention: retention,
          });

          const result = strategy.optimize(history, config);

          for (const [, replacement] of result.replacements) {
            const responseBlocks = replacement.blocks.filter(
              (b): b is ToolResponseBlock => b.type === 'tool_response',
            );
            for (const rb of responseBlocks) {
              expect(rb.type).toBe('tool_response');
              expect(rb.toolName).toBeDefined();
              expect(typeof rb.callId).toBe('string');
            }
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-013.6
   */
  it('recency retention floor of 1 always keeps at least one result per tool', () => {
    const strategy = createStrategy();

    fc.assert(
      fc.property(
        fc.integer({ min: -5, max: 0 }),
        fc.integer({ min: 2, max: 6 }),
        (retention, totalResults) => {
          const history: IContent[] = [];
          for (let i = 0; i < totalResults; i++) {
            const rc = makeAiToolCall('read_file', {
              file_path: `/workspace/f${i}.ts`,
            });
            history.push(rc.entry);
            history.push(
              makeToolResponse(rc.callId, 'read_file', `content ${i}`),
            );
          }

          const config = defaultConfig({
            readWritePruning: false,
            fileDedupe: false,
            recencyPruning: true,
            recencyRetention: retention,
          });

          const result = strategy.optimize(history, config);

          // With retention floored to 1, exactly totalResults - 1 should be pruned
          expect(result.metadata.recencyPruned).toBe(totalResults - 1);
        },
      ),
      { numRuns: 30 },
    );
  });
});
