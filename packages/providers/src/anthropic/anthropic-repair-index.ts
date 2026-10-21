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
  `anthropic-repair:2:${rowFormatKey(settings)}`;
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
      values[4] > 5
    )
      throw new JournalFormatError('Invalid Anthropic native message facts');
    const slot = values[4] < 4 ? 'content' : 'chain';
    return {
      start: values[2],
      end: values[3],
      slot: values[4] < 2 ? 'results' : slot,
      role: values[4] % 2 === 0 ? 'user' : 'assistant',
    };
  }
  async *messages(from: number): AsyncGenerator<RepairMessage> {
    let low = 1;
    let high = this.count + 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if ((await this.message(mid)).end < from) low = mid + 1;
      else high = mid;
    }
    for (let ordinal = low; ordinal <= this.count; ordinal++)
      yield await this.message(ordinal);
  }
  async decision(
    message: RepairMessage,
    id: string,
  ): Promise<ToolRepairOverlay | undefined> {
    const values = await this.facts.get(['decision', message.start, id]);
    if (!sameFactVersion(values, this.version) || values.length !== 5)
      throw new JournalFormatError('Missing Anthropic native use decision');
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
  await writer.set(
    ['message', ordinal],
    [
      ...generation,
      message.start,
      message.end,
      (message.slot === 'results' ? 0 : slot) +
        Number(message.role === 'assistant'),
    ],
  );
}
