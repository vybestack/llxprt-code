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
import {
  beginAnthropicCacheAtom,
  addAnthropicCachePiece,
  finishAnthropicCacheAtom,
  readAnthropicCacheFacts,
  type AnthropicCacheFacts,
  type AnthropicCacheState,
} from './anthropic-cache-facts.js';
import { anthropicAuxiliary } from './anthropic-stored-fill.js';

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
  prefix: AnthropicSummary;
  stripped: AnthropicSummary;
  chain: boolean;
  units: number;
  lastLabel: bigint;
  cache: AnthropicCacheFacts;
  cachePrefix: AnthropicCacheFacts;
}
function appendCachePieces(
  state: AnthropicCacheState,
  pieces: AnthropicUnitFacts['atoms'][0],
  chain: boolean,
  anchored: boolean,
): AnthropicCacheState {
  let next = state;
  for (const [index, piece] of pieces.entries()) {
    const before = next.run?.role === piece.role ? next.run.blocks : 0;
    next = addAnthropicCachePiece(
      beginAnthropicCacheAtom(next, piece.role, chain),
      piece,
    );
    next = finishAnthropicCacheAtom(
      next,
      anchored && index === pieces.length - 1,
      before,
    );
  }
  return next;
}
function appendCache(
  state: AppendState,
  unit: AnthropicUnitFacts,
  continuation: boolean,
  startsThinking: boolean,
  anchored: boolean,
): void {
  const kept = atoms(unit, continuation, 0);
  const stripped = atoms(unit, continuation, 1);
  const corrected = startsThinking
    ? state.cache.stripped
    : state.cache.corrected;
  state.cache = {
    kept: appendCachePieces(
      state.cache.kept,
      kept,
      continuation || unit.chainStart,
      anchored,
    ),
    stripped: appendCachePieces(
      state.cache.stripped,
      stripped,
      continuation || unit.chainStart,
      anchored,
    ),
    corrected: appendCachePieces(
      corrected,
      startsThinking || continuation ? kept : stripped,
      continuation || unit.chainStart,
      anchored,
    ),
  };
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
  state.prefix = state.corrected;
  state.cachePrefix = state.cache;
  let kept = state.identity;
  let removed = state.identity;
  let localCorrection = state.identity;
  const end = state.units + unitCount(entry);
  for (; state.units < end; state.units++) {
    const row = await state.query.readAt(state.units);
    const unit = anthropicUnitFacts(row, state.settings);
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
    appendCache(
      state,
      unit,
      continuation,
      startsThinking,
      row.metadata?.cacheAnchor === true,
    );
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
async function finishAppend(state: AppendState): Promise<Uint8Array> {
  if (state.units !== state.query.count)
    throw new JournalFormatError('Append did not consume the new native units');
  return anthropicAuxiliary(
    state.corrected,
    state.prefix,
    state.settings.anthropic?.cacheFacts === true
      ? { current: state.cache, prefix: state.cachePrefix }
      : undefined,
  );
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
  const rewind = (await facts.get(['append-rewind']))?.[0] ?? 0;
  if (rewind !== 0 && (auxiliary === undefined || auxiliary.length < 592))
    throw new JournalFormatError('Tool append requires measured holder prefix');
  const prefixOffset = rewind === 0 ? 0 : 296;
  const corrected =
    auxiliary === undefined
      ? identity
      : anthropic(
          decodeSlotSummary(
            auxiliary.subarray(prefixOffset, prefixOffset + 296),
            format,
          ),
        );
  const cacheSource = rewind === 0 ? 'current' : 'prefix';
  const cache =
    settings.anthropic?.cacheFacts === true && auxiliary !== undefined
      ? readAnthropicCacheFacts(auxiliary)[cacheSource]
      : { kept: {}, stripped: {}, corrected: {} };
  const query = await IndexedJournalRequestSnapshot.create(snapshot);
  const state: AppendState = {
    snapshot,
    settings,
    query,
    identity,
    corrected,
    prefix: corrected,
    stripped: selected(base, 1),
    chain: tail[0] !== 0,
    units: rewind === 0 ? previous.aggregate.units : rewind - 1,
    lastLabel: 0n,
    cache,
    cachePrefix: cache,
  };
  return {
    measure: (current, entry) => measureAppend(state, current, entry),
    finish: () => finishAppend(state),
    close: () => query.close(),
  };
}
