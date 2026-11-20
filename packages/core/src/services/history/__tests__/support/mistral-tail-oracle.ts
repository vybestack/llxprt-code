/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { getToolIdStrategy } from '@vybestack/llxprt-code-tools';
import type { IndexedJournalRequestSnapshot } from '../../indexed-journal-request-snapshot.js';
import type { IContent } from '../../IContent.js';

export async function assertMistralTail(
  request: IndexedJournalRequestSnapshot,
  units: readonly IContent[],
  slot = 0,
): Promise<void> {
  const mapper = getToolIdStrategy('mistral').createMapper([...units]);
  for (const unit of units)
    for (const block of unit.blocks)
      if (block.type === 'tool_call' && block.id !== '')
        expect((await request.mistralMapping(block.id, slot))?.id).toBe(
          mapper.resolveToolCallId(block),
        );
  expect(await request.mistralMapping('', slot)).toBeUndefined();
  expect(await request.mistralMapping('absent', slot)).toBeUndefined();
}
