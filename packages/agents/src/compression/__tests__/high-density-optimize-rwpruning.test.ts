/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P10
 * @requirement REQ-HD-005.1, REQ-HD-005.2, REQ-HD-005.3, REQ-HD-005.4,
 *              REQ-HD-005.5, REQ-HD-005.6, REQ-HD-005.7, REQ-HD-005.8,
 *              REQ-HD-005.9, REQ-HD-005.10, REQ-HD-005.11, REQ-HD-013.5
 *
 * Behavioral tests for the HighDensityStrategy.optimize() read→write
 * pruning sub-phase.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  IContent,
  ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  allAffectedIndices,
  createStrategy,
  defaultConfig,
  makeAiToolCall,
  makeReadWritePair,
  makeToolResponse,
  nextCallId,
  resetCallIds,
} from './high-density-optimize-helpers.js';

describe('pruneReadWritePairs @plan PLAN-20260211-HIGHDENSITY.P10', () => {
  beforeEach(() => resetCallIds());

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.1, REQ-HD-005.6
   */
  it('stale read is removed when a later write exists for the same file', () => {
    const strategy = createStrategy();
    const { entries } = makeReadWritePair('/workspace/src/a.ts');
    const history: IContent[] = [...entries];
    const config = defaultConfig({ fileDedupe: false, recencyPruning: false });

    const result = strategy.optimize(history, config);

    const affected = allAffectedIndices(result);
    expect(affected.has(0) || affected.has(1)).toBe(true);
    expect(result.removals).not.toContain(2);
    expect(result.removals).not.toContain(3);
    expect(result.replacements.has(2)).toBe(false);
    expect(result.replacements.has(3)).toBe(false);
    expect(result.metadata.readWritePairsPruned).toBeGreaterThan(0);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.7
   */
  it('post-write read is preserved', () => {
    const strategy = createStrategy();
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

    expect(result.removals).not.toContain(2);
    expect(result.removals).not.toContain(3);
    expect(result.replacements.has(2)).toBe(false);
    expect(result.replacements.has(3)).toBe(false);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.2
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

    for (const readTool of readTools) {
      const filePath = `/workspace/src/${readTool}.ts`;
      const params =
        readTool === 'read_many_files'
          ? { paths: [filePath] }
          : { file_path: filePath };
      const rc = makeAiToolCall(readTool, params);
      history.push(rc.entry);
      history.push(
        makeToolResponse(rc.callId, readTool, `content of ${filePath}`),
      );
    }

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

    expect(result.metadata.readWritePairsPruned).toBeGreaterThanOrEqual(4);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.3
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
      const rc = makeAiToolCall('read_file', { file_path: filePath });
      history.push(rc.entry);
      history.push(
        makeToolResponse(rc.callId, 'read_file', `content of ${filePath}`),
      );
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
   */
  it('file_path, absolute_path, and path keys all extract correctly', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

    const rc1 = makeAiToolCall('read_file', { file_path: '/workspace/a.ts' });
    history.push(rc1.entry);
    history.push(makeToolResponse(rc1.callId, 'read_file', 'content a'));

    const rc2 = makeAiToolCall('read_file', {
      absolute_path: '/workspace/b.ts',
    });
    history.push(rc2.entry);
    history.push(makeToolResponse(rc2.callId, 'read_file', 'content b'));

    const rc3 = makeAiToolCall('read_file', { path: '/workspace/c.ts' });
    history.push(rc3.entry);
    history.push(makeToolResponse(rc3.callId, 'read_file', 'content c'));

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
   */
  it('paths are normalized via path.resolve before comparison', () => {
    const strategy = createStrategy();

    const rc = makeAiToolCall('read_file', { file_path: 'src/../src/foo.ts' });
    const readResp = makeToolResponse(rc.callId, 'read_file', 'content');

    const wc = makeAiToolCall('write_file', { file_path: 'src/foo.ts' });
    const writeResp = makeToolResponse(wc.callId, 'write_file', 'wrote');

    const history: IContent[] = [rc.entry, readResp, wc.entry, writeResp];
    const config = defaultConfig({
      fileDedupe: false,
      recencyPruning: false,
      workspaceRoot: '/workspace',
    });

    const result = strategy.optimize(history, config);

    expect(result.metadata.readWritePairsPruned).toBeGreaterThan(0);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.8
   */
  it('block-level granularity preserves non-stale tool calls in same AI entry', () => {
    const strategy = createStrategy();

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

    const affected = allAffectedIndices(result);
    expect(affected.has(0) || affected.has(1)).toBe(true);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.9
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

    const wc = makeAiToolCall('write_file', {
      file_path: '/workspace/src/foo.ts',
    });
    const wr = makeToolResponse(wc.callId, 'write_file', 'wrote foo');

    const history: IContent[] = [readCall.entry, readResp, wc.entry, wr];
    const config = defaultConfig({ fileDedupe: false, recencyPruning: false });

    const result = strategy.optimize(history, config);

    expect(result.removals).not.toContain(0);
    expect(result.removals).not.toContain(1);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.10
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
   */
  it('malformed tool parameters are skipped without throwing', () => {
    const strategy = createStrategy();

    const rc1 = makeAiToolCall('read_file', null);
    const resp1 = makeToolResponse(rc1.callId, 'read_file', 'some result');

    const rc2 = makeAiToolCall('read_file', { unrelated: true });
    const resp2 = makeToolResponse(rc2.callId, 'read_file', 'another result');

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

    expect(() => strategy.optimize(history, config)).not.toThrow();
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-005.11
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

    expect(result.metadata.readWritePairsPruned).toBeGreaterThan(0);
  });
});
