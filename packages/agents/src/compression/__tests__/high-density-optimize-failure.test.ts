/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P10
 * @requirement REQ-HD-013.1, REQ-HD-013.2, REQ-HD-013.3, REQ-HD-013.4
 *
 * Behavioral tests for the HighDensityStrategy.optimize() failure modes
 * and graceful degradation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createStrategy,
  defaultConfig,
  makeAiText,
  makeAiToolCall,
  makeHumanMessage,
  makeReadWritePair,
  makeToolResponse,
  resetCallIds,
} from './high-density-optimize-helpers.js';

describe('Failure modes @plan PLAN-20260211-HIGHDENSITY.P10', () => {
  beforeEach(() => resetCallIds());

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-013.1
   */
  it('optimize gracefully degrades on unexpected tool structure', () => {
    const strategy = createStrategy();

    const malformed: IContent = {
      speaker: 'ai',
      blocks: [],
      metadata: { timestamp: Date.now() },
    };

    const { entries } = makeReadWritePair('/workspace/a.ts');

    const history: IContent[] = [malformed, ...entries];
    const config = defaultConfig({ fileDedupe: false, recencyPruning: false });

    expect(() => strategy.optimize(history, config)).not.toThrow();
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-013.2
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
   * @requirement REQ-HD-007.1
   */
  it('nonmatching read-write and dedupe passes do not block recency pruning', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

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

    const result = strategy.optimize(history, config);

    expect(result.metadata.readWritePairsPruned).toBe(0);
    expect(result.metadata.fileDeduplicationsPruned).toBe(0);
    expect(result.metadata.recencyPruned).toBe(2);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-013.4
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
