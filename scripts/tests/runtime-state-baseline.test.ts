/*
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import {
  compareStateBaseline,
  type StateBaselineEntry,
} from '../runtime-state-baseline.js';
import type { AuditFinding } from '../check-runtime-state-boundary.js';

const cachedState: AuditFinding = {
  owner: 'demo',
  file: 'packages/demo/src/runtime/state.ts',
  line: 12,
  column: 7,
  rule: 'module-mutation',
  declaration: 'cache',
};
const cachedStateEntry: StateBaselineEntry = {
  file: cachedState.file,
  rule: cachedState.rule,
  declaration: 'cache',
};

describe('runtime state baseline ratchet', () => {
  it('accepts findings already recorded in the widened-scope baseline', () => {
    const comparison = compareStateBaseline([cachedState], [cachedStateEntry]);

    expect(comparison.unbaselined).toEqual([]);
    expect(comparison.stale).toEqual([]);
    expect(comparison.strictFindings).toEqual([]);
  });

  it('rejects a widened-scope finding that is absent from the baseline', () => {
    const finding = { ...cachedState, declaration: 'newCache' };
    const comparison = compareStateBaseline([finding], [cachedStateEntry]);

    expect(comparison.unbaselined).toEqual([
      { file: finding.file, rule: finding.rule, declaration: 'newCache' },
    ]);
    expect(comparison.stale).toEqual([cachedStateEntry]);
  });

  it('rejects a baseline entry after its finding disappears', () => {
    const comparison = compareStateBaseline([], [cachedStateEntry]);

    expect(comparison.unbaselined).toEqual([]);
    expect(comparison.stale).toEqual([cachedStateEntry]);
  });

  it('keeps narrow scanner rules outside the widened-scope baseline', () => {
    const finding: AuditFinding = {
      ...cachedState,
      rule: 'assembly-closure',
      declaration: 'createAgent',
    };
    const comparison = compareStateBaseline([finding], []);

    expect(comparison.strictFindings).toEqual([finding]);
    expect(comparison.unbaselined).toEqual([]);
    expect(comparison.stale).toEqual([]);
  });

  it('ratchets service-shape findings surfaced by the production scan', () => {
    const finding: AuditFinding = {
      ...cachedState,
      rule: 'runtime-service-bundle',
      declaration: 'ServiceBundle',
    };
    const entry = {
      file: finding.file,
      rule: finding.rule,
      declaration: 'ServiceBundle',
    };
    const comparison = compareStateBaseline([finding], [entry]);

    expect(comparison.strictFindings).toEqual([]);
    expect(comparison.unbaselined).toEqual([]);
    expect(comparison.stale).toEqual([]);
  });
});
