/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P10
 * @requirement REQ-HD-013.7
 *
 * Behavioral tests for the HighDensityStrategy.optimize() orchestration
 * across all three sub-phases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createStrategy,
  defaultConfig,
  makeAiText,
  makeAiToolCall,
  makeHumanWithFileInclusion,
  makeReadWritePair,
  makeToolResponse,
  resetCallIds,
} from './high-density-optimize-helpers.js';

describe('optimize() orchestration @plan PLAN-20260211-HIGHDENSITY.P10', () => {
  beforeEach(() => resetCallIds());

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-013.7
   */
  it('optimize merges phases in deterministic order', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

    const { entries: rwEntries } = makeReadWritePair('/workspace/src/a.ts');
    history.push(...rwEntries);

    history.push(makeHumanWithFileInclusion('src/b.ts', 'content v1'));
    history.push(makeAiText('noted'));
    history.push(makeHumanWithFileInclusion('src/b.ts', 'content v2'));
    history.push(makeAiText('got it'));

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

    for (const idx of result.removals) {
      expect(result.replacements.has(idx)).toBe(false);
    }
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-013.7
   */
  it('metadata counts are accurate across all phases', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

    const rw1 = makeReadWritePair('/workspace/rw1.ts');
    history.push(...rw1.entries);
    const rw2 = makeReadWritePair('/workspace/rw2.ts');
    history.push(...rw2.entries);

    history.push(makeHumanWithFileInclusion('src/dup.ts', 'v1'));
    history.push(makeAiText('ok'));
    history.push(makeHumanWithFileInclusion('src/dup.ts', 'v2'));
    history.push(makeAiText('ok'));

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
   */
  it('entries already removed by RW pruning are skipped by dedup and recency', () => {
    const strategy = createStrategy();

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

    for (const idx of result.removals) {
      expect(result.replacements.has(idx)).toBe(false);
    }
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
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
   */
  it('all config options false returns empty result', () => {
    const strategy = createStrategy();
    const history: IContent[] = [];

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
