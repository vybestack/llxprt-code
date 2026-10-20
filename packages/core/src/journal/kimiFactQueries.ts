/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import { decodeCountValue } from './idEntryCodecs.js';
import type { IdFactDeps } from './idFactQueries.js';
import { ID_NS, fact0Key } from './idKeys.js';
import { KIMI_EXCEPTION_KEY, decodeDecimal } from './metaFacts.js';
import {
  decodeKimiCounts,
  decodeKimiOccurrence,
  KIMI_AI_KEY,
  KIMI_FIELD,
  KIMI_FLAG,
  kimiKey,
  type KimiCounts,
  type KimiOccurrence,
} from './kimiFactCodec.js';
import type { VersionSnapshot } from './versionSnapshot.js';
import type { KeyedMapReader } from './keyedMap.js';

export interface KimiIdFact extends KimiCounts {
  readonly writtenUses: number;
  readonly unmappedUses: number;
  readonly last: KimiOccurrence | undefined;
}

export function digitCount(value: number): number {
  return String(value).length;
}

export class KimiFactQueries {
  constructor(
    private readonly snapshot: VersionSnapshot,
    private readonly deps: IdFactDeps,
    private readonly meta: KeyedMapReader,
  ) {}

  private identity(rawId: string): Uint8Array {
    return this.deps.hasher(ID_NS.fact, fact0Key(rawId));
  }

  private async fact(identity: Uint8Array): Promise<KimiIdFact | undefined> {
    await this.snapshot.kimiEligibleCount();
    const bytes = await this.snapshot.facts.getEntry(
      ID_NS.occurrence,
      kimiKey(KIMI_FIELD.counts, 0, identity),
    );
    if (bytes === undefined) return undefined;
    const counts = decodeKimiCounts(bytes);
    const stored = await this.snapshot.facts.getEntry(
      ID_NS.occurrence,
      kimiKey(KIMI_FIELD.last, 0, identity),
    );
    const last =
      stored === undefined || stored.length === 0
        ? undefined
        : decodeKimiOccurrence(stored);
    const ai = await this.meta.get(
      this.snapshot.version?.roots.metaRoot ?? 0,
      KIMI_AI_KEY,
    );
    const hasAi = ai !== undefined && decodeCountValue(ai) > 0;
    const responses = counts.aiResponses + counts.otherResponses;
    return {
      ...counts,
      last,
      writtenUses:
        counts.aiCalls +
        counts.aiResponses +
        (hasAi ? 0 : counts.otherResponses),
      unmappedUses: last === undefined ? counts.aiCalls + responses : 0,
    };
  }

  idFact(rawId: string): Promise<KimiIdFact | undefined> {
    return this.fact(this.identity(rawId));
  }

  async mappedId(rawId: string): Promise<string | undefined> {
    const fact = await this.idFact(rawId);
    if (fact?.last === undefined) return undefined;
    const { last } = fact;
    const entry = await this.snapshot.entryByLabel(last.position.label);
    if (entry === undefined)
      throw new JournalFormatError('Kimi last eligible row is absent');
    const block: unknown = JSON.parse(
      Buffer.from(await this.snapshot.readBlock(entry, last.block)).toString(
        'utf8',
      ),
    );
    if (typeof block !== 'object' || block === null)
      throw new JournalFormatError('Kimi name source is not a block');
    const reconstructed = (last.flags & KIMI_FLAG.reconstructed) !== 0;
    let name: string;
    if (
      reconstructed &&
      'toolName' in block &&
      typeof block.toolName === 'string'
    )
      name = block.toolName || 'unknown_tool';
    else if (
      !reconstructed &&
      'name' in block &&
      typeof block.name === 'string'
    )
      name = block.name;
    else throw new JournalFormatError('Kimi last eligible name is absent');
    const owned = Buffer.from(name, 'utf16le').toString('utf16le');
    return `functions.${owned}:${await this.snapshot.kimiOrdinal(last.position.label, last.eligibleWithinRow)}`;
  }

  async *exceptions(): AsyncGenerator<KimiIdFact> {
    await this.snapshot.kimiEligibleCount();
    const bytes = await this.meta.get(
      this.snapshot.version?.roots.metaRoot ?? 0,
      KIMI_EXCEPTION_KEY,
    );
    const count = bytes === undefined ? 0 : Number(decodeDecimal(bytes));
    for (let ordinal = 0; ordinal < count; ordinal++) {
      const hash = await this.snapshot.facts.exceptionHash(ordinal);
      if (hash === undefined)
        throw new JournalFormatError('Missing Kimi exception identity');
      const fact = await this.fact(hash);
      if (fact === undefined)
        throw new JournalFormatError('Missing Kimi exception fact');
      yield fact;
    }
  }

  async digitCorrection(): Promise<number> {
    await this.snapshot.kimiEligibleCount();
    const bytes = await this.meta.get(
      this.snapshot.version?.roots.metaRoot ?? 0,
      KIMI_EXCEPTION_KEY,
    );
    const count = bytes === undefined ? 0 : Number(decodeDecimal(bytes));
    let total = 0;
    for (let index = 0; index < count; index++) {
      const hash = await this.snapshot.facts.exceptionHash(index);
      if (hash === undefined)
        throw new JournalFormatError('Missing Kimi exception identity');
      const fact = await this.fact(hash);
      if (fact?.last === undefined) continue;
      const ordinal = await this.snapshot.kimiOrdinal(
        fact.last.position.label,
        fact.last.eligibleWithinRow,
      );
      total += fact.writtenUses * digitCount(ordinal);
      for (let occurrence = 1; occurrence <= fact.callCount; occurrence++) {
        const value = await this.snapshot.facts.getEntry(
          ID_NS.occurrence,
          kimiKey(KIMI_FIELD.calls, occurrence, hash),
        );
        if (value === undefined)
          throw new JournalFormatError('Missing emitted Kimi call');
        const call = decodeKimiOccurrence(value);
        if ((call.flags & KIMI_FLAG.eligible) !== 0)
          total -=
            2 *
            digitCount(
              await this.snapshot.kimiOrdinal(
                call.position.label,
                call.eligibleWithinRow,
              ),
            );
      }
    }
    return total;
  }
}
