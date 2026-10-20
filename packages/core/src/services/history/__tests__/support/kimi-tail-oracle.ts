/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { getToolIdStrategy } from '@vybestack/llxprt-code-tools';
import type { IndexedJournalRequestSnapshot } from '../../indexed-journal-request-snapshot.js';
import type { IContent } from '../../IContent.js';
import { call } from './normalization-cases.js';

export async function assertKimiTail(
  indexed: IndexedJournalRequestSnapshot,
  units: readonly IContent[],
): Promise<void> {
  const mapper = getToolIdStrategy('kimi').createMapper([...units]);
  const last = new Map<
    string,
    { readonly name: string; readonly ordinal: number }
  >();
  const ids = new Set<string>(['', 'absent']);
  let eligible = 0;
  for (const unit of units)
    for (const block of unit.blocks) {
      if (block.type === 'tool_response') ids.add(block.callId);
      if (block.type !== 'tool_call') continue;
      ids.add(block.id);
      if (block.id && block.name)
        last.set(block.id, { name: block.name, ordinal: eligible++ });
    }
  expect(await indexed.kimiEligibleCount()).toBe(eligible);
  for (const id of ids) {
    const expected = last.get(id);
    expect(await indexed.kimiName(id)).toBe(expected?.name);
    expect(await indexed.kimiOrdinal(id)).toBe(expected?.ordinal);
    expect(await indexed.kimiMappedId(id)).toBe(
      expected === undefined
        ? undefined
        : mapper.resolveToolCallId(call(id, '__probe__')),
    );
  }
}
