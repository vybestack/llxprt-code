/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import {
  captureRowFormatSettings,
  rowFormatKey,
  type RowFormatRegistration,
  type RowFormatSettings,
  type RowLengthFacts,
} from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { RowEntry } from '@vybestack/llxprt-code-core/journal/rowEntry.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import {
  decodeSlotSummary,
  type SlotSummary,
} from '@vybestack/llxprt-code-core/journal/slotSummary.js';
import {
  composeSlotSummaries,
  identitySlotSummary,
} from '@vybestack/llxprt-code-core/journal/summaryComposition.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { journalEntryPlans } from '@vybestack/llxprt-code-core/services/history/journal-entry-plans.js';
import { JournalTailSource } from '@vybestack/llxprt-code-core/services/history/journal-tail-source.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { jsonValueByteLength } from '../utils/progressive-json-body.js';
import { PDF_AGGREGATE_MAX_BYTES } from '../utils/mediaUtils.js';
import type { OpenAIResponsesRequest } from './OpenAIResponsesTypes.js';
import { responsesRequestParts } from './responses-disk-body.js';
import {
  reasoningDigitBytes,
  responsesUnitLength,
  responsesUnitPairs,
  responsesUnitSummary,
  type ResponsesUnitLength,
} from './responses-unit-length.js';

export const RESPONSES_FORMAT_REV = 1;

function supported(settings: RowFormatSettings): void {
  if (
    [
      settings.formatId !== 'responses',
      settings.formatRev !== RESPONSES_FORMAT_REV,
      settings.isOAuth,
      settings.toolNameTransform !== 'none',
      !settings.supportsUrlImages,
      settings.reasoningEnabled,
      settings.reasoningFieldName !== 'reasoning_content',
      settings.unsupportedMedia !== 'notice',
    ].includes(true)
  )
    throw new JournalFormatError(
      'Responses length measurer does not support these converter settings',
    );
}

async function measure(
  snapshot: VersionSnapshot,
  entry: RowEntry,
  settings: RowFormatSettings,
): Promise<RowLengthFacts> {
  supported(settings);
  const source = await JournalTailSource.create(snapshot, []);
  const query = await IndexedJournalRequestSnapshot.create(snapshot);
  let summary = identitySlotSummary('responses');
  const units: Array<readonly [ResponsesUnitLength, ResponsesUnitLength]> = [];
  let pdfBytes = 0;
  try {
    for await (const plan of journalEntryPlans(source, entry)) {
      const blocks: IContent['blocks'] = [];
      for await (const block of plan.openBlocks()) blocks.push(block);
      const unit = { ...plan.header, blocks };
      const pairs = await responsesUnitPairs(unit, query);
      const kept = responsesUnitLength(unit, settings, true, pairs);
      const removed = unit.blocks.some((block) => block.type === 'thinking')
        ? responsesUnitLength(unit, settings, false, pairs)
        : kept;
      units.push([kept, removed]);
      pdfBytes += kept.pdfBytes;
      summary = composeSlotSummaries(summary, {
        kind: 'responses',
        variants: [responsesUnitSummary(kept), responsesUnitSummary(removed)],
      });
    }
  } finally {
    await query.close();
  }
  return {
    summary,
    pdfBytes,
    lens: new TextEncoder().encode(
      JSON.stringify({ revision: RESPONSES_FORMAT_REV, units }),
    ),
  };
}

export function responsesLengthRegistration(
  settings: RowFormatSettings,
): RowFormatRegistration {
  supported(settings);
  return { settings, measure };
}

export interface StoredResponsesRequestPlan {
  readonly contentLength: number;
  readonly inputBytes: number;
  readonly items: number;
  readonly generatedIds: number;
  readonly pdfBytes: number;
  readonly reasoningIdTime: number;
  readonly key: bigint;
  readonly generation: number;
  readonly settings: RowFormatSettings;
}

interface ResponsesSelection {
  readonly cursor?: number;
  readonly pendingInputCount?: number;
  readonly summary?: SlotSummary;
  readonly pdfBytes?: number;
}

function supportedRequest(
  request: OpenAIResponsesRequest,
  settings: RowFormatSettings,
  reasoningIdTime: number,
  selection: ResponsesSelection,
): void {
  if (
    request.previous_response_id !== undefined &&
    selection.summary === undefined
  )
    throw new JournalFormatError(
      'Responses parent planning requires cursor-restricted pair corrections',
    );
  if ((selection.cursor ?? 0) !== 0)
    throw new JournalFormatError(
      'Responses cursor planning is not implemented',
    );
  if ((selection.pendingInputCount ?? 0) !== 0)
    throw new JournalFormatError(
      'Responses pending-tail planning is not implemented',
    );
  if (!Array.isArray(request.input) || request.input.length !== 0)
    throw new JournalFormatError(
      'Responses input overrides cannot use stored history lengths',
    );
  if (request.model !== settings.model)
    throw new JournalFormatError(
      'Responses request model differs from measured settings',
    );
  if (!Number.isSafeInteger(reasoningIdTime) || reasoningIdTime < 0)
    throw new JournalFormatError(
      'Responses reasoning ID time must be a nonnegative safe integer',
    );
}

export function planStoredResponsesRequest(
  snapshot: VersionSnapshot,
  settings: RowFormatSettings,
  selected: 0 | 1,
  request: OpenAIResponsesRequest,
  reasoningIdTime: number,
  selection: ResponsesSelection = {},
): StoredResponsesRequestPlan {
  snapshot.requireOpen();
  supported(settings);
  supportedRequest(request, settings, reasoningIdTime, selection);
  const key = rowFormatKey(settings);
  const version = snapshot.version;
  const slot =
    version?.slots.formatSlots.findIndex(
      (format) =>
        format.summaryKind === 'responses' && format.formatKeyHash === key,
    ) ?? -1;
  if (slot < 0 || version === undefined)
    throw new JournalFormatError(
      'Request format is not registered in this pin',
    );
  const format = version.slots.formatSlots[slot];
  if (
    version.rows !== 0 &&
    [
      version.aggregate.stamp[slot].gen !== format.gen,
      version.aggregate.missingBase[slot] !== 0,
      version.aggregate.stamp[slot].imageGen !== format.imageGen,
      version.aggregate.missingImg[slot] !== 0,
    ].includes(true)
  )
    throw new JournalFormatError(
      'Request format length facts are unmeasured or stale',
    );
  const summary =
    selection.summary ??
    (version.rows === 0
      ? identitySlotSummary('responses')
      : decodeSlotSummary(version.aggregate.summaries[slot], format));
  if (summary.kind !== 'responses')
    throw new JournalFormatError('Request format has no Responses summary');
  const root = summary.variants[selected];
  const inputBytes =
    2 +
    root.bytes[0] +
    root.r * Buffer.byteLength(`,"id":"rs_${reasoningIdTime}_"`) +
    reasoningDigitBytes(root.r);
  const pdfBytes = selection.pdfBytes ?? version.aggregate.pdfBytes[slot];
  if (pdfBytes > PDF_AGGREGATE_MAX_BYTES)
    throw new Error(
      `Native PDF input payload (${pdfBytes} bytes) exceeds the allowed ${PDF_AGGREGATE_MAX_BYTES} bytes (50 MB). Reduce the number or size of PDF files.`,
    );
  let contentLength = 0;
  for (const part of responsesRequestParts(request)) {
    if (part.kind === 'literal') contentLength += part.bytes.byteLength;
    else
      contentLength +=
        part.key === 'input' ? inputBytes : jsonValueByteLength(part.value);
  }
  return Object.freeze({
    contentLength,
    inputBytes,
    items: root.count[0],
    generatedIds: root.r,
    pdfBytes,
    reasoningIdTime,
    key,
    generation: format.gen,
    settings: captureRowFormatSettings(settings),
  });
}
