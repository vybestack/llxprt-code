/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { BlockPosition } from '../../journal/idFactCodec.js';
import type { JournalResponseSource } from './journal-response-source.js';
import type { JournalResponsePlan } from './journal-response-plan.js';
import type { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';

export interface AnthropicToolOccurrenceFacts {
  readonly block: number;
  readonly rawId: string;
  readonly id: string;
  readonly kind: 'use' | 'result';
  readonly source: BlockPosition;
  readonly best: BlockPosition | undefined;
  readonly uses: number;
  readonly results: number;
  readonly usesBefore: number;
  readonly resultsBefore: number;
  readonly nextResult: number | undefined;
  readonly orphan: boolean;
}

interface IdFacts {
  readonly uses: number;
  readonly results: number;
  readonly usesBefore: number;
  readonly resultsBefore: number;
  readonly nextResult: number | undefined;
}

async function idFacts(
  query: IndexedJournalRequestSnapshot,
  index: number,
  id: string,
): Promise<IdFacts> {
  const prefix = { from: 0, to: index };
  return {
    uses: await query.normalizedCount(2, 0, id),
    results: await query.normalizedCount(2, 1, id),
    usesBefore: await query.normalizedCount(2, 0, id, prefix),
    resultsBefore: await query.normalizedCount(2, 1, id, prefix),
    nextResult: await query.firstAfter(2, 1, id, index),
  };
}

export async function anthropicToolFacts(
  query: IndexedJournalRequestSnapshot,
  source: JournalResponseSource,
  normalize: (rawId: string) => string,
  plan: JournalResponsePlan,
  index: number,
): Promise<readonly AnthropicToolOccurrenceFacts[]> {
  const ids = new Map<string, IdFacts>();
  const facts: AnthropicToolOccurrenceFacts[] = [];
  let at = 0;
  for await (const block of plan.openBlocks()) {
    const ref = plan.blocks[at++];
    if (
      (block.type !== 'tool_call' && block.type !== 'tool_response') ||
      (block.type === 'tool_call' && plan.header.speaker !== 'ai')
    )
      continue;
    const rawId = block.type === 'tool_call' ? block.id : block.callId;
    const id = normalize(rawId);
    let occurrences = ids.get(id);
    if (occurrences === undefined) {
      occurrences = await idFacts(query, index, id);
      ids.set(id, occurrences);
    }
    const raw = await source.facts.fact(rawId);
    facts.push({
      block: at - 1,
      rawId,
      id,
      kind: block.type === 'tool_call' ? 'use' : 'result',
      source: ref.at,
      best: raw?.best,
      ...occurrences,
      orphan: block.type === 'tool_response' && occurrences.uses === 0,
    });
  }
  return facts;
}
