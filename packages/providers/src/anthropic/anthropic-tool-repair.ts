/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import type { AnthropicMessageBlock } from './AnthropicMessageNormalizer.js';
import type {
  AnthropicRepairSource,
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

export class AnthropicToolRepair {
  private nextCache:
    | {
        readonly start: number;
        readonly end: number;
        readonly next: RepairMessage | undefined;
      }
    | undefined;
  constructor(readonly source: AnthropicRepairSource) {}

  async orphan(message: RepairMessage): Promise<boolean> {
    if (message.slot !== 'results') return false;
    for await (const piece of this.source.pieces(message, false)) {
      if (typeof piece === 'string') continue;
      for (const block of piece)
        if (
          block.type === 'tool_result' &&
          (await this.source.query.normalizedCount(2, 0, block.tool_use_id)) > 0
        )
          return false;
    }
    return true;
  }

  async next(message: RepairMessage): Promise<RepairMessage | undefined> {
    if (
      this.nextCache?.start === message.start &&
      this.nextCache.end === message.end
    )
      return this.nextCache.next;
    let next: RepairMessage | undefined;
    for await (const candidate of this.source.messages(message.end + 1)) {
      if (!(await this.orphan(candidate))) {
        next = candidate;
        break;
      }
    }
    this.nextCache = { start: message.start, end: message.end, next };
    return next;
  }

  private walk(
    id: string,
    through: number,
    known: RepairMessage | undefined,
    wantedOrdinal?: number,
  ): Promise<ToolRepairOverlay | undefined> {
    const query = this.source.query;
    return query.withNormalized(2, 0, id, (uses) =>
      query.withNormalized(2, 1, id, async (results) => {
        let consumed = 0;
        let previousEnd = -1;
        let inserted = false;
        const limit = await uses.countBefore(through + 1);
        for (let at = 1; at <= limit; at++) {
          const unit = await uses.position(at);
          if (unit === undefined)
            throw new JournalFormatError('Repair use ordinal is absent');
          if (unit <= previousEnd) continue;
          const message =
            known !== undefined && known.start <= unit && known.end >= unit
              ? known
              : await this.source.groupAt(unit);
          previousEnd = message.end;
          const next = await this.next(message);
          let ordinal: number | undefined;
          let missing = false;
          if (next?.role === 'user') {
            const before = await results.countBefore(next.start);
            const end = await results.countBefore(next.end + 1);
            if (Math.max(before + 1, consumed + 1) > end) {
              const later = Math.max(end + 1, consumed + 1);
              ordinal = later <= results.count ? later : undefined;
              missing = ordinal === undefined;
              consumed = ordinal ?? consumed;
            }
          } else if (results.count === 0 && !inserted) {
            missing = true;
            inserted = true;
          }
          if (
            (ordinal !== undefined || missing) &&
            (wantedOrdinal === undefined
              ? message.start === known?.start
              : wantedOrdinal === ordinal)
          )
            return {
              id,
              callMessage: message.start,
              target: next?.role === 'user' ? next.start : undefined,
              resultOrdinal: ordinal,
              interrupted: missing,
            };
        }
        return undefined;
      }),
    );
  }

  decision(
    message: RepairMessage,
    id: string,
  ): Promise<ToolRepairOverlay | undefined> {
    return this.walk(id, message.end, message);
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
    return (await this.walk(id, at, undefined, ordinal)) !== undefined;
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
