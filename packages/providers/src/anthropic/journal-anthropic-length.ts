/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import {
  captureRowFormatSettings,
  rowFormatAuxKey,
  rowFormatKey,
  type RowFormatRegistration,
  type RowFormatSettings,
} from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { decodeSlotSummary } from '@vybestack/llxprt-code-core/journal/slotSummary.js';
import { identitySlotSummary } from '@vybestack/llxprt-code-core/journal/summaryComposition.js';
import { finalizeAnthropicTransfer } from './anthropic-unit-transfer.js';
import { projectAnthropicUnit } from './anthropic-unit-facts.js';
import type { RepairPolicy } from './anthropic-repair-source.js';
import { prepareAnthropicStoredFill } from './anthropic-stored-fill.js';
import { jsonValueByteLength } from '../utils/progressive-json-body.js';

export function anthropicLengthRegistration(
  input: RowFormatSettings,
): RowFormatRegistration {
  const settings = captureRowFormatSettings(input);
  projectAnthropicUnit({ speaker: 'human', blocks: [] }, settings);
  return {
    settings,
    incremental: 'unsupported',
    prepare: prepareAnthropicStoredFill,
    async measure() {
      throw new JournalFormatError(
        'Anthropic measurement requires a fill-scoped native iterator',
      );
    },
  };
}
export interface StoredAnthropicRequestPlan {
  readonly contentLength: number;
  readonly messagesBytes: number;
  readonly messages: number;
  readonly key: bigint;
  readonly generation: number;
  readonly settings: RowFormatSettings;
}
interface Selection {
  readonly from?: number;
  readonly to?: number;
  readonly pendingInputCount?: number;
}
function requestLength(
  bytes: number,
  request: Readonly<Record<string, unknown>>,
): number {
  let total = bytes + Buffer.byteLength('{"messages":') + 1;
  for (const [name, value] of Object.entries(request)) {
    if (value !== undefined)
      total +=
        Buffer.byteLength(JSON.stringify(name)) +
        2 +
        jsonValueByteLength(value);
  }
  return total;
}

export async function planStoredAnthropicRequest(
  snapshot: VersionSnapshot,
  settings: RowFormatSettings,
  policy: RepairPolicy,
  request: Readonly<Record<string, unknown>> & { readonly model: string },
  selection: Selection = {},
): Promise<StoredAnthropicRequestPlan> {
  snapshot.requireOpen();
  projectAnthropicUnit({ speaker: 'human', blocks: [] }, settings);
  if ((selection.from ?? 0) !== 0 || selection.to !== undefined)
    throw new JournalFormatError(
      'Anthropic selected-range planning is not implemented',
    );
  if ((selection.pendingInputCount ?? 0) !== 0)
    throw new JournalFormatError(
      'Anthropic pending-tail planning is not implemented',
    );
  if (request.model !== settings.model)
    throw new JournalFormatError(
      'Anthropic request model differs from measured settings',
    );
  if (request.messages !== undefined)
    throw new JournalFormatError(
      'Anthropic message overrides cannot use stored lengths',
    );
  const key = rowFormatKey(settings);
  const version = snapshot.version;
  const slot =
    version?.slots.formatSlots.findIndex(
      (format) =>
        format.summaryKind === 'anthropic' && format.formatKeyHash === key,
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
  let summary =
    version.rows === 0
      ? identitySlotSummary('anthropic')
      : decodeSlotSummary(version.aggregate.summaries[slot], format);
  const stripped = policy.includeInContext === false || policy.strip === 'all';
  if (!stripped && policy.strip === 'allButLast') {
    const metadata = await snapshot.formatAuxiliary(
      rowFormatAuxKey(slot, key, format.gen),
    );
    if (metadata === undefined)
      throw new JournalFormatError(
        'Anthropic last-kept aggregate is unmeasured',
      );
    summary = decodeSlotSummary(metadata, format);
  }
  if (summary.kind !== 'anthropic')
    throw new JournalFormatError('Missing stored Anthropic transfer');
  const measured = finalizeAnthropicTransfer(
    summary.variants[stripped ? 1 : 0],
    settings,
  );
  return Object.freeze({
    contentLength: requestLength(measured.bytes, request),
    messagesBytes: measured.bytes,
    messages: measured.messages,
    key,
    generation: format.gen,
    settings: captureRowFormatSettings(settings),
  });
}
