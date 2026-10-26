/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { UnsupportedMediaEntry } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { ROW_FLAG } from '@vybestack/llxprt-code-core/journal/rowRecord.js';
import type { NativeProviderFormat } from '@vybestack/llxprt-code-core/services/history/native-provider-format.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import {
  decodeSlotSummary,
  type SlotSummary,
} from '@vybestack/llxprt-code-core/journal/slotSummary.js';
import {
  composeSlotSummaries,
  identitySlotSummary,
} from '@vybestack/llxprt-code-core/journal/summaryComposition.js';
import { unitCount } from '@vybestack/llxprt-code-core/journal/unitContributions.js';
import { UnsupportedMediaSummary } from '../utils/unsupported-media-summary.js';
import { classifyMediaBlock } from '../utils/mediaUtils.js';
import {
  responsesUnitLength,
  responsesUnitPairs,
  responsesUnitSummary,
} from './responses-unit-length.js';

export async function statefulUnsupportedMedia(
  rows: ProviderRequestRows,
  skipRows: number,
  pdfEnabled: boolean,
): Promise<readonly UnsupportedMediaEntry[]> {
  const indexed = rows.native?.indexed;
  if (
    indexed !== undefined &&
    !(await indexed.hasPersistedMedia()) &&
    indexed.viewPlan.changedSources.find(
      (row) => (row.entry.flags & ROW_FLAG.hasMedia) !== 0,
    ) === undefined
  )
    return [];
  const unsupported = new UnsupportedMediaSummary();
  for (let index = skipRows; index < rows.count; index++) {
    const entry =
      indexed === undefined
        ? undefined
        : (await indexed.unitEntryAt(index)).entry;
    if (
      entry !== undefined &&
      (entry.flags & ROW_FLAG.hasMedia) === 0 &&
      entry.toolCallBlocks === 0 &&
      entry.responseBlocks === 0
    )
      continue;
    if (indexed === undefined) {
      const row = await rows.readAt(index);
      unsupported.addAll(unsupportedMediaForRow(row, pdfEnabled));
    } else {
      await unsupportedMediaForPlan(indexed, index, pdfEnabled, unsupported);
    }
  }
  return unsupported.entries();
}

async function unsupportedMediaForPlan(
  indexed: NativeProviderFormat['indexed'],
  index: number,
  pdfEnabled: boolean,
  unsupported: UnsupportedMediaSummary,
): Promise<void> {
  const plan = await indexed.planAt(index);
  for await (const block of plan.openBlocks()) {
    if (block.type === 'media')
      unsupported.addAll(
        unsupportedMediaForRow({ ...plan.header, blocks: [block] }, pdfEnabled),
      );
  }
}

export function unsupportedMediaForRow(
  row: IContent,
  pdfEnabled: boolean,
): UnsupportedMediaEntry[] {
  const unsupported: UnsupportedMediaEntry[] = [];
  for (const block of row.blocks.filter((block) => block.type === 'media')) {
    const category = classifyMediaBlock(block);
    if (category === 'image' || (category === 'pdf' && pdfEnabled)) continue;
    unsupported.push({
      kind: 'unsupported',
      mediaType: category,
      reason: `${category} input is not supported by this protocol and was replaced with a text placeholder`,
    });
  }
  return unsupported;
}

export async function statefulResponsesSummary(
  native: NativeProviderFormat,
  snapshot: VersionSnapshot,
  slot: number,
  settings: RowFormatSettings,
  skipRows: number,
): Promise<{ readonly summary: SlotSummary; readonly pdfBytes: number }> {
  const indexed = native.indexed;
  const format = snapshot.version?.slots.formatSlots[slot];
  if (format === undefined) throw new Error('Missing Responses format');
  let summary = identitySlotSummary('responses');
  let pdfBytes = 0;
  let index = skipRows;
  while (index < indexed.count) {
    const selected = await indexed.unitEntryAt(index);
    const changed = indexed.viewPlan.changedSources.find(
      (row) => row.entry.label === selected.entry.label,
    );
    const entry =
      changed?.entry ?? (await snapshot.entryByLabel(selected.entry.label));
    if (entry === undefined) throw new Error('Missing Responses entry');
    const count = changed?.count ?? unitCount(entry);
    const remaining = count - selected.unit;
    if (
      changed === undefined &&
      selected.unit === 0 &&
      entry.toolCallBlocks === 0 &&
      entry.responseBlocks === 0
    ) {
      const stored = decodeSlotSummary(entry.summary[slot], format);
      if (stored.kind !== 'responses')
        throw new Error('Missing Responses facts');
      summary = composeSlotSummaries(summary, {
        kind: 'responses',
        variants: [
          { ...stored.variants[0], r: 0 },
          { ...stored.variants[1], r: 0 },
        ],
      });
      pdfBytes += entry.media.pdfBytes[slot];
    } else {
      for (let offset = 0; offset < remaining; offset++) {
        const row = await indexed.readAt(index + offset);
        const pairs = await responsesUnitPairs(row, indexed, skipRows);
        const kept = responsesUnitLength(row, settings, true, pairs, true);
        const removed = responsesUnitLength(row, settings, false, pairs, true);
        summary = composeSlotSummaries(summary, {
          kind: 'responses',
          variants: [responsesUnitSummary(kept), responsesUnitSummary(removed)],
        });
        pdfBytes += kept.pdfBytes;
      }
    }
    index += remaining;
  }
  return { summary, pdfBytes };
}
