/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type {
  NormalizedFamily,
  OccurrenceKind,
} from '@vybestack/llxprt-code-core/journal/idKeys.js';
import {
  normalizeToOpenAIToolId,
  normalizeToAnthropicToolId,
} from '@vybestack/llxprt-code-tools/toolIdNormalization.js';

export class CallerOwnedToolQuery {
  private readonly positions = new Map<string, number[]>();
  hasToolBlocks = false;
  private constructor(readonly count: number) {}

  static async create(
    rows: ProviderRequestRows,
  ): Promise<CallerOwnedToolQuery> {
    if (rows.callerOwned !== true)
      throw new Error('Caller-owned tool facts require caller-owned rows');
    const query = new CallerOwnedToolQuery(rows.count);
    let leading = true;
    let at = 0;
    for await (const row of rows.openReader()) {
      leading &&= row.speaker === 'tool';
      query.observe(row, at, leading);
      at++;
    }
    return query;
  }

  private observe(row: IContent, at: number, leading: boolean): void {
    for (const block of row.blocks) {
      if (block.type !== 'tool_call' && block.type !== 'tool_response')
        continue;
      this.hasToolBlocks = true;
      const call = block.type === 'tool_call';
      const rawId = call ? block.id : block.callId;
      const responseOpenAI = row.speaker === 'tool';
      this.record(
        1,
        call,
        call ? row.speaker === 'ai' : responseOpenAI,
        rawId,
        at,
      );
      this.record(2, call, call ? row.speaker === 'ai' : !leading, rawId, at);
    }
  }
  private record(
    family: NormalizedFamily,
    call: boolean,
    eligible: boolean,
    rawId: string,
    at: number,
  ): void {
    if (!eligible) return;
    const id =
      family === 1
        ? normalizeToOpenAIToolId(rawId)
        : normalizeToAnthropicToolId(rawId);
    const key = JSON.stringify([family, Number(!call), id]);
    const positions = this.positions.get(key) ?? [];
    positions.push(at);
    this.positions.set(key, positions);
  }

  async normalizedCount(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    id: string,
    range?: { readonly from: number; readonly to: number },
  ): Promise<number> {
    const positions =
      this.positions.get(JSON.stringify([family, kind, id])) ?? [];
    return range === undefined
      ? positions.length
      : positions.filter((at) => at >= range.from && at < range.to).length;
  }

  async normalizedPosition(
    family: NormalizedFamily,
    kind: OccurrenceKind,
    id: string,
    ordinal: number,
  ): Promise<number | undefined> {
    const positions = this.positions.get(JSON.stringify([family, kind, id]));
    return positions?.[ordinal - 1];
  }
}
