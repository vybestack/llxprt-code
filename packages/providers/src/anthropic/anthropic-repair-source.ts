/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  ContentBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { normalizeToAnthropicToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import { projectAnthropicUnit } from './anthropic-unit-facts.js';
import type { AnthropicRequestRepairIndex } from './anthropic-repair-index.js';
import {
  convertContentToMessages,
  convertBlockToAnthropicPart,
  type AnthropicMessageBlock,
  type AnthropicMessage,
} from './AnthropicMessageNormalizer.js';
import type { AnthropicMessageConversionOptions } from './AnthropicMessageConversionOptions.js';
import {
  rawChainResults,
  rawChainWireResults,
} from './raw-anthropic-chain-results.js';
import {
  tagAnchorMessage,
  clearAnchorBlockTag,
} from './AnthropicAnchorCache.js';
import { unprefixAnthropicToolName } from './schemaConverter.js';

export interface RepairMessage {
  readonly start: number;
  readonly end: number;
  readonly slot: 'results' | 'content' | 'chain';
  readonly chainResults?: true;
  readonly role: AnthropicMessage['role'];
}
export type RepairPiece = string | readonly AnthropicMessageBlock[];
export interface RepairPolicy {
  readonly includeInContext?: boolean;
  readonly strip?: 'none' | 'all' | 'allButLast';
}
interface UnitDescription {
  readonly speaker: IContent['speaker'];
  readonly results: boolean;
  readonly content: boolean;
  readonly chain: boolean;
  readonly thinking: boolean;
}
const logger = { debug: (): void => undefined };
function priority(block: ContentBlock): number {
  if (block.type === 'thinking' && block.sourceField === 'thinking') return 0;
  if (block.type === 'text' || block.type === 'code') return 1;
  return block.type === 'tool_call' ? 3 : 2;
}
function chainStart(row: IContent, enabled: boolean): boolean {
  return (
    enabled &&
    row.speaker === 'ai' &&
    row.blocks.length > 0 &&
    row.blocks.every(
      (block) => block.type === 'thinking' && block.sourceField === 'thinking',
    )
  );
}

export type AnthropicRepairRows = Pick<
  IndexedJournalRequestSnapshot,
  'count' | 'normalizedCount' | 'normalizedPosition'
> &
  Pick<ProviderRequestRows, 'readAt'> & {
    readonly rawDump?: boolean;
    rawResultsAt?(at: number): Promise<RepairMessage | undefined>;
    rawChainAt?(
      at: number,
    ): Promise<{ readonly start: number; readonly end: number } | undefined>;
  };

export class AnthropicRepairSource<
  Query extends AnthropicRepairRows = IndexedJournalRequestSnapshot,
> {
  readonly options: AnthropicMessageConversionOptions;
  readonly work = {
    unitReads: 0,
    groupSearchUnits: 0,
    descriptions: 0,
    messageWalks: 0,
    groupQueries: 0,
    chainSearchUnits: 0,
  };
  constructor(
    readonly query: Query,
    readonly settings: RowFormatSettings,
    readonly index?: AnthropicRequestRepairIndex,
    private readonly observeRow?: (row: IContent, at: number) => Promise<void>,
    private readonly normalized = true,
  ) {
    this.options = {
      isOAuth: settings.isOAuth,
      reasoningEnabled: settings.reasoningEnabled,
      supportsUrlImages: settings.supportsUrlImages,
      config: settings.outputLimits ?? undefined,
      unprefixToolName: unprefixAnthropicToolName,
      logger,
    };
  }
  async row(index: number): Promise<IContent | undefined> {
    this.work.unitReads++;
    const row = await this.query.readAt(index);
    await this.observeRow?.(row, index);
    return projectAnthropicUnit(row, this.settings, this.normalized);
  }
  async describe(index: number): Promise<UnitDescription | undefined> {
    this.work.descriptions++;
    const row = await this.row(index);
    if (row === undefined) return undefined;
    const results = row.blocks.some((block) => block.type === 'tool_response');
    const onlyResults =
      results &&
      row.blocks.every(
        (block) =>
          block.type === 'tool_response' ||
          block.type === 'text' ||
          block.type === 'code',
      );
    const content =
      row.speaker === 'ai' ||
      (row.speaker === 'human' &&
        !onlyResults &&
        convertContentToMessages([row], new Set(), this.options).length >
          Number(results));
    return {
      speaker: row.speaker,
      results,
      content,
      chain: chainStart(row, this.settings.reasoningEnabled),
      thinking: row.blocks.some((block) => block.type === 'thinking'),
    };
  }
  private async chainEnd(
    start: number,
    unit: UnitDescription,
  ): Promise<number> {
    if (!unit.chain) return start;
    let end = start;
    for (let at = start + 1; at < this.query.count; at++) {
      this.work.chainSearchUnits++;
      const candidate = await this.describe(at);
      if (candidate !== undefined) {
        if (candidate.speaker !== 'ai') break;
        end = at;
      }
    }
    return end;
  }
  async *messages(
    from = 0,
    to = this.query.count,
  ): AsyncGenerator<RepairMessage> {
    this.work.messageWalks++;
    if (this.index !== undefined) {
      yield* this.index.messages(from);
      return;
    }
    let pending = -1;
    let pendingEnd = -1;
    let leading = from === 0;
    for (let at = from; at < to; at++) {
      const unit = await this.describe(at);
      if (unit === undefined || (leading && unit.speaker === 'tool')) continue;
      leading = false;
      if (unit.results) {
        if (pending < 0) pending = at;
        pendingEnd = at;
      }
      if (unit.speaker !== 'tool') {
        if (pending >= 0) {
          yield {
            start: pending,
            end: pendingEnd,
            slot: 'results',
            role: 'user',
          };
          pending = -1;
        }
        if (unit.content) {
          const end = await this.chainEnd(at, unit);
          const message: RepairMessage = {
            start: at,
            end,
            slot: end > at ? 'chain' : 'content',
            role: unit.speaker === 'ai' ? 'assistant' : 'user',
          };
          yield* this.withRawResults(message);
          at = end;
        }
      }
    }
    if (pending >= 0)
      yield { start: pending, end: pendingEnd, slot: 'results', role: 'user' };
  }
  private async *withRawResults(
    message: RepairMessage,
  ): AsyncGenerator<RepairMessage> {
    if (this.query.rawChainAt !== undefined && message.slot === 'chain') {
      for (let at = message.start; at <= message.end; at++) {
        if ((await this.describe(at))?.results === true) {
          yield {
            ...message,
            slot: 'results',
            role: 'user',
            chainResults: true,
          };
          break;
        }
      }
    }
    yield message;
  }
  private chainParts(
    row: IContent,
    at: number,
    category: number,
    redact: boolean,
  ): readonly AnthropicMessageBlock[] {
    const blocks: AnthropicMessageBlock[] = [];
    for (const block of row.blocks) {
      if (priority(block) !== category) continue;
      const part = convertBlockToAnthropicPart(block, at, redact, this.options);
      if (part !== null) blocks.push(part);
    }
    return blocks;
  }
  private async *chainPieces(
    message: RepairMessage,
    redact: boolean,
  ): AsyncGenerator<RepairPiece> {
    for (let category = 0; category < 4; category++) {
      for (let at = message.start; at <= message.end; at++) {
        const row = await this.row(at);
        if (row !== undefined) yield this.chainParts(row, at, category, redact);
      }
    }
  }
  private async untaggedPieceAt(
    message: RepairMessage,
    at: number,
    redact: boolean,
  ): Promise<RepairPiece | undefined> {
    const row = await this.row(at);
    if (row === undefined) return undefined;
    const results = row.blocks.some((block) => block.type === 'tool_response');
    if (!this.normalized && message.slot === 'results' && results) {
      const chain = await this.query.rawChainAt?.(at);
      if (chain !== undefined)
        return this.query.rawDump === true
          ? rawChainResults(this.query, row, chain, this.options)
          : rawChainWireResults(
              {
                readAt: async (index) =>
                  (await this.row(index)) ?? { speaker: 'ai', blocks: [] },
              },
              row,
              chain,
              this.options,
            );
    }
    const converted = convertContentToMessages(
      [row],
      new Set(redact ? [0] : []),
      this.options,
    );
    if (message.slot === 'results')
      return results ? converted[0]?.content : undefined;
    return converted[Number(results)]?.content;
  }
  private async pieceAt(
    message: RepairMessage,
    at: number,
    redact: boolean,
  ): Promise<RepairPiece | undefined> {
    const piece = await this.untaggedPieceAt(message, at, redact);
    if (
      message.slot !== 'results' ||
      this.query.rawResultsAt === undefined ||
      piece === undefined ||
      typeof piece === 'string'
    )
      return piece;
    const blocks = piece.map((block) => {
      const copy = { ...block };
      clearAnchorBlockTag(copy);
      return copy;
    });
    const group = await this.query.rawResultsAt(at);
    if (
      group !== undefined &&
      at === (await this.lastResultAt(group.start, group.end)) &&
      (await this.resultsAnchored(group.start, group.end))
    )
      tagAnchorMessage({ role: 'user', content: blocks });
    return blocks;
  }
  async *pieces(
    message: RepairMessage,
    redact: boolean,
  ): AsyncGenerator<RepairPiece> {
    if (message.slot === 'chain') {
      yield* this.chainPieces(message, redact);
      return;
    }
    for (let at = message.start; at <= message.end; at++) {
      const piece = await this.pieceAt(message, at, redact);
      if (piece !== undefined) yield piece;
    }
  }
  private async *callsAt(
    at: number,
  ): AsyncGenerator<{ readonly id: string; readonly unit: number }> {
    const row = await this.row(at);
    if (row?.speaker !== 'ai') return;
    for (const block of row.blocks) {
      if (block.type === 'tool_call')
        yield { id: normalizeToAnthropicToolId(block.id), unit: at };
    }
  }
  async *calls(
    message: RepairMessage,
  ): AsyncGenerator<{ readonly id: string; readonly unit: number }> {
    for (let at = message.start; at <= message.end; at++)
      yield* this.callsAt(at);
  }
  private async lastResultAt(
    from: number,
    to: number,
  ): Promise<number | undefined> {
    for (let at = to; at >= from; at--)
      if (
        (await this.row(at))?.blocks.some(
          (block) => block.type === 'tool_response',
        ) === true
      )
        return at;
    return undefined;
  }
  async resultsAnchored(from: number, to: number): Promise<boolean> {
    for (let at = from; at <= to; at++) {
      const row = await this.row(at);
      if (row?.speaker === 'tool' && row.metadata?.cacheAnchor === true)
        return true;
    }
    for (let at = from - 1; at >= 0; at--) {
      const row = await this.row(at);
      if (row === undefined) continue;
      return (
        row.speaker === 'human' &&
        row.metadata?.cacheAnchor === true &&
        row.blocks.some((block) => block.type === 'tool_response') &&
        row.blocks.every(
          (block) =>
            block.type === 'tool_response' ||
            block.type === 'text' ||
            block.type === 'code',
        )
      );
    }
    return false;
  }
  async lastThinking(): Promise<number> {
    if (this.index !== undefined) return this.index.lastThinking;
    let last = -1;
    for await (const group of this.messages()) {
      if (group.role !== 'assistant') continue;
      if ((await this.describe(group.start))?.thinking === true)
        last = group.start;
    }
    return last;
  }
}
