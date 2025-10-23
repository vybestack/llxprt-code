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

  it('counts file references toward task detection for todo suggestions', () => {
    const analyzer = new ComplexityAnalyzer({
      complexityThreshold: 0.6,
      minTasksForSuggestion: 3,
    });

    const message =
      'Please update src/app.ts, src/index.ts, and src/utils/helpers.ts so the new plan is reflected everywhere.';

    const result = analyzer.analyzeComplexity(message);

    expect(result.detectedTasks).toEqual([
      'src/app.ts',
      'src/index.ts',
      'src/utils/helpers.ts',
    ]);
  });
});
