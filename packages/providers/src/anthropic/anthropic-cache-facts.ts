/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { z } from 'zod';
import type { AnthropicAtom } from './anthropic-unit-facts.js';
import { modelSupportsPrefill } from './AnthropicModelData.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';

export function finishAnthropicCacheAtom(
  state: AnthropicCacheState,
  anchored: boolean,
  before: number,
): AnthropicCacheState {
  const current = state.run;
  if (current === undefined) throw new Error('Cache atom has no message run');
  const from = current.chainStart ?? before;
  const run =
    current.chainStart === undefined
      ? current
      : {
          ...current,
          leadingAnchor:
            current.leadingAnchor !== undefined &&
            current.leadingAnchor.original < from
              ? current.leadingAnchor
              : undefined,
          otherAnchor:
            current.otherAnchor !== undefined &&
            current.otherAnchor.original < from
              ? current.otherAnchor
              : undefined,
        };
  if (!anchored) return { ...state, run };
  const spot = run.otherTail ?? run.leadingTail;
  if (spot === undefined || spot.original < from) return { ...state, run };
  return {
    ...state,
    run: {
      ...run,
      leadingAnchor: run.leadingAnchor ?? (spot.leading ? spot : undefined),
      otherAnchor: run.otherAnchor ?? (!spot.leading ? spot : undefined),
    },
  };
}

const spotSchema = z.object({
  position: z.number(),
  original: z.number(),
  leading: z.boolean(),
});
const targetSchema = z.object({
  run: z.number(),
  block: z.number(),
  string: z.boolean(),
});
const runSchema = z.object({
  role: z.enum(['user', 'assistant']),
  ordinal: z.number(),
  atoms: z.number(),
  blocks: z.number(),
  leading: z.number(),
  other: z.number(),
  string: z.boolean(),
  chainStart: z.number().optional(),
  leadingAnchor: spotSchema.optional(),
  otherAnchor: spotSchema.optional(),
  leadingTail: spotSchema.optional(),
  otherTail: spotSchema.optional(),
  purge: spotSchema.optional(),
  purgeCount: z.number().optional(),
  image: z.boolean().optional(),
  imagePrevious: spotSchema.optional(),
});
const purgeSchema = z.object({
  count: z.number(),
  tagged: targetSchema.optional(),
  image: z.boolean(),
  expected: targetSchema.optional(),
  last: targetSchema.optional(),
});
const stateSchema = z.object({
  anchor: targetSchema.optional(),
  run: runSchema.optional(),
  purge: purgeSchema.optional(),
});
export const anthropicCacheFactsSchema = z.object({
  kept: stateSchema,
  stripped: stateSchema,
  corrected: stateSchema,
});
export type AnthropicCacheState = z.infer<typeof stateSchema>;
export type AnthropicCacheFacts = z.infer<typeof anthropicCacheFactsSchema>;
type CacheRun = z.infer<typeof runSchema>;
type Spot = z.infer<typeof spotSchema>;
type Target = z.infer<typeof targetSchema>;
export function readAnthropicCacheFacts(auxiliary: Uint8Array): {
  current: AnthropicCacheFacts;
  prefix: AnthropicCacheFacts;
} {
  const value: unknown = JSON.parse(
    new TextDecoder().decode(auxiliary.subarray(592)),
  );
  return z
    .object({
      current: anthropicCacheFactsSchema,
      prefix: anthropicCacheFactsSchema,
    })
    .parse(value);
}
export interface AnthropicCachePlan {
  readonly targets: readonly Target[];
  readonly ttl: '5m' | '1h';
  readonly bytes: number;
  readonly purge?: z.infer<typeof purgeSchema>;
}

export function finishAnthropicPurgeState(
  state: AnthropicCacheState,
): z.infer<typeof purgeSchema> {
  const previous = state.purge ?? { count: 0, image: false };
  const run = state.run;
  if (run === undefined) return previous;
  const beforeImage = run.imagePrevious ?? run.leadingTail;
  const tail = tailTarget(run);
  let expected = previous.expected;
  if (!previous.image && run.image === true)
    expected =
      beforeImage === undefined ? previous.last : target(run, beforeImage);
  return {
    count: previous.count + (run.purgeCount ?? 0),
    tagged:
      previous.tagged ??
      (run.purge === undefined ? undefined : target(run, run.purge)),
    image: previous.image || run.image === true,
    expected,
    last: tail ?? previous.last,
  };
}

export function applyAnthropicPurgeCache(
  cache: AnthropicCachePlan,
  prefixBreakpoints: number,
): AnthropicCachePlan {
  const purge = cache.purge;
  const tagged = purge?.tagged;
  const expected = purge?.expected;
  if (purge?.count !== 1 || tagged === undefined || expected === undefined)
    return cache;
  if (tagged.run !== expected.run || tagged.block !== expected.block)
    return cache;
  if (
    prefixBreakpoints + cache.targets.length >= 3 ||
    cache.targets.some(
      (item) => item.run === tagged.run && item.block === tagged.block,
    )
  )
    return cache;
  const markerBytes =
    Buffer.byteLength(
      JSON.stringify({ cache_control: { type: 'ephemeral', ttl: cache.ttl } }),
    ) - 1;
  const blockify =
    Buffer.byteLength(JSON.stringify([{ type: 'text', text: '' }])) - 2;
  return {
    ...cache,
    targets: [...cache.targets, tagged],
    bytes: cache.bytes + markerBytes + (tagged.string ? blockify : 0),
  };
}

function target(run: CacheRun, spot: Spot): Target {
  const offset = spot.leading ? 0 : run.leading;
  return {
    run: run.ordinal,
    block: run.atoms > 1 ? spot.position + offset : spot.original,
    string: run.atoms === 1 && run.string,
  };
}
function firstAnchor(run: CacheRun): Target | undefined {
  const left = run.leadingAnchor;
  const right = run.otherAnchor;
  const earliest =
    left === undefined ||
    (right !== undefined && right.original < left.original)
      ? right
      : left;
  const spot = run.atoms > 1 ? (left ?? right) : earliest;
  return spot === undefined ? undefined : target(run, spot);
}
function tailTarget(run: CacheRun): Target | undefined {
  const left = run.leadingTail;
  const right = run.otherTail;
  if (run.blocks === 0) return { run: run.ordinal, block: 0, string: true };
  const latest =
    right === undefined ||
    (left !== undefined && left.original > right.original)
      ? left
      : right;
  const spot = run.atoms > 1 ? (right ?? left) : latest;
  return spot === undefined ? undefined : target(run, spot);
}
export function beginAnthropicCacheAtom(
  state: AnthropicCacheState,
  role: CacheRun['role'],
  chain = false,
): AnthropicCacheState {
  const previous = state.run;
  if (previous?.role === role)
    return {
      ...state,
      run: {
        ...previous,
        atoms: previous.atoms + 1,
        chainStart: chain
          ? (previous.chainStart ?? previous.blocks)
          : undefined,
      },
    };
  return {
    anchor:
      state.anchor ??
      (previous === undefined ? undefined : firstAnchor(previous)),
    purge: finishAnthropicPurgeState(state),
    run: {
      role,
      ordinal: previous === undefined ? 0 : previous.ordinal + 1,
      atoms: 1,
      blocks: 0,
      leading: 0,
      other: 0,
      string: false,
      chainStart: chain ? 0 : undefined,
    },
  };
}
function addBlock(
  run: CacheRun,
  block: {
    kind: string;
    blank: boolean;
    anchored: boolean;
    cacheable?: boolean;
    purge?: boolean;
  },
): CacheRun {
  if (block.blank) return run;
  const leading =
    run.role === 'user'
      ? block.kind === 'tool_result'
      : block.kind === 'thinking' || block.kind === 'redacted_thinking';
  const spot: Spot = {
    leading,
    position: leading ? run.leading : run.other,
    original: run.blocks,
  };
  const cacheable =
    block.cacheable ??
    (block.kind !== 'thinking' && block.kind !== 'redacted_thinking');
  const imagePrevious = block.kind === 'image' ? run.otherTail : undefined;
  return {
    ...run,
    blocks: run.blocks + 1,
    leading: run.leading + Number(leading),
    other: run.other + Number(!leading),
    leadingAnchor:
      run.leadingAnchor ?? (leading && block.anchored ? spot : undefined),
    otherAnchor:
      run.otherAnchor ?? (!leading && block.anchored ? spot : undefined),
    leadingTail: leading && cacheable ? spot : run.leadingTail,
    otherTail: !leading && cacheable ? spot : run.otherTail,
    purge: run.purge ?? (block.purge === true ? spot : undefined),
    purgeCount: (run.purgeCount ?? 0) + Number(block.purge === true),
    image: run.image === true || block.kind === 'image',
    imagePrevious: run.image === true ? run.imagePrevious : imagePrevious,
  };
}
export function addAnthropicCachePiece(
  state: AnthropicCacheState,
  atom: AnthropicAtom,
): AnthropicCacheState {
  let run = state.run;
  if (run === undefined) throw new Error('Cache piece has no message run');
  if (atom.form === 'string') {
    run = addBlock(run, {
      kind: 'text',
      blank: atom.blank,
      anchored: atom.anchored,
      purge: atom.purge,
    });
    if (!atom.blank) run = { ...run, string: true };
  } else for (const block of atom.blocks) run = addBlock(run, block);
  return { ...state, run };
}
export function firstAnthropicCacheAnchor(
  state: AnthropicCacheState,
): Target | undefined {
  return (
    state.anchor ??
    (state.run === undefined ? undefined : firstAnchor(state.run))
  );
}
export function anthropicCachePlan(
  state: AnthropicCacheState,
  settings: Pick<RowFormatSettings, 'reasoningEnabled' | 'model'>,
  ttl: '5m' | '1h',
): AnthropicCachePlan {
  const run = state.run;
  const anchor =
    state.anchor ?? (run === undefined ? undefined : firstAnchor(run));
  const synthetic =
    run === undefined ||
    (run.role === 'assistant' &&
      (settings.reasoningEnabled || !modelSupportsPrefill(settings.model)));
  const tail = synthetic
    ? { run: -1, block: 0, string: true }
    : tailTarget(run);
  const targets = anchor === undefined ? [] : [anchor];
  if (
    tail !== undefined &&
    !targets.some((item) => item.run === tail.run && item.block === tail.block)
  )
    targets.push(tail);
  const markerBytes =
    Buffer.byteLength(
      JSON.stringify({ cache_control: { type: 'ephemeral', ttl } }),
    ) - 1;
  const blockify =
    Buffer.byteLength(JSON.stringify([{ type: 'text', text: '' }])) - 2;
  return {
    targets,
    ttl,
    purge: finishAnthropicPurgeState(state),
    bytes: targets.reduce(
      (total, item) => total + markerBytes + (item.string ? blockify : 0),
      0,
    ),
  };
}
export function hasAnthropicCacheTarget(
  plan: AnthropicCachePlan | undefined,
  run: number,
  block: number,
): boolean {
  return (
    plan?.targets.some((item) => item.run === run && item.block === block) ===
    true
  );
}
