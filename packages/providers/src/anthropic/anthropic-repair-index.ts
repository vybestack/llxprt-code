/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from '@vybestack/llxprt-code-core/journal/errors.js';
import type {
  NativeFactIndexReader,
  NativeFactIndexWriter,
} from '@vybestack/llxprt-code-core/journal/nativeFactIndex.js';
import {
  rowFormatKey,
  type RowFormatSettings,
} from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import type { RepairMessage } from './anthropic-repair-source.js';
import type { ToolRepairOverlay } from './anthropic-tool-repair.js';

export const anthropicRepairScope = (settings: RowFormatSettings): string =>
  `anthropic-repair:6:${rowFormatKey(settings)}`;
export interface ScalarFacts {
  get(
    key: ReadonlyArray<string | number>,
  ): Promise<readonly number[] | undefined>;
}
export function sameFactVersion(
  values: readonly number[] | undefined,
  version: readonly number[],
): values is readonly number[] {
  return (
    values !== undefined && values[0] === version[0] && values[1] === version[1]
  );
}
function validMessageTag(tag: number): boolean {
  const finalized = tag < 8 || (tag & 8) !== 0;
  return tag <= 63 && (tag & 7) <= 5 && finalized;
}
export class AnthropicRepairIndex {
  private constructor(
    readonly facts: ScalarFacts,
    readonly version: readonly number[],
    readonly count: number,
    readonly lastThinking: number,
  ) {}
  static async read(
    facts: NativeFactIndexReader,
  ): Promise<AnthropicRepairIndex> {
    const version = await facts.get(['version']);
    if (version === undefined || version.length !== 2)
      throw new JournalFormatError(
        'Anthropic native repair facts need a fill for this version',
      );
    return this.prepared(facts, version);
  }
  static async prepared(
    facts: ScalarFacts,
    version: readonly number[],
  ): Promise<AnthropicRepairIndex> {
    const meta = await facts.get(['messages']);
    if (meta === undefined || meta.length !== 2)
      throw new JournalFormatError('Missing Anthropic native message facts');
    return new AnthropicRepairIndex(facts, version, meta[0], meta[1] - 1);
  }
  async message(ordinal: number): Promise<RepairMessage> {
    if (ordinal < 1 || ordinal > this.count)
      throw new JournalFormatError(
        'Anthropic message ordinal is outside native facts',
      );
    const values = await this.facts.get(['message', ordinal]);
    if (
      !sameFactVersion(values, this.version) ||
      values.length !== 5 ||
      values[3] < values[2] ||
      !validMessageTag(values[4])
    )
      throw new JournalFormatError('Invalid Anthropic native message facts');
    const kind = values[4] & 7;
    const slot = kind < 4 ? 'content' : 'chain';
    return {
      start: values[2],
      end: values[3],
      slot: kind < 2 ? 'results' : slot,
      role: kind % 2 === 0 ? 'user' : 'assistant',
      ...((values[4] & 8) !== 0
        ? { kept: (values[4] & 16) !== 0, inserts: (values[4] & 32) !== 0 }
        : {}),
    };
  }
  async previousThinking(before: number): Promise<number | undefined> {
    const count = await this.facts.get(['thinking-count']);
    if (count === undefined)
      throw new JournalFormatError('Missing Anthropic thinking index');
    let low = 0;
    let high = count[0];
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const fact = await this.facts.get(['thinking', mid]);
      if (fact === undefined)
        throw new JournalFormatError('Missing Anthropic thinking holder');
      if (fact[0] <= before) low = mid + 1;
      else high = mid;
    }
    if (low === 0) return undefined;
    const fact = await this.facts.get(['thinking', low - 1]);
    if (fact === undefined)
      throw new JournalFormatError('Missing Anthropic thinking holder');
    return fact[0];
  }
  async before(start: number): Promise<RepairMessage | undefined> {
    let low = 1;
    let high = this.count + 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if ((await this.message(mid)).start < start) low = mid + 1;
      else high = mid;
    }
    return low === 1 ? undefined : this.message(low - 1);
  }
  async *messages(from: number): AsyncGenerator<RepairMessage> {
    for await (const entry of this.messageEntries(from)) yield entry.message;
  }
  private seek: { readonly from: number; readonly ordinal: number } | undefined;

  private async seekOrdinal(from: number): Promise<number> {
    if (from === 0) return 1;
    if (this.seek?.from === from) return this.seek.ordinal;
    let low = 1;
    let high = this.count + 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if ((await this.message(mid)).end < from) low = mid + 1;
      else high = mid;
    }
    this.seek = { from, ordinal: low };
    return low;
  }

  async *messageEntries(from: number): AsyncGenerator<{
    readonly ordinal: number;
    readonly message: RepairMessage;
  }> {
    for (
      let ordinal = await this.seekOrdinal(from);
      ordinal <= this.count;
      ordinal++
    )
      yield { ordinal, message: await this.message(ordinal) };
  }
  async decision(
    message: RepairMessage,
    id: string,
  ): Promise<ToolRepairOverlay | undefined> {
    const values = await this.facts.get(['decision', message.start, id]);
    if (!sameFactVersion(values, this.version) || values.length !== 5)
      throw new JournalFormatError(
        `Missing Anthropic native use decision for ${id} at ${message.start}: expected ${this.version.join(',')}, found ${values?.join(',')}`,
      );
    if (values[3] === 0 && values[4] === 0) return undefined;
    return {
      id,
      callMessage: message.start,
      target: values[2] === 0 ? undefined : values[2] - 1,
      resultOrdinal: values[3] === 0 ? undefined : values[3],
      interrupted: values[4] !== 0,
    };
  }
  async taken(id: string, ordinal: number, before: number): Promise<boolean> {
    const values = await this.facts.get(['taken', id, ordinal]);
    return (
      sameFactVersion(values, this.version) &&
      values[2] !== 0 &&
      values[2] - 1 <= before
    );
  }
}

export async function writeRepairMessage(
  writer: NativeFactIndexWriter,
  ordinal: number,
  message: RepairMessage,
  generation: readonly number[],
): Promise<void> {
  const slot = message.slot === 'content' ? 2 : 4;
  // Pack the finalized atom decisions into the existing tag scalar.
  let atom = 0;
  if (message.kept !== undefined && message.inserts !== undefined)
    atom = 8 | (Number(message.kept) * 16) | (Number(message.inserts) * 32);
  await writer.set(
    ['message', ordinal],
    [
      ...generation,
      message.start,
      message.end,
      (message.slot === 'results' ? 0 : slot) +
        Number(message.role === 'assistant') +
        atom,
    ],
  );
}

export type AnthropicRequestRepairIndex = Pick<
  AnthropicRepairIndex,
  'lastThinking' | 'messages' | 'decision' | 'taken'
>;
