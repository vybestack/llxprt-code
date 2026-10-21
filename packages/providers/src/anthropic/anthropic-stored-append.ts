/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import type { Version } from '@vybestack/llxprt-code-core/journal/version.js';
import type { RowEntry } from '@vybestack/llxprt-code-core/journal/rowEntry.js';
import {
  rowFormatKey,
  type RowFormatFill,
  type RowFormatSettings,
  type RowLengthFacts,
} from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import {
  decodeSlotSummary,
  encodeSlotSummary,
  type AnthropicSummary,
} from '@vybestack/llxprt-code-core/journal/slotSummary.js';
import {
  composeSlotSummaries,
  identitySlotSummary,
} from '@vybestack/llxprt-code-core/journal/summaryComposition.js';
import { unitCount } from '@vybestack/llxprt-code-core/journal/unitContributions.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { anthropicRepairScope } from './anthropic-repair-index.js';
import {
  anthropicUnitFacts,
  type AnthropicUnitFacts,
} from './anthropic-unit-facts.js';
import { anthropicUnitTransfer } from './anthropic-unit-transfer.js';

function anthropic(
  summary: ReturnType<typeof identitySlotSummary>,
): AnthropicSummary {
  if (summary.kind !== 'anthropic')
    throw new JournalFormatError('Missing Anthropic transfer');
  return summary;
}
const compose = (
  left: AnthropicSummary,
  right: AnthropicSummary,
): AnthropicSummary => anthropic(composeSlotSummaries(left, right));
function selected(summary: AnthropicSummary, variant: 0 | 1): AnthropicSummary {
  return {
    ...summary,
    variants: [summary.variants[variant], summary.variants[variant]],
  };
}
function atoms(
  unit: AnthropicUnitFacts,
  continuation: boolean,
  variant: 0 | 1,
): AnthropicUnitFacts['atoms'][0] {
  if (continuation) return [unit.chain[variant]];
  return unit.speaker === 'ai' && unit.atoms[variant].length === 0
    ? [{ role: 'assistant', form: 'array', blocks: [] }]
    : unit.atoms[variant];
}
interface AppendState {
  readonly snapshot: VersionSnapshot;
  readonly settings: RowFormatSettings;
  readonly query: IndexedJournalRequestSnapshot;
  readonly identity: AnthropicSummary;
  corrected: AnthropicSummary;
  stripped: AnthropicSummary;
  chain: boolean;
  units: number;
  lastLabel: bigint;
}
async function measureAppend(
  state: AppendState,
  current: VersionSnapshot,
  entry: RowEntry,
): Promise<RowLengthFacts> {
  if (current !== state.snapshot || entry.label <= state.lastLabel)
    throw new JournalFormatError(
      'Append measurements must follow native row order',
    );
  let kept = state.identity;
  let removed = state.identity;
  let localCorrection = state.identity;
  const end = state.units + unitCount(entry);
  for (; state.units < end; state.units++) {
    const unit = anthropicUnitFacts(
      await state.query.readAt(state.units),
      state.settings,
    );
    if (unit === undefined) continue;
    const continuation = state.chain && unit.speaker === 'ai';
    const transfer = anthropicUnitTransfer(
      {
        ...unit,
        chainStart: false,
        hasThinking: false,
        atoms: [atoms(unit, continuation, 0), atoms(unit, continuation, 1)],
      },
      entry.label,
    );
    const withThinking = selected(transfer, 0);
    const withoutThinking = selected(transfer, 1);
    const startsThinking =
      !continuation && unit.speaker === 'ai' && unit.hasThinking;
    const chosen =
      startsThinking || continuation ? withThinking : withoutThinking;
    if (startsThinking) state.corrected = state.stripped;
    state.corrected = compose(state.corrected, chosen);
    state.stripped = compose(state.stripped, withoutThinking);
    kept = compose(kept, withThinking);
    removed = compose(removed, withoutThinking);
    localCorrection = compose(localCorrection, chosen);
    state.chain = continuation || unit.chainStart;
  }
  state.lastLabel = entry.label;
  const summary: AnthropicSummary = {
    ...state.identity,
    variants: [kept.variants[0], removed.variants[0]],
    cOut: [0, 0],
  };
  const lens = new Uint8Array(592);
  lens.set(encodeSlotSummary(summary));
  lens.set(encodeSlotSummary(localCorrection), 296);
  return { summary, lens };
}
export async function prepareAnthropicStoredAppend(
  snapshot: VersionSnapshot,
  settings: RowFormatSettings,
  previous: Version,
): Promise<RowFormatFill> {
  const slot = previous.slots.formatSlots.findIndex(
    (format) =>
      format.summaryKind === 'anthropic' &&
      format.formatKeyHash === rowFormatKey(settings),
  );
  if (slot < 0)
    throw new JournalFormatError(
      'Append requires the previous registered Anthropic format',
    );
  const format = previous.slots.formatSlots[slot];
  const identity = anthropic(identitySlotSummary('anthropic'));
  const base =
    previous.rows === 0
      ? identity
      : anthropic(
          decodeSlotSummary(previous.aggregate.summaries[slot], format),
        );
  const auxiliary =
    previous.rows === 0 ? undefined : await snapshot.formatAuxiliary(slot);
  if (previous.rows !== 0 && auxiliary === undefined)
    throw new JournalFormatError('Append requires measured last-kept facts');
  const facts = await snapshot.nativeFacts(anthropicRepairScope(settings));
  const tail = await facts.get(['append-base']);
  if (tail === undefined || tail.length !== 2)
    throw new JournalFormatError('Append requires native boundary facts');
  const query = await IndexedJournalRequestSnapshot.create(snapshot);
  const state: AppendState = {
    snapshot,
    settings,
    query,
    identity,
    corrected:
      auxiliary === undefined
        ? identity
        : anthropic(decodeSlotSummary(auxiliary, format)),
    stripped: selected(base, 1),
    chain: tail[0] !== 0,
    units: previous.aggregate.units,
    lastLabel: 0n,
  };
  return {
    measure: (current, entry) => measureAppend(state, current, entry),
    async finish() {
      if (state.units !== query.count)
        throw new JournalFormatError(
          'Append did not consume the new native units',
        );
      return encodeSlotSummary(state.corrected);
    },
    close: () => query.close(),
  };
}
