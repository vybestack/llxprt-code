/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { NativeFactIndexWriter } from '@vybestack/llxprt-code-core/journal/nativeFactIndex.js';
import type { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { AnthropicMessageBlock } from './AnthropicMessageNormalizer.js';
import { parseImageDimensionsFromBase64 } from '@vybestack/llxprt-code-tools/utils/imageDimensions.js';
import {
  anthropicBlockByteLength,
  anthropicMediaReference,
} from './anthropic-measured-media.js';
import {
  AnthropicStreamRepair,
  numericRepairPiece,
  type LazyRepairAtom,
} from './anthropic-stream-repair.js';
import type { RepairPiece } from './anthropic-repair-source.js';
import type { AnthropicAtom } from './anthropic-unit-facts.js';
import { writeAnthropicMeasurementFact } from './anthropic-measurement-facts.js';
import {
  estimatePieceFact,
  type EstimatePieceFact,
} from './anthropic-estimate-facts.js';
import type { AnthropicRequestRepairIndex } from './anthropic-repair-index.js';
import {
  addAnthropicCachePiece,
  beginAnthropicCacheAtom,
  type AnthropicCacheState,
} from './anthropic-cache-facts.js';

export interface RecoveryImageFact {
  readonly source: readonly number[];
  readonly position: readonly number[];
  readonly image: readonly number[];
}
export type RecoveryEvent =
  | { readonly kind: 'image'; readonly fact: RecoveryImageFact }
  | {
      readonly kind: 'run';
      readonly run: NonNullable<AnthropicCacheState['run']>;
    };

export function recoveryImageSize(
  block: AnthropicMessageBlock,
): readonly number[] | undefined {
  if (
    (block.type !== 'image' && block.type !== 'document') ||
    block.source.type !== 'base64'
  )
    return undefined;
  const reference = anthropicMediaReference(block);
  const dimensions =
    reference === undefined
      ? parseImageDimensionsFromBase64(block.source.data)
      : reference.dimensions;
  return [
    dimensions?.width ?? 0,
    dimensions?.height ?? 0,
    anthropicBlockByteLength(block),
  ];
}

function* imagesOf(
  block: AnthropicMessageBlock,
): Generator<{ readonly nested: number; readonly image: readonly number[] }> {
  if (block.type === 'tool_result' && Array.isArray(block.content)) {
    for (const [at, nested] of block.content.entries()) {
      const image = recoveryImageSize(nested);
      if (image !== undefined) yield { nested: at + 1, image };
    }
  } else {
    const image = recoveryImageSize(block);
    if (image !== undefined) yield { nested: 0, image };
  }
}

function* recoveryPieceEvents(
  atom: Pick<LazyRepairAtom, 'key' | 'role'>,
  pieceAt: number,
  piece: RepairPiece,
  initial: AnthropicCacheState,
  measured: AnthropicAtom = numericRepairPiece(piece, atom.role),
): Generator<RecoveryEvent, AnthropicCacheState> {
  if (typeof piece === 'string')
    return addAnthropicCachePiece(initial, measured);
  if (measured.form !== 'array') throw new Error('Expected block measurement');
  let state = initial;
  for (const [part, block] of piece.entries()) {
    const run = state.run;
    if (run === undefined) throw new Error('Missing Anthropic recovery run');
    const leading =
      atom.role === 'user'
        ? block.type === 'tool_result'
        : block.type === 'thinking' || block.type === 'redacted_thinking';
    for (const image of imagesOf(block))
      yield {
        kind: 'image',
        fact: {
          source: [atom.key, pieceAt, part, image.nested],
          position: [
            run.ordinal,
            run.blocks,
            leading ? run.leading : run.other,
            Number(leading),
          ],
          image: image.image,
        },
      };
    state = addAnthropicCachePiece(state, {
      role: atom.role,
      form: 'array',
      blocks: [measured.blocks[part]],
    });
  }
  return state;
}

export async function* anthropicRecoveryEvents(
  engine: AnthropicStreamRepair,
  initial: AnthropicCacheState = {},
  from = 0,
  to = Infinity,
): AsyncGenerator<RecoveryEvent> {
  let state = initial;
  for await (const atom of engine.atoms(from)) {
    if (atom.key >= to) break;
    if (state.run !== undefined && state.run.role !== atom.role)
      yield { kind: 'run', run: state.run };
    state = beginAnthropicCacheAtom(state, atom.role);
    let pieceAt = 0;
    for await (const piece of atom.openPieces())
      state = yield* recoveryPieceEvents(atom, pieceAt++, piece, state);
  }
  if (state.run !== undefined) yield { kind: 'run', run: state.run };
}

async function persistRecoveryPiece(
  writer: NativeFactIndexWriter,
  events: Generator<RecoveryEvent, AnthropicCacheState>,
  count: number,
): Promise<{ state: AnthropicCacheState; count: number }> {
  let event = events.next();
  while (event.done !== true) {
    if (event.value.kind === 'image') {
      await writer.set(['recovery-source', count], event.value.fact.source);
      await writer.set(['recovery-position', count], event.value.fact.position);
      await writer.set(['recovery-image', count++], event.value.fact.image);
    }
    event = events.next();
  }
  return { state: event.value, count };
}
export async function writeAnthropicRecoveryFacts(
  query: IndexedJournalRequestSnapshot,
  writer: NativeFactIndexWriter,
  settings: RowFormatSettings,
  index: AnthropicRequestRepairIndex,
  hasMedia: boolean,
  measurementsFrom?: number,
  observeRow?: (row: IContent, at: number) => Promise<void>,
): Promise<void> {
  let count = 0;
  const engine = await AnthropicStreamRepair.create(
    query,
    settings,
    {},
    index,
    observeRow,
  );
  let state: AnthropicCacheState = {};
  const saveRun = async (): Promise<void> => {
    if (hasMedia && state.run !== undefined)
      await writer.set(
        ['recovery-run', state.run.ordinal],
        [state.run.atoms, state.run.leading],
      );
  };
  for await (const atom of engine.atoms((measurementsFrom ?? 0) * 4)) {
    if (state.run !== undefined && state.run.role !== atom.role)
      await saveRun();
    state = beginAnthropicCacheAtom(state, atom.role);
    const kept: AnthropicAtom[] = [];
    const estimates: EstimatePieceFact[] = [];
    let pieceAt = 0;
    let thinking = atom.chain === true;
    for await (const piece of atom.openPieces(false)) {
      const fact = numericRepairPiece(piece, atom.role);
      kept.push(fact);
      estimates.push(await estimatePieceFact(piece, atom.role));
      thinking ||=
        typeof piece !== 'string' &&
        piece.some(
          (block) =>
            block.type === 'thinking' || block.type === 'redacted_thinking',
        );
      if (hasMedia) {
        const events = recoveryPieceEvents(atom, pieceAt, piece, state, fact);
        ({ state, count } = await persistRecoveryPiece(writer, events, count));
      }
      pieceAt++;
    }
    const stripped: AnthropicAtom[] = [];
    const strippedEstimates: EstimatePieceFact[] = [];
    if (thinking) {
      for await (const piece of atom.openPieces(true)) {
        stripped.push(numericRepairPiece(piece, atom.role));
        strippedEstimates.push(await estimatePieceFact(piece, atom.role));
      }
    }
    const assistantTail =
      !atom.repair && atom.role === 'assistant' && atom.end === query.count - 1;
    const chain =
      atom.chain === true ||
      (assistantTail &&
        (await engine.source.describe(atom.end ?? Math.floor(atom.key / 4)))
          ?.chain === true);
    await writeAnthropicMeasurementFact(writer, atom.key, {
      kept,
      stripped: thinking ? stripped : undefined,
      estimates,
      strippedEstimates: thinking ? strippedEstimates : undefined,
      chain,
    });
  }
  await saveRun();
  if (measurementsFrom === undefined)
    await writer.set(['recovery-images'], [count]);
}
