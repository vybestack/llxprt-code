/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { NativeFactIndexReader } from '@vybestack/llxprt-code-core/journal/nativeFactIndex.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { readAnthropicMeasurementFact } from './anthropic-measurement-facts.js';
import type {
  EstimateTextFact,
  EstimatePieceFact,
} from './anthropic-estimate-facts.js';
import type { LazyRepairAtom } from './anthropic-stream-repair.js';
import type { AnthropicMessage } from './AnthropicMessageNormalizer.js';
import {
  hasAnthropicCacheTarget,
  type AnthropicCachePlan,
} from './anthropic-cache-facts.js';
import { getEmptyMessagePlaceholder } from './AnthropicMessageValidator.js';
import { sanitizeBlockForCacheControl } from './AnthropicRequestBuilder.js';
import { modelSupportsPrefill } from './AnthropicModelData.js';

export interface EstimateRun {
  readonly atom: LazyRepairAtom;
  readonly role: 'user' | 'assistant';
  readonly merged: boolean;
}
class NumericContent<Run extends EstimateRun> {
  constructor(
    private readonly atoms: (run: Run) => AsyncIterable<LazyRepairAtom>,
    private readonly facts: NativeFactIndexReader,
    private readonly cache?: AnthropicCachePlan,
  ) {}
  cached(text: string, run: number): unknown {
    return this.cache !== undefined &&
      hasAnthropicCacheTarget(this.cache, run, 0)
      ? [sanitizeBlockForCacheControl({ type: 'text', text }, this.cache.ttl)]
      : text;
  }
  private async *pieces(run: Run): AsyncGenerator<EstimatePieceFact> {
    for await (const atom of this.atoms(run)) {
      const measured = await readAnthropicMeasurementFact(this.facts, atom.key);
      yield* atom.redacted === true && measured.strippedEstimates !== undefined
        ? measured.strippedEstimates
        : measured.estimates;
    }
  }
  private async raw(
    run: Run,
    ordinal: number,
  ): Promise<EstimateTextFact | undefined> {
    const single =
      !run.merged &&
      !run.atom.repair &&
      run.atom.chain !== true &&
      run.atom.end === Math.floor(run.atom.key / 4);
    if (
      !single ||
      (this.cache !== undefined &&
        hasAnthropicCacheTarget(this.cache, ordinal, 0))
    )
      return undefined;
    for await (const piece of this.pieces(run))
      return piece.string && !piece.blank ? piece.raw : undefined;
    return undefined;
  }
  private async *blocks(
    run: Run,
    pass: number,
  ): AsyncGenerator<EstimatePieceFact['blocks'][number]> {
    for await (const piece of this.pieces(run)) {
      for (const block of piece.blocks) {
        const leading =
          run.role === 'user'
            ? block.kind === 'tool_result'
            : block.kind === 'thinking' || block.kind === 'redacted_thinking';
        if (!block.blank && (!run.merged || Number(!leading) === pass))
          yield block;
      }
    }
  }
  async *content(
    run: Run,
    ordinal: number,
  ): AsyncGenerator<string | EstimateTextFact> {
    const raw = await this.raw(run, ordinal);
    if (raw !== undefined) {
      yield '{"';
      yield raw;
      return;
    }
    yield '{"role":' + JSON.stringify(run.role) + ',"content":';
    let blockAt = 0;
    let comma = '[';
    for (let pass = 0; pass < (run.merged ? 2 : 1); pass++) {
      for await (const block of this.blocks(run, pass)) {
        yield comma + '{"';
        let variant = 0;
        if (
          this.cache !== undefined &&
          hasAnthropicCacheTarget(this.cache, ordinal, blockAt)
        )
          variant = this.cache.ttl === '1h' ? 2 : 1;
        yield block.variants[variant];
        blockAt++;
        comma = ',';
      }
    }
    if (blockAt === 0)
      yield JSON.stringify(
        this.cached(getEmptyMessagePlaceholder(run.role), ordinal),
      );
    else yield ']';
    yield '}';
  }
}
export async function* numericAnthropicPieces<Run extends EstimateRun>(
  runs: AsyncIterable<Run>,
  atoms: (run: Run) => AsyncIterable<LazyRepairAtom>,
  facts: NativeFactIndexReader,
  settings: RowFormatSettings,
  prefix?: AnthropicMessage,
  cache?: AnthropicCachePlan,
): AsyncGenerator<string | EstimateTextFact> {
  const content = new NumericContent(atoms, facts, cache);
  yield '[';
  if (prefix !== undefined) yield JSON.stringify(prefix) + ',';
  let count = 0;
  let ordinal = 0;
  let last: EstimateRun['role'] | undefined;
  for await (const run of runs) {
    if (count === 0 && run.role !== 'user') {
      yield JSON.stringify({
        role: 'user',
        content: 'Continue the conversation',
      });
      count++;
    }
    if (count++ > 0) yield ',';
    yield* content.content(run, ordinal++);
    last = run.role;
  }
  if (count === 0)
    yield JSON.stringify({
      role: 'user',
      content: content.cached('Hello', -1),
    });
  if (
    last === 'assistant' &&
    (settings.reasoningEnabled || !modelSupportsPrefill(settings.model))
  )
    yield ',' +
      JSON.stringify({
        role: 'user',
        content: content.cached('Continue the conversation', -1),
      });
  yield ']';
}
