/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { tokenUsagePlanSignature } from './token-usage-facts.js';
import type { JournalResponsePlan } from './journal-response-plan.js';

describe('token usage signature work', () => {
  it('bounds row-stamp reads by contiguous source runs while preserving signature invalidation', async () => {
    const plan: JournalResponsePlan = {
      header: { speaker: 'human', blocks: [] },
      pending: false,
      blocks: Array.from({ length: 512 }, (_, block) => ({
        kind: 'source',
        at: { label: block < 256 ? 1n : 2n, part: 0, block },
      })),
      async *openBlocks() {
        yield { type: 'text', text: 'Signatures do not need to decode blocks' };
      },
    };
    let reads = 0;
    const stamp = async (label: bigint): Promise<string> => {
      reads++;
      return `row-${label}`;
    };
    const signature = await tokenUsagePlanSignature(plan, stamp);
    expect(reads).toBe(2);
    expect(signature).toHaveLength(64);
    expect(
      await tokenUsagePlanSignature(plan, async (label) => `changed-${label}`),
    ).not.toBe(signature);
    expect(
      await tokenUsagePlanSignature(
        { ...plan, blocks: [...plan.blocks].reverse() },
        stamp,
      ),
    ).not.toBe(signature);
  });
});
