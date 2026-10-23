/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
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
): Generator<RecoveryEvent, AnthropicCacheState> {
  if (typeof piece === 'string')
    return addAnthropicCachePiece(
      initial,
      numericRepairPiece(piece, atom.role),
    );
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
    state = addAnthropicCachePiece(
      state,
      numericRepairPiece([block], atom.role),
    );
  }
  return state;
}

export async function* anthropicRecoveryEvents(
  engine: AnthropicStreamRepair,
  initial: AnthropicCacheState = {},
  from = 0,
): AsyncGenerator<RecoveryEvent> {
  let state = initial;
  for await (const atom of engine.atoms(from)) {
    if (state.run !== undefined && state.run.role !== atom.role)
      yield { kind: 'run', run: state.run };
    state = beginAnthropicCacheAtom(state, atom.role);
    let pieceAt = 0;
    for await (const piece of atom.openPieces())
      state = yield* recoveryPieceEvents(atom, pieceAt++, piece, state);
  }
  if (state.run !== undefined) yield { kind: 'run', run: state.run };
}

export async function writeAnthropicRecoveryFacts(
  query: IndexedJournalRequestSnapshot,
  writer: NativeFactIndexWriter,
  settings: RowFormatSettings,
  index: AnthropicRequestRepairIndex,
  hasMedia: boolean,
): Promise<void> {
  let count = 0;
  if (hasMedia) {
    const engine = await AnthropicStreamRepair.create(
      query,
      settings,
      {},
      index,
    );
    for await (const event of anthropicRecoveryEvents(engine)) {
      if (event.kind === 'run') {
        await writer.set(
          ['recovery-run', event.run.ordinal],
          [event.run.atoms, event.run.leading],
        );
      } else {
        await writer.set(['recovery-source', count], event.fact.source);
        await writer.set(['recovery-position', count], event.fact.position);
        await writer.set(['recovery-image', count++], event.fact.image);
      }
    }
  }
  await writer.set(['recovery-images'], [count]);
}
