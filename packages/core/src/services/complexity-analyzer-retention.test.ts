/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { retainedAfterSettling } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import {
  ComplexityAnalyzer,
  type ComplexityAnalysisResult,
} from './complexity-analyzer.js';

function analyzeAndRelease(analyzer: ComplexityAnalyzer): {
  readonly refs: ReadonlyArray<WeakRef<ComplexityAnalysisResult>>;
  readonly average: number;
} {
  const results = [
    '',
    'Hello',
    '- Build the project\n- Run the tests\n- Deploy the release',
  ].map((text) => analyzer.analyzeComplexity(text));
  return {
    refs: results.map((result) => new WeakRef(result)),
    average:
      results.reduce((total, result) => total + result.complexityScore, 0) /
      results.length,
  };
}

describe('complexity analysis statistics ownership', () => {
  it('releases returned analyses while retaining aggregate statistics', async (): Promise<void> => {
    const analyzer = new ComplexityAnalyzer({ complexityThreshold: 0 });
    const observed = analyzeAndRelease(analyzer);
    expect(await retainedAfterSettling(observed.refs)).toBe(0);
    expect(analyzer.getAnalysisStats()).toStrictEqual({
      totalAnalyses: 3,
      complexRequestCount: 2,
      suggestionsGenerated: 1,
      averageComplexityScore: observed.average,
    });
  });

  it('resets aggregates and counts subsequent analyses independently', (): void => {
    const analyzer = new ComplexityAnalyzer();
    analyzeAndRelease(analyzer);
    analyzer.reset();
    expect(analyzer.getAnalysisStats()).toStrictEqual({
      totalAnalyses: 0,
      complexRequestCount: 0,
      suggestionsGenerated: 0,
      averageComplexityScore: 0,
    });
    analyzer.analyzeComplexity('');
    expect(analyzer.getAnalysisStats()).toStrictEqual({
      totalAnalyses: 1,
      complexRequestCount: 0,
      suggestionsGenerated: 0,
      averageComplexityScore: 0,
    });
  });
});
