/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { NativeFactIndexReader } from '@vybestack/llxprt-code-core/journal/nativeFactIndex.js';
import { requestFormatSlot } from '@vybestack/llxprt-code-core/services/history/native-provider-format.js';
import type {
  AnthropicSpanPlan,
  AnthropicSpan,
} from './anthropic-span-plan.js';
import {
  type AnthropicStreamRepair,
  numericRepairPiece,
} from './anthropic-stream-repair.js';
import {
  addAnthropicCachePiece,
  beginAnthropicCacheAtom,
  type AnthropicCacheState,
} from './anthropic-cache-facts.js';
import { anthropicSpanMeasurements } from './anthropic-span-measure.js';
import { anthropicSummaryCount } from './anthropic-span-summary.js';
import {
  anthropicRecoveryEvents,
  type RecoveryImageFact,
} from './anthropic-recovery-facts.js';
import type { AnthropicRecoveryAdjustment } from './native-anthropic-recovery.js';

type Adjust = (
  fact: RecoveryImageFact,
  run: readonly number[],
) => AnthropicRecoveryAdjustment;
interface RecoveryRun {
  readonly from: number;
  readonly to: number;
  readonly run: NonNullable<AnthropicCacheState['run']>;
}
async function* runs(
  engine: AnthropicStreamRepair,
  span: AnthropicSpan,
): AsyncGenerator<RecoveryRun> {
  let state: AnthropicCacheState = {};
  let from = span.start * 4;
  let to = from;
  for await (const atom of engine.atoms(from)) {
    if (atom.key >= span.end * 4) break;
    if (state.run !== undefined && state.run.role !== atom.role) {
      yield { from, to, run: state.run };
      from = atom.key;
    }
    state = beginAnthropicCacheAtom(state, atom.role);
    for await (const piece of atom.openPieces())
      state = addAnthropicCachePiece(
        state,
        numericRepairPiece(piece, atom.role),
      );
    to = atom.key + 1;
  }
  if (state.run !== undefined) yield { from, to, run: state.run };
}
async function affected(
  engine: AnthropicStreamRepair,
  span: AnthropicSpan,
  offset: number,
  adjust: Adjust,
): Promise<AnthropicRecoveryAdjustment> {
  let bytes = 0;
  let replaced = 0;
  for await (const range of runs(engine, span)) {
    for await (const event of anthropicRecoveryEvents(
      engine,
      {},
      range.from,
      range.to,
    )) {
      if (event.kind !== 'image') continue;
      const fact = {
        ...event.fact,
        position: [range.run.ordinal + offset, ...event.fact.position.slice(1)],
      };
      const next = adjust(fact, [range.run.atoms, range.run.leading]);
      bytes += next.bytes;
      replaced += next.replaced;
    }
  }
  return { bytes, replaced };
}
async function required(
  facts: NativeFactIndexReader,
  key: ReadonlyArray<string | number>,
): Promise<readonly number[]> {
  const value = await facts.get(key);
  if (value === undefined)
    throw new Error(`Missing Anthropic span recovery fact: ${key.join('/')}`);
  return value;
}
async function startsWithAssistant(plan: AnthropicSpanPlan): Promise<boolean> {
  for await (const message of plan.topologyMessages(0))
    return message.role === 'assistant';
  return false;
}
export async function planAnthropicSpanRecovery(
  plan: AnthropicSpanPlan,
  engine: AnthropicStreamRepair,
  facts: NativeFactIndexReader,
  adjust: Adjust,
): Promise<AnthropicRecoveryAdjustment> {
  const images = (await required(facts, ['recovery-images']))[0];
  const oldSynthetic =
    plan.index.count > 0 && (await plan.index.message(1)).role === 'assistant';
  const newSynthetic = await startsWithAssistant(plan);
  const steps = anthropicSpanMeasurements(plan, engine);
  let current = await steps.next();
  let shift = 0;
  let bytes = 0;
  let replaced = 0;
  const advance = async (): Promise<void> => {
    if (current.done === true || current.value.span === undefined) return;
    const { span, summary, offset } = current.value;
    const next = await affected(engine, span, offset, adjust);
    bytes += next.bytes;
    replaced += next.replaced;
    const old = Math.min(
      plan.snapshot.units - 1,
      plan.coordinates.backward(span.end - 1),
    );
    const label = old < 0 ? 0n : (await plan.base.unitEntryAt(old)).entry.label;
    const stored = await plan.snapshot.formatSummaryRange(
      requestFormatSlot(plan.snapshot, engine.source.settings),
      1n,
      label + 1n,
    );
    shift =
      anthropicSummaryCount(summary) -
      anthropicSummaryCount(stored) +
      Number(oldSynthetic) -
      Number(newSynthetic);
    current = await steps.next();
  };
  try {
    for (let at = 0; at < images; at++) {
      const source = await required(facts, ['recovery-source', at]);
      const key =
        plan.coordinates.forward(Math.floor(source[0] / 4)) * 4 +
        (source[0] % 4);
      while (
        current.done !== true &&
        current.value.span !== undefined &&
        current.value.span.end * 4 <= key
      )
        await advance();
      if (
        current.done !== true &&
        current.value.span !== undefined &&
        current.value.span.start * 4 <= key
      )
        continue;
      const position = await required(facts, ['recovery-position', at]);
      const image = await required(facts, ['recovery-image', at]);
      const run = await required(facts, ['recovery-run', position[0]]);
      const next = adjust(
        {
          source,
          image,
          position: [position[0] + shift, ...position.slice(1)],
        },
        run,
      );
      bytes += next.bytes;
      replaced += next.replaced;
    }
    while (current.done !== true && current.value.span !== undefined)
      await advance();
    return { bytes, replaced };
  } finally {
    await steps.return(undefined);
  }
}
