/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import {
  captureRowFormatSettings,
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
import { prepareAnthropicStoredAppend } from './anthropic-stored-append.js';
import { anthropicRepairScope } from './anthropic-repair-index.js';
import { jsonValueByteLength } from '../utils/progressive-json-body.js';

export function anthropicLengthRegistration(
  input: RowFormatSettings,
): RowFormatRegistration {
  const settings = captureRowFormatSettings(input);
  projectAnthropicUnit({ speaker: 'human', blocks: [] }, settings);
  return {
    settings,
    incremental: 'append',
    nativeFactScope: anthropicRepairScope(settings),
    prepare: prepareAnthropicStoredFill,
    prepareAppend: prepareAnthropicStoredAppend,
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

type RequestEnvelope = Readonly<Record<string, unknown>> & {
  readonly model: string;
};

export async function planStoredAnthropicRequest(
  snapshot: VersionSnapshot,
  input: RowFormatSettings,
  policy: RepairPolicy,
  request: RequestEnvelope,
  selection: Selection = {},
): Promise<StoredAnthropicRequestPlan> {
  const settings = captureRowFormatSettings(input);
  if (
    (policy.strip !== undefined &&
      !['none', 'all', 'allButLast'].includes(policy.strip)) ||
    (policy.includeInContext !== undefined &&
      typeof policy.includeInContext !== 'boolean')
  )
    throw new JournalFormatError('Unsupported Anthropic thinking policy');
  const envelopeBytes = requestLength(0, request);
  const release = snapshot.hold();
  try {
    return await planPinned(
      snapshot,
      settings,
      { ...policy },
      request,
      { ...selection },
      envelopeBytes,
    );
  } finally {
    await release();
  }
}

async function planPinned(
  snapshot: VersionSnapshot,
  settings: RowFormatSettings,
  policy: RepairPolicy,
  request: RequestEnvelope,
  selection: Selection,
  envelopeBytes: number,
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
  const metadata = await snapshot.formatAuxiliary(slot);
  if (metadata === undefined)
    throw new JournalFormatError('Anthropic last-kept aggregate is unmeasured');
  if (!stripped && policy.strip === 'allButLast')
    summary = decodeSlotSummary(metadata, format);
  if (summary.kind !== 'anthropic')
    throw new JournalFormatError('Missing stored Anthropic transfer');
  const measured = finalizeAnthropicTransfer(
    summary.variants[stripped ? 1 : 0],
    settings,
  );
  return Object.freeze({
    contentLength: measured.bytes + envelopeBytes,
    messagesBytes: measured.bytes,
    messages: measured.messages,
    key,
    generation: format.gen,
    settings: captureRowFormatSettings(settings),
  });
}
