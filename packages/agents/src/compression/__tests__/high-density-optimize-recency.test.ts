/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P10
 * @requirement REQ-HD-007.1, REQ-HD-007.2, REQ-HD-007.3, REQ-HD-007.4,
 *              REQ-HD-007.6, REQ-HD-013.6
 *
 * Behavioral tests for the HighDensityStrategy.optimize() recency
 * pruning sub-phase.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  IContent,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createStrategy,
  defaultConfig,
  getPrunedToolResponses,
  makeAiToolCall,
  makeToolResponse,
  nextCallId,
  resetCallIds,
} from './high-density-optimize-helpers.js';

describe('pruneByRecency @plan PLAN-20260211-HIGHDENSITY.P10', () => {
  beforeEach(() => resetCallIds());

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-007.1, REQ-HD-007.2
   */
  it('old tool results beyond retention are replaced with pointer', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

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

    expect(result.metadata.recencyPruned).toBe(2);

    // Collect all pruned entry indices; they must all be from the oldest entries
    for (const [idx, replacement] of result.replacements) {
      const prunedBlocks = getPrunedToolResponses(replacement);
      for (const _block of prunedBlocks) {
        expect(idx).toBeLessThanOrEqual(3);
      }
    }
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-007.1
   */
  it('per-tool-name counting', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

    for (let i = 0; i < 4; i++) {
      const rc = makeAiToolCall('read_file', {
        file_path: `/workspace/read${i}.ts`,
      });
      history.push(rc.entry);
      history.push(
        makeToolResponse(rc.callId, 'read_file', `read content ${i}`),
      );
    }

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

    expect(result.metadata.recencyPruned).toBe(2);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-007.3
   */
  it('structure preservation — only result field changes', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

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
          } as unknown as ToolResponseBlock,
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
      }
      // Pruned blocks must preserve structure (only result changed)
      const prunedBlocks = getPrunedToolResponses(replacement);
      for (const pb of prunedBlocks) {
        expect(pb.isComplete).toBe(true);
      }
    }
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-007.6
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

    expect(result.metadata.recencyPruned).toBe(2);
  });
});
