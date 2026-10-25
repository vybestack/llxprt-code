/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import {
  composeSlotSummaries,
  identitySlotSummary,
} from '@vybestack/llxprt-code-core/journal/summaryComposition.js';
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import {
  AnthropicRepairSource,
  type AnthropicRepairRows,
  type RepairMessage,
  type RepairPiece,
  type RepairPolicy,
} from './anthropic-repair-source.js';
import { AnthropicToolRepair } from './anthropic-tool-repair.js';
import {
  AnthropicRepairIndex,
  anthropicRepairScope,
  type AnthropicRequestRepairIndex,
} from './anthropic-repair-index.js';
import {
  anthropicUnitTransfer,
  finalizeAnthropicTransfer,
  type AnthropicAtom,
} from './anthropic-unit-transfer.js';
import { getEmptyMessagePlaceholder } from './AnthropicMessageValidator.js';
import { projectAnthropicUnit } from './anthropic-unit-facts.js';
import {
  anthropicBlockByteLength,
  copyAnthropicWireMedia,
} from './anthropic-measured-media.js';
import type { MediaStage } from './native-anthropic-media-stage.js';
import type { ImageDimensionBudget } from '@vybestack/llxprt-code-tools/utils/imageDimensionBudget.js';
import {
  readPurgeBlockTag,
  tagMediaPurgeBoundaryBlock,
} from './AnthropicMediaPurgeCache.js';
import {
  resolveAnthropicWireMedia,
  type AnthropicWirePiece,
} from './anthropic-wire-media.js';
import { modelSupportsPrefill } from './AnthropicModelData.js';
import { readAnchorBlockTag } from './AnthropicAnchorCache.js';
import {
  selectLastCacheableBlockIndex,
  sanitizeBlockForCacheControl,
} from './AnthropicRequestBuilder.js';
import {
  hasAnthropicCacheTarget,
  type AnthropicCachePlan,
} from './anthropic-cache-facts.js';
import type {
  AnthropicMessageBlock,
  AnthropicMessage,
} from './AnthropicMessageNormalizer.js';

export interface LazyRepairAtom {
  readonly key: number;
  readonly end?: number;
  readonly chain?: boolean;
  readonly role: 'assistant' | 'user';
  readonly repair: boolean;
  readonly results?: boolean;
  openPieces(redact?: boolean): AsyncGenerator<RepairPiece>;
}
interface Run {
  readonly atom: LazyRepairAtom;
  readonly start: number;
  readonly end: number;
  readonly role: 'assistant' | 'user';
  readonly merged: boolean;
}
const jsonBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value));
const leading = (block: AnthropicMessageBlock, role: Run['role']): boolean =>
  role === 'user'
    ? block.type === 'tool_result'
    : block.type === 'thinking' || block.type === 'redacted_thinking';

export function numericRepairPiece(
  piece: RepairPiece,
  role: Run['role'],
  anchoredString = false,
  purgeString = false,
): AnthropicAtom {
  return typeof piece === 'string'
    ? {
        role,
        form: 'string',
        bytes: jsonBytes(piece),
        blank: piece.trim() === '',
        anchored: anchoredString,
        purge: purgeString,
      }
    : {
        role,
        form: 'array',
        blocks: piece.map((block) => ({
          kind: block.type,
          bytes: anthropicBlockByteLength(block),
          blank: block.type === 'text' && block.text.trim() === '',
          anchored: readAnchorBlockTag(block),
          purge: readPurgeBlockTag(block) !== undefined,
          cacheable: selectLastCacheableBlockIndex([block]) === 0,
        })),
      };
}

export class AnthropicStreamRepair<
  Query extends AnthropicRepairRows = IndexedJournalRequestSnapshot,
> {
  private constructor(
    readonly source: AnthropicRepairSource<Query>,
    readonly tools: AnthropicToolRepair<Query>,
    readonly policy: RepairPolicy,
    readonly lastThinking: number,
  ) {}
  static async create(
    query: IndexedJournalRequestSnapshot,
    settings: RowFormatSettings,
    policy: RepairPolicy = {},
    preparedIndex?: AnthropicRequestRepairIndex,
  ): Promise<AnthropicStreamRepair> {
    projectAnthropicUnit({ speaker: 'human', blocks: [] }, settings);
    const index =
      preparedIndex ??
      (await AnthropicRepairIndex.read(
        await query.nativeFacts(anthropicRepairScope(settings)),
      ));
    const source = new AnthropicRepairSource(query, settings, index);
    const last =
      policy.strip === 'allButLast' && policy.includeInContext !== false
        ? await source.lastThinking()
        : -1;
    return new AnthropicStreamRepair(
      source,
      new AnthropicToolRepair(source, index),
      { ...policy },
      last,
    );
  }
  static async fromSource<Query extends AnthropicRepairRows>(
    source: AnthropicRepairSource<Query>,
    index: AnthropicRequestRepairIndex,
    policy: RepairPolicy,
  ): Promise<AnthropicStreamRepair<Query>> {
    return new AnthropicStreamRepair(
      source,
      new AnthropicToolRepair(source, index),
      policy,
      policy.strip === 'allButLast' && policy.includeInContext !== false
        ? await source.lastThinking()
        : -1,
    );
  }
  private redact(message: RepairMessage): boolean {
    return (
      this.policy.includeInContext === false ||
      this.policy.strip === 'all' ||
      (this.policy.strip === 'allButLast' &&
        message.start !== this.lastThinking)
    );
  }
  async *atoms(from = 0): AsyncGenerator<LazyRepairAtom> {
    for await (const message of this.source.messages(Math.floor(from / 4))) {
      const key = message.start * 4 + Number(message.slot !== 'results');
      const exists =
        message.kept ??
        (message.slot !== 'results' || (await this.tools.hasKept(message)));
      if (exists && key >= from)
        yield {
          key,
          end: message.end,
          chain: message.slot === 'chain',
          role: message.role,
          repair: false,
          results: message.slot === 'results',
          openPieces: (redact = this.redact(message)) =>
            this.tools.kept(message, redact),
        };
      if (message.role !== 'assistant') continue;
      let inserted = message.inserts ?? false;
      if (message.inserts === undefined)
        for await (const _block of this.tools.scripts(message)) {
          inserted = true;
          break;
        }
      if (inserted && message.start * 4 + 2 >= from) {
        const tools = this.tools;
        yield {
          key: message.start * 4 + 2,
          role: 'user',
          repair: true,
          async *openPieces() {
            for await (const block of tools.insertions(message)) yield [block];
          },
        };
      }
    }
  }
  async measure(): Promise<{
    readonly bytes: number;
    readonly messages: number;
  }> {
    let summary = identitySlotSummary('anthropic');
    let label = 0n;
    for await (const atom of this.atoms()) {
      let emitted = false;
      for await (const piece of atom.openPieces()) {
        emitted = true;
        const fact = numericRepairPiece(piece, atom.role);
        summary = composeSlotSummaries(
          summary,
          anthropicUnitTransfer(
            {
              speaker: atom.role === 'user' ? 'human' : 'ai',
              chainStart: false,
              hasThinking: false,
              atoms: [[fact], [fact]],
              chain: [fact, fact],
            },
            ++label,
          ),
        );
      }
      if (!emitted) {
        const fact = numericRepairPiece([], atom.role);
        summary = composeSlotSummaries(
          summary,
          anthropicUnitTransfer(
            {
              speaker: atom.role === 'user' ? 'human' : 'ai',
              chainStart: false,
              hasThinking: false,
              atoms: [[fact], [fact]],
              chain: [fact, fact],
            },
            ++label,
          ),
        );
      }
    }
    if (summary.kind !== 'anthropic')
      throw new JournalFormatError('Missing Anthropic repair transfer');
    return finalizeAnthropicTransfer(summary.variants[0], this.source.settings);
  }
  private async *runs(): AsyncGenerator<Run> {
    let start: LazyRepairAtom | undefined;
    let end = -1;
    let count = 0;
    for await (const atom of this.atoms()) {
      if (start !== undefined && start.role !== atom.role) {
        yield {
          atom: start,
          start: start.key,
          end,
          role: start.role,
          merged: count > 1,
        };
        start = undefined;
        count = 0;
      }
      start ??= atom;
      end = atom.key;
      count++;
    }
    if (start !== undefined)
      yield {
        atom: start,
        start: start.key,
        end,
        role: start.role,
        merged: count > 1,
      };
  }
  private async *runPieces(run: Run): AsyncGenerator<RepairPiece> {
    for await (const atom of this.atoms(run.start)) {
      if (atom.key > run.end) break;
      yield* atom.openPieces();
    }
  }
  private async shape(
    run: Run,
  ): Promise<{ readonly blocks: number; readonly string: boolean }> {
    let blocks = 0;
    let string = false;
    for await (const piece of this.runPieces(run)) {
      const kept =
        typeof piece === 'string'
          ? Number(piece.trim() !== '')
          : piece.filter(
              (block) => block.type !== 'text' || block.text.trim() !== '',
            ).length;
      blocks += kept;
      if (typeof piece === 'string' && kept > 0) string = !run.merged;
    }
    return { blocks, string };
  }
  private async *runBlocks(
    run: Run,
    pass: number,
  ): AsyncGenerator<AnthropicMessageBlock> {
    for await (const piece of this.runPieces(run)) {
      const values: readonly AnthropicMessageBlock[] =
        typeof piece === 'string' ? [{ type: 'text', text: piece }] : piece;
      for (const block of values) {
        const blank = block.type === 'text' && block.text.trim() === '';
        if (
          !blank &&
          (!run.merged || Number(!leading(block, run.role)) === pass)
        )
          yield block;
      }
    }
  }
  private async *taggedRunBlocks(
    run: Run,
  ): AsyncGenerator<AnthropicMessageBlock> {
    for await (const atom of this.atoms(run.start)) {
      if (atom.key > run.end) break;
      for await (const piece of atom.openPieces())
        yield* typeof piece === 'string'
          ? [await this.taggedText(atom, piece)]
          : piece;
    }
  }
  private async taggedText(
    atom: LazyRepairAtom,
    text: string,
  ): Promise<AnthropicMessageBlock> {
    const block: AnthropicMessageBlock = { type: 'text', text };
    if (atom.repair) return block;
    const row = await this.source.query.readAt(
      atom.end ?? Math.floor(atom.key / 4),
    );
    const tag = row.metadata?.semanticMediaPurgeBoundary;
    if (tag?.blockIndex === row.blocks.length - 1)
      tagMediaPurgeBoundaryBlock(block, tag.boundaryId);
    return block;
  }
  private async *orderedTaggedBlocks(
    run: Run,
  ): AsyncGenerator<AnthropicMessageBlock> {
    for (let pass = 0; pass < (run.merged ? 2 : 1); pass++)
      for await (const block of this.taggedRunBlocks(run))
        if (
          (block.type !== 'text' || block.text.trim() !== '') &&
          (!run.merged || Number(!leading(block, run.role)) === pass)
        )
          yield block;
  }
  async *cacheBlocks(): AsyncGenerator<{
    readonly target: AnthropicCachePlan['targets'][number];
    readonly block: AnthropicMessageBlock;
    readonly purge: object | undefined;
  }> {
    let ordinal = 0;
    for await (const run of this.runs()) {
      const shape = await this.shape(run);
      let blockIndex = 0;
      for await (const block of this.orderedTaggedBlocks(run))
        yield {
          target: { run: ordinal, block: blockIndex++, string: shape.string },
          block,
          purge: readPurgeBlockTag(block),
        };
      ordinal++;
    }
  }
  private cachedText(
    text: string,
    run: number,
    cache?: AnthropicCachePlan,
  ): unknown {
    return cache !== undefined && hasAnthropicCacheTarget(cache, run, 0)
      ? [sanitizeBlockForCacheControl({ type: 'text', text }, cache.ttl)]
      : text;
  }
  private async *singleRowContent(
    run: Run,
    transform: (value: unknown) => unknown,
    ordinal: number,
    cache: AnthropicCachePlan | undefined,
  ): AsyncGenerator<AnthropicWirePiece> {
    for await (const piece of run.atom.openPieces()) {
      if (typeof piece === 'string') {
        yield JSON.stringify(
          transform(
            this.cachedText(
              piece.trim() === ''
                ? getEmptyMessagePlaceholder(run.role)
                : piece,
              ordinal,
              cache,
            ),
          ),
        );
        return;
      }
      const blocks = piece.filter(
        (block) => block.type !== 'text' || block.text.trim() !== '',
      );
      if (blocks.length === 0) break;
      yield '[';
      for (let at = 0; at < blocks.length; at++) {
        if (at > 0) yield ',';
        const block = blocks[at];
        const value =
          cache !== undefined && hasAnthropicCacheTarget(cache, ordinal, at)
            ? sanitizeBlockForCacheControl(block, cache.ttl)
            : block;
        copyAnthropicWireMedia(block, value);
        yield value;
      }
      yield ']';
      return;
    }
    yield JSON.stringify(
      transform(
        this.cachedText(getEmptyMessagePlaceholder(run.role), ordinal, cache),
      ),
    );
  }
  private async *content(
    run: Run,
    transform: (value: unknown) => unknown,
    ordinal: number,
    cache?: AnthropicCachePlan,
  ): AsyncGenerator<AnthropicWirePiece> {
    if (
      !run.merged &&
      !run.atom.repair &&
      run.atom.chain !== true &&
      run.atom.end === Math.floor(run.start / 4)
    ) {
      yield* this.singleRowContent(run, transform, ordinal, cache);
      return;
    }
    const shape = await this.shape(run);
    if (shape.blocks === 0) {
      yield JSON.stringify(
        transform(
          this.cachedText(getEmptyMessagePlaceholder(run.role), ordinal, cache),
        ),
      );
      return;
    }
    if (shape.string) {
      for await (const piece of this.runPieces(run))
        if (typeof piece === 'string')
          yield JSON.stringify(
            transform(this.cachedText(piece, ordinal, cache)),
          );
      return;
    }
    yield '[';
    let comma = '';
    let blockOrdinal = 0;
    for (let pass = 0; pass < (run.merged ? 2 : 1); pass++) {
      for await (const block of this.runBlocks(run, pass)) {
        const value =
          cache !== undefined &&
          hasAnthropicCacheTarget(cache, ordinal, blockOrdinal++)
            ? sanitizeBlockForCacheControl(block, cache.ttl)
            : block;
        copyAnthropicWireMedia(block, value);
        yield comma;
        yield value;
        comma = ',';
      }
    }
    yield ']';
  }
  async *serialize(
    transform: (value: unknown) => unknown = (value) => value,
    prefix?: AnthropicMessage,
    cache?: AnthropicCachePlan,
    mediaStage?: MediaStage,
    recoveryBudget?: ImageDimensionBudget,
  ): AsyncGenerator<string> {
    for await (const piece of resolveAnthropicWireMedia(
      this.serializePieces(transform, prefix, cache),
      mediaStage,
      recoveryBudget,
    ))
      yield typeof piece === 'string'
        ? piece
        : JSON.stringify(transform(piece));
  }
  wirePieces(
    prefix?: AnthropicMessage,
    cache?: AnthropicCachePlan,
    mediaStage?: MediaStage,
    recoveryBudget?: ImageDimensionBudget,
  ): AsyncIterable<AnthropicWirePiece> {
    return resolveAnthropicWireMedia(
      this.serializePieces((value) => value, prefix, cache),
      mediaStage,
      recoveryBudget,
    );
  }
  private async *serializePieces(
    transform: (value: unknown) => unknown,
    prefix?: AnthropicMessage,
    cache?: AnthropicCachePlan,
  ): AsyncGenerator<AnthropicWirePiece> {
    yield '[';
    if (prefix !== undefined) yield JSON.stringify(transform(prefix)) + ',';
    let count = 0;
    let ordinal = 0;
    let last: Run['role'] | undefined;
    for await (const run of this.runs()) {
      if (count === 0 && run.role !== 'user') {
        yield JSON.stringify({
          role: 'user',
          content: 'Continue the conversation',
        });
        count++;
      }
      yield (count++ === 0 ? '' : ',') +
        '{"role":' +
        JSON.stringify(run.role) +
        ',"content":';
      yield* this.content(run, transform, ordinal++, cache);
      yield '}';
      last = run.role;
    }
    if (count === 0)
      yield JSON.stringify(
        transform({
          role: 'user',
          content: this.cachedText('Hello', -1, cache),
        }),
      );
    if (
      last === 'assistant' &&
      (this.source.settings.reasoningEnabled ||
        !modelSupportsPrefill(this.source.settings.model))
    )
      yield ',' +
        JSON.stringify(
          transform({
            role: 'user',
            content: this.cachedText('Continue the conversation', -1, cache),
          }),
        );
    yield ']';
  }
}

export function withAnthropicStreamRepair<T>(
  query: IndexedJournalRequestSnapshot,
  settings: RowFormatSettings,
  policy: RepairPolicy,
  consume: (engine: AnthropicStreamRepair) => T | Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const captured = structuredClone(settings);
  const capturedPolicy = { ...policy };
  return query.withHeld(
    async (view) =>
      consume(
        await AnthropicStreamRepair.create(view, captured, capturedPolicy),
      ),
    signal,
  );
}
