/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P10
 * @requirement REQ-HD-001.6, REQ-HD-001.7, REQ-HD-001.8, REQ-HD-005.1,
 *              REQ-HD-005.3, REQ-HD-005.6, REQ-HD-005.7, REQ-HD-006.2,
 *              REQ-HD-007.1, REQ-HD-007.3, REQ-HD-013.5, REQ-HD-013.6,
 *              REQ-HD-013.7
 *
 * Property-based tests for HighDensityStrategy.optimize().
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import type {
  IContent,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  allAffectedIndices,
  countUnprunedAtIndex,
  createStrategy,
  defaultConfig,
  makeAiText,
  makeAiToolCall,
  makeHumanMessage,
  makeHumanWithFileInclusion,
  makeReadWritePair,
  makeToolResponse,
  resetCallIds,
} from './high-density-optimize-helpers.js';

describe('Property-based tests @plan PLAN-20260211-HIGHDENSITY.P10', () => {
  beforeEach(() => resetCallIds());

  const arbFilePath = fc.stringMatching(/^\/workspace\/src\/[a-z]{1,8}\.ts$/);

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

        expect(result.removals).not.toContain(2);
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

          const prunedIndices = new Set([
            ...result.removals,
            ...result.replacements.keys(),
          ]);
          let unprunedToolResponses = 0;
          for (let i = 0; i < history.length; i++) {
            if (history[i].speaker !== 'tool') {
              continue;
            }
            unprunedToolResponses += countUnprunedAtIndex(
              i,
              prunedIndices,
              result,
            );
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

          const originalTs = original.metadata?.timestamp;
          const replacementTs = replacement.metadata?.timestamp;
          // Metadata should be preserved when it was present
          expect(replacementTs).toBe(originalTs);
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

    const newHistory: IContent[] = [];
    for (let i = 0; i < history.length; i++) {
      if (result1.removals.includes(i)) continue;
      if (result1.replacements.has(i)) {
        newHistory.push(result1.replacements.get(i)!);
      } else {
        newHistory.push(history[i]);
      }
    }

    const result2 = strategy.optimize(newHistory, config);

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

        const affected = allAffectedIndices(result);
        expect(affected.has(0) || affected.has(1)).toBe(true);
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

        const latestIdx = (dupCount - 1) * 2;
        expect(result.replacements.has(latestIdx)).toBe(false);
        expect(result.removals).not.toContain(latestIdx);

        // dupCount is always >= 2 (min from arb), so earlier inclusions
        // are always deduplicated
        expect(result.metadata.fileDeduplicationsPruned).toBe(dupCount - 1);
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

          expect(result.metadata.recencyPruned).toBe(totalResults - 1);
        },
      ),
      { numRuns: 30 },
    );
  });
});
