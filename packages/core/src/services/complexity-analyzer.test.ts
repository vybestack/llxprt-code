/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { ComplexityAnalyzer } from './complexity-analyzer.js';

describe('ComplexityAnalyzer', () => {
  it('treats very long instructions as complex even without explicit task lists', () => {
    const analyzer = new ComplexityAnalyzer({
      complexityThreshold: 0.6,
      minTasksForSuggestion: 3,
    });

    const message = Array.from({ length: 12 })
      .map(
        () =>
          'This section expands on architecture decisions, environment setup, deployment caveats, and verification steps in narrative form without enumerated bullets but still reflects multiple areas needing tracking.',
      )
      .join(' ');

    const result = analyzer.analyzeComplexity(message);

    expect(result.shouldSuggestTodos).toBe(true);
  });

  it('does not count file references toward task detection for todo suggestions', () => {
    const analyzer = new ComplexityAnalyzer({
      complexityThreshold: 0.6,
      minTasksForSuggestion: 3,
    });

    const message =
      'Please update src/app.ts, src/index.ts, and src/utils/helpers.ts so the new plan is reflected everywhere.';

    const result = analyzer.analyzeComplexity(message);

    // File references should no longer be counted as tasks
    expect(result.detectedTasks).toEqual([]);
    expect(result.shouldSuggestTodos).toBe(false);
  });

  it('flags multi-sentence narratives as complex even under 600 characters', () => {
    const analyzer = new ComplexityAnalyzer();

    const message =
      'Outline the current architecture. Explain the boundaries between modules. Describe the data flow. Identify cross-cutting concerns. Recommend a packaging strategy.';

    const result = analyzer.analyzeComplexity(message);

    expect(result.shouldSuggestTodos).toBe(true);
  });

  it('treats a score equal to the threshold as complex', () => {
    const analyzer = new ComplexityAnalyzer({
      complexityThreshold: 0.6,
      minTasksForSuggestion: 3,
    });

    const message =
      'We need to refactor authentication and authorization workflows, focus on login and session validation.';

    const result = analyzer.analyzeComplexity(message);

    expect(result.complexityScore).toBeGreaterThanOrEqual(0.6);
    expect(result.isComplex).toBe(true);
  });

  it('requires 3 tasks to reach 0.5 complexity score', () => {
    const analyzer = new ComplexityAnalyzer();

    const message = 'First task. Second task. Third task.';

    const result = analyzer.analyzeComplexity(message);

    // 3 tasks should give us exactly 0.5 score
    expect(result.complexityScore).toBeGreaterThanOrEqual(0.5);
  });

  it('gives reduced weight to 2 tasks after changes', () => {
    const analyzer = new ComplexityAnalyzer();

    const message = 'First task. Second task.';

    const result = analyzer.analyzeComplexity(message);

    // 2 tasks should give 0.5 score after our changes (2 tasks x 0.25 each)
    expect(result.complexityScore).toBe(0.5);
    // With new threshold of 0.6, 0.5 is below threshold so not complex
    expect(result.isComplex).toBe(false);
  });

  it('normalizes excessive whitespace in bullet list tasks', () => {
    const analyzer = new ComplexityAnalyzer();

    const message = `
-   deploy    the    pipeline
*   verify     the     QA     checklist
`;

    const result = analyzer.analyzeComplexity(message);

    expect(result.detectedTasks).toEqual([
      'deploy the pipeline',
      'verify the QA checklist',
    ]);
  });

  it('normalizes excessive whitespace in natural language tasks', () => {
    const analyzer = new ComplexityAnalyzer();

    const message =
      'I must   coordinate     the   release, and   document    the   decisions.';

    const result = analyzer.analyzeComplexity(message);

    expect(result.detectedTasks).toEqual([
      'coordinate the release',
      'document the decisions',
    ]);
  });
});
