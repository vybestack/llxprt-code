/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the issue-2852 multi-metric plateau verdict and
 * reasoning-mode target (issue #3114, REQ-3114-3).
 *
 * The plateau verdict must require JSC heap, process.memoryUsage().external,
 * and dirty WebKit Malloc to each plateau independently — the overall verdict
 * passes only when every required metric plateaus. The reasoning target must
 * stream full-so-far thinking updates through the real StreamOutputAccumulator
 * and verify each materialized result is one complete block.
 *
 * These tests exercise the real parsing and plateau logic; no component is
 * mocked.
 */

import { describe, it, expect } from 'bun:test';
import {
  evaluateMultiMetricPlateau,
  parsePostGcRecords,
  type PostGcMetrics,
} from '../issue-2852-memory-benchmark.js';
import { StreamOutputAccumulator } from '../../packages/agents/src/core/streamOutputAccumulator.js';
import type { ModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';

function metrics(overrides: Partial<PostGcMetrics> = {}): PostGcMetrics {
  return {
    jscHeapBytes: 50_000_000,
    externalBytes: 10_000_000,
    webkitMallocDirtyBytes: 5_000_000,
    ...overrides,
  };
}

describe('multi-metric post-GC plateau verdict (issue #3114)', () => {
  describe('evaluateMultiMetricPlateau', () => {
    it('passes when all required metrics plateau', () => {
      const result = evaluateMultiMetricPlateau(
        [
          metrics({ jscHeapBytes: 40_000_000, externalBytes: 8_000_000 }),
          metrics(),
          metrics({ jscHeapBytes: 50_500_000, externalBytes: 10_300_000 }),
          metrics({ jscHeapBytes: 50_200_000, externalBytes: 10_100_000 }),
        ],
        0.1,
      );
      expect(result.overallWithinTolerance).toBe(true);
      expect(result.metrics.every((m) => m.withinTolerance)).toBe(true);
    });

    it('fails when JSC heap grows beyond tolerance even if other metrics plateau', () => {
      const result = evaluateMultiMetricPlateau(
        [
          metrics({ jscHeapBytes: 40_000_000 }),
          metrics({ jscHeapBytes: 50_000_000 }),
          metrics({ jscHeapBytes: 60_000_000 }),
          metrics({ jscHeapBytes: 70_000_000 }),
        ],
        0.1,
      );
      expect(result.overallWithinTolerance).toBe(false);
      const heap = result.metrics.find((m) => m.name === 'jscHeap');
      expect(heap?.withinTolerance).toBe(false);
    });

    it('fails when external grows beyond tolerance even if heap plateaus', () => {
      const result = evaluateMultiMetricPlateau(
        [
          metrics({ externalBytes: 8_000_000 }),
          metrics({ externalBytes: 10_000_000 }),
          metrics({ externalBytes: 15_000_000 }),
          metrics({ externalBytes: 20_000_000 }),
        ],
        0.1,
      );
      expect(result.overallWithinTolerance).toBe(false);
      const external = result.metrics.find((m) => m.name === 'external');
      expect(external?.withinTolerance).toBe(false);
    });

    it('fails when dirty WebKit Malloc grows beyond tolerance', () => {
      const result = evaluateMultiMetricPlateau(
        [
          metrics({ webkitMallocDirtyBytes: 4_000_000 }),
          metrics({ webkitMallocDirtyBytes: 5_000_000 }),
          metrics({ webkitMallocDirtyBytes: 8_000_000 }),
          metrics({ webkitMallocDirtyBytes: 12_000_000 }),
        ],
        0.1,
      );
      expect(result.overallWithinTolerance).toBe(false);
      const webkit = result.metrics.find((m) => m.name === 'webkitMallocDirty');
      expect(webkit?.withinTolerance).toBe(false);
    });

    it('fails when any single metric out of three grows', () => {
      const result = evaluateMultiMetricPlateau(
        [metrics(), metrics(), metrics({ webkitMallocDirtyBytes: 8_000_000 })],
        0.1,
      );
      expect(result.overallWithinTolerance).toBe(false);
    });

    it('requires at least three post-GC turns', () => {
      expect(() =>
        evaluateMultiMetricPlateau([metrics(), metrics()], 0.1),
      ).toThrow('at least three');
    });

    it('reports per-metric settled baseline and growth ratio', () => {
      const result = evaluateMultiMetricPlateau(
        [
          metrics({ jscHeapBytes: 40_000_000 }),
          metrics({ jscHeapBytes: 50_000_000 }),
          metrics({ jscHeapBytes: 55_000_000 }),
        ],
        0.05,
      );
      const heap = result.metrics.find((m) => m.name === 'jscHeap');
      expect(heap?.settledBaselineBytes).toBe(50_000_000);
      expect(heap?.maxBytes).toBe(55_000_000);
      expect(heap?.growthRatio).toBeCloseTo(0.1, 10);
      expect(heap?.withinTolerance).toBe(false);
    });
  });

  describe('parsePostGcRecords', () => {
    it('keeps only post-GC records and drops blank and whitespace-only lines', () => {
      const contents = [
        JSON.stringify({ name: 'turn-1-pre-gc', jsc: { heapSize: 1 } }),
        '',
        '   ',
        '\t',
        JSON.stringify({ name: 'turn-1-post-gc', jsc: { heapSize: 2 } }),
        '',
      ].join('\n');

      const records = parsePostGcRecords('/tmp/target.jsonl', contents);

      expect(records).toHaveLength(1);
      expect(records[0].name).toBe('turn-1-post-gc');
      expect(records[0].jsc?.heapSize).toBe(2);
    });

    it('names the malformed line as it appears in the file, counting blank lines', () => {
      // The bad record sits on physical line 4. Counting only non-blank lines
      // would misreport it as line 2 and send a reader to the wrong place.
      const contents = [
        JSON.stringify({ name: 'turn-1-post-gc', jsc: { heapSize: 1 } }),
        '',
        '',
        '{ not valid json',
      ].join('\n');

      expect(() => parsePostGcRecords('/tmp/target.jsonl', contents)).toThrow(
        /\/tmp\/target\.jsonl line 4 is not valid JSON/,
      );
    });

    it('fails rather than skipping a corrupt record', () => {
      const contents = [
        JSON.stringify({ name: 'turn-1-post-gc', jsc: { heapSize: 1 } }),
        'truncated',
      ].join('\n');

      expect(() => parsePostGcRecords('/tmp/target.jsonl', contents)).toThrow();
    });
  });
});

const REASONING_STEP_PREFIX = 'step '.repeat(20);

/**
 * Drives the real StreamOutputAccumulator the way the reasoning-mode target
 * does: each delta carries a complete prefix of one deterministic final
 * reasoning string, closed by a complete block carrying that exact full final
 * string plus signature. Proves the accumulator collapses each span to one
 * block with the final complete text — the retention contract the target
 * depends on.
 */
describe('reasoning target accumulator path (issue #3114)', () => {
  function chunk(
    blocks: ModelStreamChunk['content']['blocks'],
  ): ModelStreamChunk {
    return { content: { speaker: 'ai', blocks } };
  }

  function thinking(partial: {
    thought: string;
    streamId: string;
    streamStatus: 'delta' | 'complete';
    signature?: string;
  }): ThinkingBlock {
    return { type: 'thinking', sourceField: 'thinking', ...partial };
  }

  function buildFinalThought(turn: number): string {
    const filler = REASONING_STEP_PREFIX.repeat(
      Math.ceil(3000 / REASONING_STEP_PREFIX.length),
    );
    return `turn ${turn} final complete reasoning
${filler}`.slice(0, 3000);
  }

  it('produces exactly one complete thinking block with the exact full final thought', () => {
    const streamId = 'reasoning-span-0';
    const accumulator = new StreamOutputAccumulator();
    const finalThought = buildFinalThought(0);
    const signature = 'sig-final';
    const deltaCount = 50;
    const stepSize = Math.ceil(finalThought.length / deltaCount);
    for (let i = 1; i <= deltaCount; i++) {
      accumulator.add(
        chunk([
          thinking({
            thought: finalThought.slice(0, stepSize * i),
            streamId,
            streamStatus: 'delta',
          }),
        ]),
      );
    }
    accumulator.add(
      chunk([
        thinking({
          thought: finalThought,
          streamId,
          streamStatus: 'complete',
          signature,
        }),
      ]),
    );

    const output = accumulator.materialize();
    const thinkingBlocks = output.content.blocks.filter(
      (b): b is ThinkingBlock => b.type === 'thinking',
    );
    expect(thinkingBlocks).toHaveLength(1);
    expect(thinkingBlocks[0].thought).toBe(finalThought);
    expect(thinkingBlocks[0].streamStatus).toBe('complete');
    expect(thinkingBlocks[0].streamId).toBe(streamId);
    expect(thinkingBlocks[0].signature).toBe(signature);
  });
});
