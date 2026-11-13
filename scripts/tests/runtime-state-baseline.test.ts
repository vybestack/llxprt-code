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
  count: 1,
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
      {
        file: finding.file,
        rule: finding.rule,
        declaration: 'newCache',
        count: 1,
      },
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

  it('keeps mutable-state findings in original runtime roots strict', () => {
    const finding: AuditFinding = { ...cachedState, rule: 'mutable-state' };
    const comparison = compareStateBaseline([finding], []);

    expect(comparison.strictFindings).toEqual([finding]);
    expect(comparison.unbaselined).toEqual([]);
    expect(comparison.stale).toEqual([]);
  });

  it('ratchets mutable-state findings only in widened source roots', () => {
    const finding: AuditFinding = {
      ...cachedState,
      file: 'packages/demo/src/notes.ts',
      rule: 'mutable-state',
    };
    const comparison = compareStateBaseline([finding], []);

    expect(comparison.strictFindings).toEqual([]);
    expect(comparison.unbaselined).toEqual([
      {
        file: finding.file,
        rule: finding.rule,
        declaration: finding.declaration,
        count: 1,
      },
    ]);
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
      count: 1,
    };
    const comparison = compareStateBaseline([finding], [entry]);

    expect(comparison.strictFindings).toEqual([]);
    expect(comparison.unbaselined).toEqual([]);
    expect(comparison.stale).toEqual([]);
  });

  it('rejects growth when a new environment member shares a former key', () => {
    const first = {
      ...cachedState,
      rule: 'process-environment-mutation',
      declaration: 'run.process.env.FIRST',
    };
    const second = { ...first, declaration: 'run.process.env.SECOND' };
    const baseline = [
      {
        file: first.file,
        rule: first.rule,
        declaration: first.declaration,
        count: 1,
      },
    ];
    const comparison = compareStateBaseline([first, second], baseline);

    expect(comparison.unbaselined).toEqual([
      {
        file: second.file,
        rule: second.rule,
        declaration: second.declaration,
        count: 1,
      },
    ]);
    expect(comparison.stale).toEqual([]);
  });

  it('rejects partial removal under an identity with repeated findings', () => {
    const findings = [cachedState, { ...cachedState, line: 13 }];
    const baseline = [
      {
        file: cachedState.file,
        rule: cachedState.rule,
        declaration: cachedState.declaration,
        count: 2,
      },
    ];
    const comparison = compareStateBaseline(findings.slice(0, 1), baseline);

    expect(comparison.unbaselined).toEqual([]);
    expect(comparison.stale).toEqual([{ ...baseline[0], count: 1 }]);
  });
});
