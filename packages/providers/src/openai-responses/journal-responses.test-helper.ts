/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import {
  buildOpenAIResponsesUnit,
  type ResponsesInputBuildContext,
} from './OpenAIResponsesInputBuilder.js';
import type { ResponsesInputItem } from './OpenAIResponsesTypes.js';
import { responsesUnitPairs } from './responses-unit-length.js';

export async function indexedResponsesInput(
  query: IndexedJournalRequestSnapshot,
  context: ResponsesInputBuildContext,
): Promise<ResponsesInputItem[]> {
  const items: ResponsesInputItem[] = [];
  let reasoning = 0;
  for await (const unit of query.openReader()) {
    const pairs = await responsesUnitPairs(unit, query);
    items.push(
      ...buildOpenAIResponsesUnit(
        unit,
        context,
        pairs,
        () => `rs_${context.reasoningIdTime}_${reasoning++}`,
      ),
    );
  }
  return items;
}
