/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import {
  encodeSlotSummary,
  type AnthropicSummary,
} from '@vybestack/llxprt-code-core/journal/slotSummary.js';
import {
  composeSlotSummaries,
  identitySlotSummary,
} from '@vybestack/llxprt-code-core/journal/summaryComposition.js';
import { unitCount } from '@vybestack/llxprt-code-core/journal/unitContributions.js';
import type {
  RowFormatFill,
  RowFormatSettings,
  RowLengthFacts,
} from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { RowEntry } from '@vybestack/llxprt-code-core/journal/rowEntry.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import {
  AnthropicStreamRepair,
  numericRepairPiece,
  type LazyRepairAtom,
} from './anthropic-stream-repair.js';
import { anthropicUnitTransfer } from './anthropic-unit-transfer.js';
import {
  beginAnthropicCacheAtom,
  addAnthropicCachePiece,
  finishAnthropicCacheAtom,
  type AnthropicCacheFacts,
} from './anthropic-cache-facts.js';

function identity(): AnthropicSummary {
  const summary = identitySlotSummary('anthropic');
  if (summary.kind !== 'anthropic')
    throw new JournalFormatError('Missing Anthropic identity');
  return summary;
}
function compose(
  left: AnthropicSummary,
  right: AnthropicSummary,
): AnthropicSummary {
  const summary = composeSlotSummaries(left, right);
  if (summary.kind !== 'anthropic')
    throw new JournalFormatError('Missing Anthropic summary');
  return summary;
}
async function atomSummary(
  atom: LazyRepairAtom,
  redact: boolean,
  anchored: boolean,
  purge: boolean,
  observe: (fact: ReturnType<typeof numericRepairPiece>) => void,
): Promise<AnthropicSummary> {
  let summary = identity();
  let emitted = false;
  const add = (piece: Parameters<typeof numericRepairPiece>[0]): void => {
    const fact = numericRepairPiece(piece, atom.role, anchored, purge);
    observe(fact);
    summary = compose(
      summary,
      anthropicUnitTransfer(
        {
          speaker: atom.role === 'user' ? 'human' : 'ai',
          chainStart: false,
          hasThinking: false,
          atoms: [[fact], [fact]],
          chain: [fact, fact],
        },
        1n,
      ),
    );
  };
  for await (const piece of atom.openPieces(redact)) {
    emitted = true;
    add(piece);
  }
  if (!emitted) add([]);
  return summary;
}
interface FillState {
  readonly snapshot: VersionSnapshot;
  readonly settings: RowFormatSettings;
  readonly query: IndexedJournalRequestSnapshot;
  readonly engine: AnthropicStreamRepair;
  readonly iterator: AsyncGenerator<LazyRepairAtom>;
  pending: IteratorResult<LazyRepairAtom>;
  units: number;
  lastLabel: bigint;
  lastKept: AnthropicSummary;
  prefix: AnthropicSummary;
  cache: AnthropicCacheFacts;
  cachePrefix: AnthropicCacheFacts;
}
async function summaries(
  state: FillState,
  atom: LazyRepairAtom,
): Promise<{
  kept: AnthropicSummary;
  stripped: AnthropicSummary;
  corrected: AnthropicSummary;
}> {
  const corrected =
    Math.floor(atom.key / 4) === state.engine.tools.index.lastThinking;
  const anchored =
    state.settings.anthropic?.cacheFacts === true &&
    !atom.repair &&
    (await state.query.planAt(atom.end ?? Math.floor(atom.key / 4))).header
      .metadata?.cacheAnchor === true;
  const purge =
    !atom.repair &&
    (await state.query.planAt(atom.end ?? Math.floor(atom.key / 4))).header
      .metadata?.semanticMediaPurgeBoundary !== undefined;
  const chain =
    atom.chain === true ||
    (atom.role === 'assistant' &&
      atom.end === state.query.count - 1 &&
      (await state.engine.source.describe(atom.end))?.chain === true);
  const previous = state.cache;
  state.cache = {
    kept: beginAnthropicCacheAtom(state.cache.kept, atom.role, chain),
    stripped: beginAnthropicCacheAtom(state.cache.stripped, atom.role, chain),
    corrected: beginAnthropicCacheAtom(state.cache.corrected, atom.role, chain),
  };
  const kept = await atomSummary(atom, false, anchored, purge, (fact) => {
    state.cache = {
      ...state.cache,
      kept: addAnthropicCachePiece(state.cache.kept, fact),
      corrected: corrected
        ? addAnthropicCachePiece(state.cache.corrected, fact)
        : state.cache.corrected,
    };
  });
  const stripped = await atomSummary(atom, true, anchored, purge, (fact) => {
    state.cache = {
      ...state.cache,
      stripped: addAnthropicCachePiece(state.cache.stripped, fact),
      corrected: !corrected
        ? addAnthropicCachePiece(state.cache.corrected, fact)
        : state.cache.corrected,
    };
  });
  const before = (name: keyof AnthropicCacheFacts): number =>
    previous[name].run?.role === atom.role ? previous[name].run.blocks : 0;
  state.cache = {
    kept: finishAnthropicCacheAtom(state.cache.kept, anchored, before('kept')),
    stripped: finishAnthropicCacheAtom(
      state.cache.stripped,
      anchored,
      before('stripped'),
    ),
    corrected: finishAnthropicCacheAtom(
      state.cache.corrected,
      anchored,
      before('corrected'),
    ),
  };
  return { kept, stripped, corrected: corrected ? kept : stripped };
}
async function measureFill(
  state: FillState,
  current: VersionSnapshot,
  entry: RowEntry,
): Promise<RowLengthFacts> {
  if (current !== state.snapshot || entry.label <= state.lastLabel)
    throw new JournalFormatError(
      'Anthropic stored fill requires one ordered native row traversal',
    );
  const end = state.units + unitCount(entry);
  let kept = identity();
  let stripped = identity();
  let corrected = identity();
  state.cachePrefix = state.cache;
  while (state.pending.done !== true && state.pending.value.key < end * 4) {
    const atom = state.pending.value;
    if (atom.key < state.units * 4)
      throw new JournalFormatError(
        'Anthropic stored atom precedes its source row',
      );
    const next = await summaries(state, atom);
    kept = compose(kept, next.kept);
    stripped = compose(stripped, next.stripped);
    corrected = compose(corrected, next.corrected);
    state.pending = await state.iterator.next();
  }
  state.units = end;
  state.lastLabel = entry.label;
  state.prefix = state.lastKept;
  state.lastKept = compose(state.lastKept, corrected);
  const summary: AnthropicSummary = {
    kind: 'anthropic',
    variants: [kept.variants[0], stripped.variants[0]],
    cOut: [0, 0],
    lastL: [0n, 0n],
  };
  const lens = new Uint8Array(592);
  lens.set(encodeSlotSummary(summary));
  lens.set(encodeSlotSummary(corrected), 296);
  return { summary, lens };
}
export function anthropicAuxiliary(
  lastKept: AnthropicSummary,
  prefix: AnthropicSummary,
  cache?: { current: AnthropicCacheFacts; prefix: AnthropicCacheFacts },
): Uint8Array {
  const extra =
    cache === undefined
      ? new Uint8Array()
      : new TextEncoder().encode(JSON.stringify(cache));
  const auxiliary = new Uint8Array(592 + extra.length);
  auxiliary.set(encodeSlotSummary(lastKept));
  auxiliary.set(encodeSlotSummary(prefix), 296);
  auxiliary.set(extra, 592);
  return auxiliary;
}
export async function prepareAnthropicStoredFill(
  snapshot: VersionSnapshot,
  settings: RowFormatSettings,
): Promise<RowFormatFill> {
  const query = await IndexedJournalRequestSnapshot.create(snapshot);
  try {
    const engine = await AnthropicStreamRepair.create(query, settings);
    const iterator = engine.atoms();
    const emptyCache = { kept: {}, stripped: {}, corrected: {} };
    const state: FillState = {
      snapshot,
      settings,
      query,
      engine,
      iterator,
      pending: await iterator.next(),
      units: 0,
      lastLabel: 0n,
      lastKept: identity(),
      prefix: identity(),
      cache: emptyCache,
      cachePrefix: emptyCache,
    };
    return {
      measure: (current, entry) => measureFill(state, current, entry),
      async finish() {
        if (state.pending.done !== true || state.units !== query.count)
          throw new JournalFormatError(
            'Anthropic stored fill did not consume the complete native contribution stream',
          );
        return anthropicAuxiliary(
          state.lastKept,
          state.prefix,
          settings.anthropic?.cacheFacts === true
            ? { current: state.cache, prefix: state.cachePrefix }
            : undefined,
        );
      },
      async close() {
        try {
          await iterator.return(undefined);
        } finally {
          await query.close();
        }
      },
    };
  } catch (error) {
    await query.close();
    throw error;
  }
}
