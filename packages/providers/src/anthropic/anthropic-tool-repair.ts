/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import type { AnthropicMessageBlock } from './AnthropicMessageNormalizer.js';
import type { AnthropicRequestRepairIndex } from './anthropic-repair-index.js';
import type {
  AnthropicRepairSource,
  AnthropicRepairRows,
  RepairMessage,
} from './anthropic-repair-source.js';

type ResultBlock = Extract<AnthropicMessageBlock, { type: 'tool_result' }>;
export interface ToolRepairOverlay {
  readonly id: string;
  readonly callMessage: number;
  readonly target: number | undefined;
  readonly resultOrdinal: number | undefined;
  readonly interrupted: boolean;
}
const interrupted = (id: string): ResultBlock => ({
  type: 'tool_result',
  tool_use_id: id,
  content: '[tool execution interrupted]',
  is_error: true,
});

export class AnthropicToolRepair<Query extends AnthropicRepairRows> {
  readonly work = {
    walks: 0,
    recursiveWalks: 0,
    usePositions: 0,
    nextQueries: 0,
    survivalQueries: 0,
    decisions: 0,
    takenQueries: 0,
  };

  constructor(
    readonly source: AnthropicRepairSource<Query>,
    readonly index: AnthropicRequestRepairIndex,
  ) {}
  decision(
    message: RepairMessage,
    id: string,
  ): Promise<ToolRepairOverlay | undefined> {
    this.work.decisions++;
    return this.index.decision(message, id);
  }

  async result(id: string, ordinal: number): Promise<ResultBlock> {
    const query = this.source.query;
    const at = await query.normalizedPosition(2, 1, id, ordinal);
    if (at === undefined)
      throw new JournalFormatError('Repair result ordinal is absent');
    const before = await query.normalizedCount(2, 1, id, { from: 0, to: at });
    const message: RepairMessage = {
      start: at,
      end: at,
      role: 'user',
      slot: 'results',
    };
    let within = before;
    for await (const piece of this.source.pieces(message, false)) {
      if (typeof piece === 'string') continue;
      for (const block of piece) {
        if (
          block.type === 'tool_result' &&
          block.tool_use_id === id &&
          ++within === ordinal
        )
          return block;
      }
    }
    throw new JournalFormatError(
      'Repair result ordinal has no converted block',
    );
  }

  async *scripts(message: RepairMessage): AsyncGenerator<ToolRepairOverlay> {
    let unit = -1;
    const decisions = new Map<string, ToolRepairOverlay | undefined>();
    for await (const call of this.source.calls(message)) {
      if (unit !== call.unit) {
        decisions.clear();
        unit = call.unit;
      }
      if (!decisions.has(call.id))
        decisions.set(call.id, await this.decision(message, call.id));
      const decision = decisions.get(call.id);
      if (decision !== undefined) yield decision;
    }
  }

  async *insertions(message: RepairMessage): AsyncGenerator<ResultBlock> {
    for await (const decision of this.scripts(message)) {
      yield decision.resultOrdinal === undefined
        ? interrupted(decision.id)
        : await this.result(decision.id, decision.resultOrdinal);
    }
  }

  async taken(id: string, ordinal: number, at: number): Promise<boolean> {
    this.work.takenQueries++;
    return this.index.taken(id, ordinal, at);
  }

  async hasKept(message: RepairMessage): Promise<boolean> {
    for (let at = message.start; at <= message.end; at++) {
      const within = new Map<string, number>();
      for await (const id of this.source.resultIds(at)) {
        const ordinal = (within.get(id) ?? 0) + 1;
        within.set(id, ordinal);
        const query = this.source.query;
        const before = await query.normalizedCount(2, 1, id, {
          from: 0,
          to: at,
        });
        if (
          (await query.normalizedCount(2, 0, id)) > 0 &&
          !(await this.taken(id, before + ordinal, at))
        )
          return true;
      }
    }
    return false;
  }

  async *kept(
    message: RepairMessage,
    redact: boolean,
  ): AsyncGenerator<string | readonly AnthropicMessageBlock[]> {
    if (message.slot !== 'results') {
      yield* this.source.pieces(message, redact);
      return;
    }
    for (let at = message.start; at <= message.end; at++)
      yield* this.keptAt(message, at, redact);
  }

  private async *keptAt(
    message: RepairMessage,
    at: number,
    redact: boolean,
  ): AsyncGenerator<readonly AnthropicMessageBlock[]> {
    const local = new Map<
      string,
      { readonly before: number; readonly uses: number; within: number }
    >();
    for await (const piece of this.source.pieces(
      { ...message, start: at, end: at },
      redact,
    )) {
      if (typeof piece === 'string')
        throw new JournalFormatError('Result message contains string content');
      if (
        message.kept === true &&
        message.start === message.end &&
        piece.length === 1 &&
        piece[0].type === 'tool_result'
      ) {
        yield piece;
        continue;
      }
      const blocks: AnthropicMessageBlock[] = [];
      for (const block of piece) {
        if (block.type !== 'tool_result')
          throw new JournalFormatError(
            'Result message contains a non-result block',
          );
        const id = block.tool_use_id;
        let fact = local.get(id);
        if (fact === undefined) {
          fact = {
            before: await this.source.query.normalizedCount(2, 1, id, {
              from: 0,
              to: at,
            }),
            uses: await this.source.query.normalizedCount(2, 0, id),
            within: 0,
          };
          local.set(id, fact);
        }
        fact.within++;
        if (
          fact.uses > 0 &&
          !(await this.taken(id, fact.before + fact.within, at))
        )
          blocks.push(block);
      }
      if (blocks.length > 0) yield blocks;
    }
  }
}
