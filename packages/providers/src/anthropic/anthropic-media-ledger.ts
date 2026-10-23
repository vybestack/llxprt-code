/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { UnsupportedMediaEntry } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type {
  NativeFactIndexReader,
  NativeFactIndexWriter,
} from '@vybestack/llxprt-code-core/journal/nativeFactIndex.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { unsupportedMediaOfRow } from '../utils/mediaUtils.js';
import { createMediaSupportPredicate } from './AnthropicEndpointUtils.js';
import { measurableAnthropicRow } from './anthropic-measured-media.js';

function unsupported(
  row: IContent,
  settings: RowFormatSettings,
): readonly UnsupportedMediaEntry[] {
  return unsupportedMediaOfRow(
    measurableAnthropicRow(row),
    createMediaSupportPredicate(settings.endpoint),
  );
}

export function anthropicMediaLedgerWriter(
  writer: NativeFactIndexWriter,
  settings: RowFormatSettings,
): {
  observe(row: IContent, at: number): Promise<void>;
  finish(): Promise<void>;
  hasMedia(): boolean;
} {
  let count = 0;
  let media = false;
  let through = -1;
  return {
    async observe(row, at) {
      if (at <= through) return;
      through = at;
      media ||= row.blocks.some((block) => block.type === 'media');
      if (unsupported(row, settings).length !== 0)
        await writer.set(['unsupported-row', count++], [at]);
    },
    finish: () => writer.set(['unsupported-rows'], [count]),
    hasMedia: () => media,
  };
}

export async function readAnthropicMediaLedger(
  query: IndexedJournalRequestSnapshot,
  facts: NativeFactIndexReader,
  settings: RowFormatSettings,
): Promise<readonly UnsupportedMediaEntry[]> {
  const count = await facts.get(['unsupported-rows']);
  if (count === undefined)
    throw new Error('Missing Anthropic unsupported-media facts');
  const ledger: UnsupportedMediaEntry[] = [];
  const changed = query.viewPlan.changedSources;
  let change = 0;
  const appendChanged = async (before: number): Promise<void> => {
    while (change < changed.length && changed[change].start <= before) {
      const row = changed[change++];
      for (let at = row.start; at < row.start + row.count; at++)
        ledger.push(...unsupported(await query.readAt(at), settings));
    }
  };
  for (let ordinal = 0; ordinal < count[0]; ordinal++) {
    const row = await facts.get(['unsupported-row', ordinal]);
    if (row === undefined)
      throw new Error('Missing Anthropic unsupported-media row');
    const at = row[0];
    await appendChanged(at);
    if (
      !changed.some((row) => at >= row.start && at < row.start + row.oldCount)
    )
      ledger.push(...unsupported(await query.readAt(at), settings));
  }
  await appendChanged(Infinity);
  return ledger;
}
