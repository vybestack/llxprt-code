/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AnthropicRequestRepairIndex } from './anthropic-repair-index.js';
import type { RepairMessage } from './anthropic-repair-source.js';
import type { ToolRepairOverlay } from './anthropic-tool-repair.js';
import type { AnthropicSpanPlan } from './anthropic-span-plan.js';
import { decideAnthropicTool } from './anthropic-tool-decision.js';

export class AnthropicDecisionOverlay implements AnthropicRequestRepairIndex {
  lastThinking = -1;
  private readonly cached = new Map<
    string,
    { readonly start: number; readonly decision: ToolRepairOverlay | undefined }
  >();
  constructor(readonly plan: AnthropicSpanPlan) {}
  messages(from: number): AsyncGenerator<RepairMessage> {
    return this.plan.messages(from);
  }
  async prepare(): Promise<void> {
    const { index, coordinates, query } = this.plan;
    this.lastThinking =
      index.lastThinking < 0 ? -1 : coordinates.forward(index.lastThinking);
    if (
      this.lastThinking >= query.count ||
      coordinates.changes.some(
        ({ row, oldStart }) =>
          index.lastThinking >= oldStart &&
          index.lastThinking < oldStart + row.oldCount,
      )
    )
      this.lastThinking = await this.previousThinking(index.lastThinking);
    for (const row of query.viewPlan.changedSources)
      for (let at = row.start; at < row.start + row.count; at++)
        await this.observeThinking(at);
    if (this.lastThinking >= 0) {
      const message = await this.holder(this.lastThinking);
      if (message !== undefined) this.lastThinking = message.start;
    }
  }
  private async observeThinking(at: number): Promise<void> {
    const description = await this.plan.source.describe(at);
    if (description?.chain === true) await this.plan.extendThinking(at);
    if (description?.thinking !== true || at <= this.lastThinking) return;
    const message = await this.holder(at);
    if (message !== undefined) this.lastThinking = message.start;
  }
  private async previousThinking(before: number): Promise<number> {
    const { index, coordinates, query, source } = this.plan;
    while (before >= 0) {
      const holder = await index.previousThinking(before);
      if (holder === undefined) return -1;
      const at = coordinates.forward(holder);
      if (at < query.count && (await source.describe(at))?.thinking === true)
        return at;
      before = holder - 1;
    }
    return -1;
  }
  private async holder(at: number): Promise<RepairMessage | undefined> {
    for await (const message of this.plan.topologyMessages(at)) {
      if (message.start > at) break;
      if (message.role === 'assistant' && message.end >= at) return message;
    }
    return undefined;
  }
  private async survives(
    message: RepairMessage,
    before: number,
  ): Promise<boolean> {
    if (message.slot !== 'results') return true;
    for (let at = message.start; at <= message.end; at++) {
      const local = new Map<string, number>();
      for (const fact of await this.plan.query.anthropicToolFactsAt(at)) {
        if (fact.kind !== 'result' || fact.orphan) continue;
        const within = (local.get(fact.id) ?? 0) + 1;
        local.set(fact.id, within);
        if (!(await this.taken(fact.id, fact.resultsBefore + within, before)))
          return true;
      }
    }
    return false;
  }
  private async next(
    message: RepairMessage,
  ): Promise<RepairMessage | undefined> {
    let skipped = false;
    for await (const candidate of this.plan.topologyMessages(message.start)) {
      if (
        !skipped &&
        candidate.start === message.start &&
        candidate.slot === message.slot
      ) {
        skipped = true;
        continue;
      }
      if (skipped && (await this.survives(candidate, message.start - 1)))
        return candidate;
    }
    return undefined;
  }
  private async *decisions(
    id: string,
    before: number,
  ): AsyncGenerator<ToolRepairOverlay> {
    let state = { ordinal: 0, inserted: false };
    let previous = -1;
    for await (const at of this.plan.query.normalizedRange(2, 0, id)) {
      if (at > before) return;
      const message = await this.holder(at);
      if (message === undefined || message.start === previous) continue;
      previous = message.start;
      const next = await this.next(message);
      const { taken, missing } = await this.plan.query.withNormalized(
        2,
        1,
        id,
        (results) => decideAnthropicTool(results, state, next),
      );
      state = {
        ordinal: taken ?? state.ordinal,
        inserted: state.inserted || missing,
      };
      yield {
        id,
        callMessage: message.start,
        target: next?.role === 'user' ? next.start : undefined,
        resultOrdinal: taken,
        interrupted: missing,
      };
    }
  }
  async affected(id: string, at: number, kind: 0 | 1): Promise<boolean> {
    const { coordinates } = this.plan;
    if (
      at >= coordinates.prefixEnd ||
      coordinates.changes.some(
        ({ row }) => at >= row.start && at < row.start + Math.max(1, row.count),
      )
    )
      return true;
    return kind === 0
      ? this.changedDecision(id, at)
      : this.changedResult(id, at);
  }
  private async changedDecision(id: string, at: number): Promise<boolean> {
    const { index, coordinates, base, query } = this.plan;
    const message = await this.holder(at);
    const old = await index.before(coordinates.backward(at) + 1);
    if (message === undefined || old === undefined)
      return message !== undefined || old !== undefined;
    const before = await index.decision(old, id);
    const after = await this.decision(message, id);
    const target =
      before?.target === undefined
        ? undefined
        : coordinates.forward(before.target);
    if (
      before?.resultOrdinal !== after?.resultOrdinal ||
      before?.interrupted !== after?.interrupted ||
      target !== after?.target
    )
      return true;
    if (
      before?.resultOrdinal === undefined ||
      after?.resultOrdinal === undefined
    )
      return false;
    const selected = await base.normalizedPosition(
      2,
      1,
      id,
      before.resultOrdinal,
    );
    const next = await query.normalizedPosition(2, 1, id, after.resultOrdinal);
    if (selected === undefined)
      throw new Error('Missing persisted Anthropic repair result');
    return (
      next !== coordinates.forward(selected) ||
      coordinates.changes.some(
        ({ row, oldStart }) =>
          selected >= oldStart && selected < oldStart + row.oldCount,
      )
    );
  }
  private async changedResult(id: string, at: number): Promise<boolean> {
    const { index, coordinates, base, query } = this.plan;
    const old = coordinates.backward(at);
    if (
      ((await base.normalizedCount(2, 0, id)) === 0) !==
      ((await query.normalizedCount(2, 0, id)) === 0)
    )
      return true;
    const before = await base.normalizedCount(2, 1, id, { from: 0, to: old });
    const after = await query.normalizedCount(2, 1, id, { from: 0, to: at });
    const count = await query.normalizedCount(2, 1, id, {
      from: at,
      to: at + 1,
    });
    for (let within = 1; within <= count; within++)
      if (
        (await index.taken(id, before + within, old)) !==
        (await this.taken(id, after + within, at))
      )
        return true;
    return false;
  }
  async decision(
    message: RepairMessage,
    id: string,
  ): Promise<ToolRepairOverlay | undefined> {
    if (this.plan.ids.has(id)) {
      const cached = this.cached.get(id);
      if (cached?.start === message.start) return cached.decision;
      let result: ToolRepairOverlay | undefined;
      for await (const decision of this.decisions(id, message.end))
        if (decision.callMessage === message.start) {
          result =
            decision.interrupted || decision.resultOrdinal !== undefined
              ? decision
              : undefined;
          break;
        }
      this.cached.set(id, { start: message.start, decision: result });
      return result;
    }
    const coordinates = this.plan.coordinates;
    const decision = await this.plan.index.decision(
      {
        ...message,
        start: coordinates.backward(message.start),
        end: coordinates.backward(message.end),
      },
      id,
    );
    return decision === undefined
      ? undefined
      : {
          ...decision,
          callMessage: message.start,
          target:
            decision.target === undefined
              ? undefined
              : coordinates.forward(decision.target),
        };
  }
  async taken(id: string, ordinal: number, before: number): Promise<boolean> {
    if (this.plan.ids.has(id)) {
      const cached = this.cached.get(id);
      if (
        cached !== undefined &&
        (await this.plan.query.normalizedCount(2, 0, id)) === 1
      )
        return (
          cached.start <= before && cached.decision?.resultOrdinal === ordinal
        );
      if (
        cached !== undefined &&
        cached.start <= before &&
        cached.decision?.resultOrdinal === ordinal
      )
        return true;
      for await (const decision of this.decisions(id, before))
        if (decision.resultOrdinal === ordinal) return true;
      return false;
    }
    return this.plan.index.taken(
      id,
      ordinal,
      this.plan.coordinates.backward(before),
    );
  }
}
