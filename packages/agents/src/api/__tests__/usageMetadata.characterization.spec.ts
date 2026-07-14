/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260707-AGENTNEUTRAL.P18
 * @requirement:REQ-007.1
 *
 * Characterization test that runs a REAL agent turn emitting usage metadata
 * on the Finished event and RECORDS the observed runtime key set.
 *
 * Key findings (captured at implementation time):
 *  - The internal ServerFinishedEvent.value.usageMetadata is typed as
 *    UsageStats (neutral: promptTokens, completionTokens, totalTokens,
 *    cachedTokens?, reasoningTokens?, toolTokens?).
 *  - At RUNTIME, a turn driven by a provider whose terminal chunk carries
 *    metadata.usage emits a Finished event whose .value.usageMetadata carries
 *    the neutral UsageStats keys: promptTokens, completionTokens,
 *    totalTokens (and cachedTokens/reasoningTokens/toolTokens when supplied).
 *
 * The public done.finished.usageMetadata (Gemini-named) surface is the
 * responsibility of the eventAdapter mapper (P19); this test pins the
 * INTERNAL (neutral) shape only.
 */

import { describe, it, expect, vi, type Mock } from 'vitest';
import * as fc from 'fast-check';
import {
  createFullLoopHarness,
  runFullLoop,
  findFinished,
  terminalIContent,
  makeProviderStream,
} from '../../core/__tests__/streamPipeline-characterization-helpers.js';
import type { UsageStats } from '@vybestack/llxprt-code-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUsageTurn(usage: Partial<UsageStats>): Mock {
  return vi.fn(() =>
    makeProviderStream([terminalIContent('Done.', 'stop', usage)]),
  ) as Mock;
}

/**
 * Drives a REAL full-loop turn whose terminal chunk carries `usage` and
 * returns the Finished event's usageMetadata (or undefined).
 */
async function driveTurnAndExtractUsage(
  usage: Partial<UsageStats>,
): Promise<UsageStats | undefined> {
  const mock = makeUsageTurn(usage);
  const harness = createFullLoopHarness(mock);
  const events = await runFullLoop(harness.turn, 'hello');
  const finished = findFinished(events);
  return finished?.value.usageMetadata;
}

// ---------------------------------------------------------------------------
// Characterization: observed runtime key set on Finished.usageMetadata
// ---------------------------------------------------------------------------

describe('P18: usage-metadata characterization (Finished event) @plan:PLAN-20260707-AGENTNEUTRAL.P18 @requirement:REQ-007.1', () => {
  it('emits a Finished event carrying usageMetadata on a real agent turn', async () => {
    const usage = await driveTurnAndExtractUsage({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    expect(usage).toBeDefined();
    expect(usage).not.toBeNull();
  });

  it('RECORDS: Finished.usageMetadata carries neutral UsageStats keys (promptTokens, completionTokens, totalTokens) — NOT Gemini-named keys', async () => {
    const usage = await driveTurnAndExtractUsage({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
    expect(usage).toBeDefined();

    // Neutral keys MUST be present
    expect(usage).toHaveProperty('promptTokens');
    expect(usage).toHaveProperty('completionTokens');
    expect(usage).toHaveProperty('totalTokens');

    // Gemini-named keys MUST be absent from the internal Finished event
    // (they appear on the PUBLIC done.finished.usageMetadata only, via
    // the eventAdapter mapper — tested in P19).
    expect(usage).not.toHaveProperty('promptTokenCount');
    expect(usage).not.toHaveProperty('candidatesTokenCount');
    expect(usage).not.toHaveProperty('totalTokenCount');
    expect(usage).not.toHaveProperty('cachedContentTokenCount');
  });

  it('RECORDS: neutral totalTokens equals promptTokens + completionTokens from the terminal chunk', async () => {
    const usage = await driveTurnAndExtractUsage({
      promptTokens: 42,
      completionTokens: 8,
      totalTokens: 50,
    });
    expect(usage?.promptTokens).toBe(42);
    expect(usage?.completionTokens).toBe(8);
    expect(usage?.totalTokens).toBe(50);
  });

  it('RECORDS: cachedTokens surfaces on Finished.usageMetadata when supplied', async () => {
    const usage = await driveTurnAndExtractUsage({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      cachedTokens: 30,
    });
    expect(usage?.cachedTokens).toBe(30);
  });

  it('RECORDS: reasoningTokens surfaces on Finished.usageMetadata when supplied', async () => {
    const usage = await driveTurnAndExtractUsage({
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      reasoningTokens: 15,
    });
    expect(usage?.reasoningTokens).toBe(15);
  });

  it('does NOT emit usageMetadata on Finished when the terminal chunk carries no usage', async () => {
    const mock = vi.fn(() =>
      makeProviderStream([terminalIContent('Done.', 'stop')]),
    ) as Mock;
    const harness = createFullLoopHarness(mock);
    const events = await runFullLoop(harness.turn, 'hello');
    const finished = findFinished(events);
    expect(finished).toBeDefined();
    expect(finished?.value.usageMetadata).toBeUndefined();
  });

  // ── Property-based (≥30% of tests) ──────────────────────────────────────

  it('PROPERTY: for any non-negative token counts, Finished.usageMetadata preserves promptTokens/completionTokens/totalTokens', async () => {
    const arb = fc.record({
      promptTokens: fc.integer({ min: 0, max: 100000 }),
      completionTokens: fc.integer({ min: 0, max: 100000 }),
      totalTokens: fc.integer({ min: 0, max: 200000 }),
    });
    await fc.assert(
      fc.asyncProperty(arb, async (u) => {
        const usage = await driveTurnAndExtractUsage(u);
        expect(usage?.promptTokens).toBe(u.promptTokens);
        expect(usage?.completionTokens).toBe(u.completionTokens);
        expect(usage?.totalTokens).toBe(u.totalTokens);
      }),
    );
  });

  it('PROPERTY: for any non-negative cachedTokens, Finished.usageMetadata.cachedTokens equals the input', async () => {
    const arb = fc.record({
      promptTokens: fc.integer({ min: 0, max: 100000 }),
      completionTokens: fc.integer({ min: 0, max: 100000 }),
      totalTokens: fc.integer({ min: 0, max: 200000 }),
      cachedTokens: fc.integer({ min: 0, max: 50000 }),
    });
    await fc.assert(
      fc.asyncProperty(arb, async (u) => {
        const usage = await driveTurnAndExtractUsage(u);
        expect(usage?.cachedTokens).toBe(u.cachedTokens);
      }),
    );
  });

  it('PROPERTY: Finished.usageMetadata NEVER contains Gemini-named keys (promptTokenCount/candidatesTokenCount/totalTokenCount)', async () => {
    const arb = fc.record({
      promptTokens: fc.integer({ min: 0, max: 100000 }),
      completionTokens: fc.integer({ min: 0, max: 100000 }),
      totalTokens: fc.integer({ min: 0, max: 200000 }),
    });
    await fc.assert(
      fc.asyncProperty(arb, async (u) => {
        const usage = await driveTurnAndExtractUsage(u);
        expect(usage).toBeDefined();
        expect(usage).not.toHaveProperty('promptTokenCount');
        expect(usage).not.toHaveProperty('candidatesTokenCount');
        expect(usage).not.toHaveProperty('totalTokenCount');
      }),
    );
  });
});
