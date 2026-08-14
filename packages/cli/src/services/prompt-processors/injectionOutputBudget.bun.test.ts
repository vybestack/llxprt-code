/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  buildBoundedPrompt,
  StreamingInjectionBuilder,
  DEFAULT_INJECTION_OUTPUT_BUDGET_BYTES,
} from './injectionOutputBudget.js';
import { createByteBudget } from '@vybestack/llxprt-code-tools/acquisition.js';
import type { PromptSegment } from './injectionOutputBudget.js';

function literal(text: string): PromptSegment {
  return { kind: 'literal', text };
}

function output(out: string, statusSuffix = ''): PromptSegment {
  return { kind: 'output', output: out, statusSuffix };
}

function omittedByteCount(text: string): number {
  const suffix = ' bytes omitted';
  const end = text.indexOf(suffix);
  if (end < 0) {
    throw new Error('Expected an omitted-byte count in the truncation notice');
  }
  const start = text.lastIndexOf(': ', end);
  if (start < 0) {
    throw new Error('Expected a byte-count separator in the truncation notice');
  }
  return Number(
    text
      .slice(start + 2, end)
      .split(',')
      .join(''),
  );
}

describe('buildBoundedPrompt - aggregate injection bounding (issue #3200 finding 2)', () => {
  it('assembles all segments when aggregate output is under budget', () => {
    const segments: PromptSegment[] = [
      literal('Status: '),
      output('On branch main'),
      literal(' in '),
      output('/home/user'),
    ];
    const result = buildBoundedPrompt(segments, createByteBudget(4096));
    expect(result).toBe('Status: On branch main in /home/user');
  });

  it('does not bound literal text even when outputs are large', () => {
    const bigOutput = 'X'.repeat(10000);
    const segments: PromptSegment[] = [
      literal('LITERAL_MARKER_START '),
      output(bigOutput),
      literal(' LITERAL_MARKER_END'),
    ];
    const result = buildBoundedPrompt(segments, createByteBudget(1024));
    // Literal text is always preserved.
    expect(result).toContain('LITERAL_MARKER_START');
    expect(result).toContain('LITERAL_MARKER_END');
    // Exactly one omission notice.
    expect(result.match(/injection output truncated/g)).toHaveLength(1);
  });

  it('bounds the aggregate across multiple injections, keeping head and tail', () => {
    // 6 outputs of 1000 bytes each = 6000 bytes total, budget = 2048.
    const segments: PromptSegment[] = [];
    for (let i = 0; i < 6; i++) {
      segments.push(output(`HEAD${i}_` + 'a'.repeat(992) + `_TAIL${i}\n`));
    }
    const result = buildBoundedPrompt(segments, createByteBudget(2048));

    // The first output (head) is retained.
    expect(result).toContain('HEAD0_');
    // The last output (tail) is retained.
    expect(result).toContain('TAIL5');
    // Exactly one notice.
    expect(result.match(/injection output truncated/g)).toHaveLength(1);
    // The notice reports an accurate nonzero omitted byte count.
    expect(omittedByteCount(result)).toBeGreaterThan(0);
    // Bounded: total retained output is well under 6000.
    expect(result.length).toBeLessThan(5000);
  });

  it('preserves command status suffixes for retained outputs', () => {
    const segments: PromptSegment[] = [
      output('ok', '\n[exited with code 0]'),
      literal(' --- '),
      output('fail', '\n[exited with code 1]'),
    ];
    const result = buildBoundedPrompt(segments, createByteBudget(4096));
    expect(result).toContain('[exited with code 0]');
    expect(result).toContain('[exited with code 1]');
  });

  it('emits exactly one omission notice even with many dropped middle outputs', () => {
    const segments: PromptSegment[] = [];
    for (let i = 0; i < 20; i++) {
      segments.push(output(`out${i}_` + 'z'.repeat(2000) + `\n`));
    }
    const result = buildBoundedPrompt(segments, createByteBudget(2048));
    expect(result.match(/injection output truncated/g)).toHaveLength(1);
  });

  it('handles a single oversized output', () => {
    const segments: PromptSegment[] = [
      literal('before '),
      output('A'.repeat(100000)),
      literal(' after'),
    ];
    const result = buildBoundedPrompt(segments, createByteBudget(2048));
    expect(result).toContain('before');
    expect(result).toContain('after');
    expect(result.match(/injection output truncated/g)).toHaveLength(1);
  });

  it('preserves interleaving order of literals and outputs', () => {
    const segments: PromptSegment[] = [
      literal('A'),
      output('1'),
      literal('B'),
      output('2'),
      literal('C'),
    ];
    const result = buildBoundedPrompt(segments, createByteBudget(4096));
    expect(result).toBe('A1B2C');
  });

  it('default budget is finite and positive', () => {
    expect(DEFAULT_INJECTION_OUTPUT_BUDGET_BYTES).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_INJECTION_OUTPUT_BUDGET_BYTES)).toBe(true);
  });
});

describe('StreamingInjectionBuilder - bounded retained state (issue #3200 finding 2)', () => {
  it('retained output state never exceeds the budget for many near-budget injections', () => {
    // 50 injections each producing ~4000 bytes (200,000 total) against a 2048
    // budget. The builder must retain at most the budget regardless of count.
    const budget = createByteBudget(2048);
    const builder = new StreamingInjectionBuilder(budget);
    for (let i = 0; i < 50; i++) {
      builder.appendLiteral(`cmd${i}:`);
      builder.appendOutput(
        'Z'.repeat(4000),
        `
[exit ${i}]`,
      );
      builder.appendLiteral('|');
    }

    // Retained output bytes stay within the single global budget.
    expect(builder.retainedOutputBytes).toBeLessThanOrEqual(budget.bytes);
    expect(builder.observedOutputBytes).toBe(50 * 4000);
    const result = builder.build();
    // The result also carries literals + statuses (small), but the OUTPUT
    // content within it must be bounded.
    expect(result.match(/injection output truncated/g)).toHaveLength(1);
  });

  it('never retains all command outputs simultaneously (peak retained is bounded)', () => {
    // Feed many large outputs one at a time; after each append the retained
    // state must remain bounded by the budget, proving the full outputs are
    // not accumulated.
    const budget = createByteBudget(1024);
    const builder = new StreamingInjectionBuilder(budget);
    let peakRetained = 0;
    for (let i = 0; i < 30; i++) {
      builder.appendOutput('Q'.repeat(8000), `[${i}]`);
      if (builder.retainedOutputBytes > peakRetained) {
        peakRetained = builder.retainedOutputBytes;
      }
    }
    expect(peakRetained).toBeLessThanOrEqual(budget.bytes);
  });

  it('preserves every command status exactly once even when outputs are dropped', () => {
    const budget = createByteBudget(1024);
    const builder = new StreamingInjectionBuilder(budget);
    for (let i = 0; i < 25; i++) {
      builder.appendOutput(
        'D'.repeat(2000),
        `
[exit ${i}]`,
      );
    }
    const result = builder.build();
    // Every status appears exactly once, including the middle outputs whose
    // text was entirely dropped.
    for (let i = 0; i < 25; i++) {
      const count = result.split(`[exit ${i}]`).length - 1;
      expect(count).toBe(1);
    }
  });

  it('does not duplicate or omit statuses at the head/tail boundary', () => {
    const budget = createByteBudget(2048);
    const builder = new StreamingInjectionBuilder(budget);
    // Each output ~1000 bytes; boundary falls inside output 1 or 2.
    for (let i = 0; i < 6; i++) {
      builder.appendOutput(
        `H${i}_` + 'a'.repeat(990) + `_T${i}`,
        `
[st ${i}]`,
      );
    }
    const result = builder.build();
    for (let i = 0; i < 6; i++) {
      expect(result.split(`[st ${i}]`).length - 1).toBe(1);
    }
  });

  it('emits exactly one accurate aggregate notice with correct omitted byte count', () => {
    const budget = createByteBudget(2048);
    const builder = new StreamingInjectionBuilder(budget);
    builder.appendOutput('A'.repeat(10000), '');
    builder.appendOutput('B'.repeat(10000), '');
    const result = builder.build();
    const notices = result.match(/injection output truncated/g);
    expect(notices).toHaveLength(1);
    const omitted = omittedByteCount(result);
    // 20000 observed, ≤ 2048 retained → ≥ ~17952 omitted.
    expect(omitted).toBeGreaterThanOrEqual(17000);
    // omitted + retained == observed.
    expect(omitted + builder.retainedOutputBytes).toBe(
      builder.observedOutputBytes,
    );
  });

  it('respects UTF-8 boundaries when splitting output at the head/tail edge', () => {
    // Multibyte chars (3 bytes each) placed so the head boundary cuts through
    // one. The retained head must not sever a multibyte character.
    const budget = createByteBudget(1024);
    const builder = new StreamingInjectionBuilder(budget);
    const threeByte = Buffer.from([0xe4, 0xb8, 0x96]); // one CJK char
    // 400 chars * 3 bytes = 1200 bytes > 1024 budget.
    builder.appendOutput(
      Buffer.concat(Array(400).fill(threeByte)).toString('utf8'),
      '',
    );
    const result = builder.build();
    // No replacement characters at the split boundary.
    expect(result).not.toContain('\uFFFD');
  });

  it('honors the validated acquisition budget supplied by the caller', () => {
    // The builder accepts any validated ByteBudget; production code resolves it
    // from config via resolveAcquisitionBudgetFromSetting. Verify a configured budget
    // is honored exactly.
    const budget = createByteBudget(4096);
    const builder = new StreamingInjectionBuilder(budget);
    builder.appendOutput('X'.repeat(4096), '');
    // Exactly at budget: no truncation.
    expect(builder.build()).not.toContain('injection output truncated');
  });

  it('places a status after both retained portions of one output', () => {
    const builder = new StreamingInjectionBuilder(createByteBudget(1024));
    builder.appendOutput(`HEAD${'x'.repeat(1988)}TAIL`, '[status]');

    const result = builder.build();
    expect(result.indexOf('HEAD')).toBeLessThan(
      result.indexOf('injection output truncated'),
    );
    expect(result.indexOf('injection output truncated')).toBeLessThan(
      result.indexOf('TAIL'),
    );
    expect(result.indexOf('TAIL')).toBeLessThan(result.indexOf('[status]'));
  });

  it('preserves the literal preceding the first tail-only output', () => {
    const builder = new StreamingInjectionBuilder(createByteBudget(1024));
    builder.appendLiteral('before-head:');
    builder.appendOutput('A'.repeat(1000), '[first-status]');
    builder.appendLiteral(':before-tail:');
    builder.appendOutput('B'.repeat(1000), '[second-status]');

    const result = builder.build();
    expect(result.indexOf(':before-tail:')).toBeLessThan(
      result.indexOf('injection output truncated'),
    );
    expect(result.indexOf('injection output truncated')).toBeLessThan(
      result.indexOf('[second-status]'),
    );
  });
});
