/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P10
 * @requirement REQ-HD-006.1, REQ-HD-006.2, REQ-HD-006.3, REQ-HD-006.4,
 *              REQ-HD-006.5
 *
 * Behavioral tests for the HighDensityStrategy.optimize() file-inclusion
 * deduplication sub-phase.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  createStrategy,
  defaultConfig,
  makeAiText,
  makeHumanMessage,
  makeHumanWithFileInclusion,
  resetCallIds,
} from './high-density-optimize-helpers.js';

describe('deduplicateFileInclusions @plan PLAN-20260211-HIGHDENSITY.P10', () => {
  beforeEach(() => resetCallIds());

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-006.1, REQ-HD-006.2
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

    expect(result.replacements.has(2)).toBe(true);
    const replaced = result.replacements.get(2)!;
    const textBlocks = replaced.blocks.filter((b) => b.type === 'text');
    for (const tb of textBlocks) {
      expect(tb.text).not.toContain('version1');
    }
    expect(result.replacements.has(5)).toBe(false);
    expect(result.metadata.fileDeduplicationsPruned).toBeGreaterThan(0);
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-006.3
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

    expect(result.replacements.has(0)).toBe(true);
    expect(result.removals).not.toContain(0);

    const replaced = result.replacements.get(0)!;
    const textContent = replaced.blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    expect(textContent).toContain('Fix this:');
  });

  /**
   * @plan PLAN-20260211-HIGHDENSITY.P10
   * @requirement REQ-HD-006.4
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
   */
  it('unpaired delimiters leave text unchanged', () => {
    const strategy = createStrategy();
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

    expect(result.metadata.fileDeduplicationsPruned).toBe(0);
    expect(result.removals).not.toContain(0);
    expect(result.replacements.has(0)).toBe(false);
    expect(history[0]).toStrictEqual(brokenInclusion);
  });
});
