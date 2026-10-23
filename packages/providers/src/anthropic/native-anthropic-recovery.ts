/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { NativeFactIndexReader } from '@vybestack/llxprt-code-core/journal/nativeFactIndex.js';
import type { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { requestFormatSlot } from '@vybestack/llxprt-code-core/services/history/native-provider-format.js';
import type { ImageDimensionBudget } from '@vybestack/llxprt-code-tools/utils/imageDimensionBudget.js';
import type { AnthropicMessageBlock } from './AnthropicMessageNormalizer.js';
import type { StoredAnthropicRequestPlan } from './journal-anthropic-length.js';
import type { AnthropicStreamRepair } from './anthropic-stream-repair.js';
import { anthropicRepairScope } from './anthropic-repair-index.js';
import {
  droppedImageBlock,
  exceedsAnthropicImageDimensions,
} from './AnthropicImageSanitizer.js';
import {
  hasAnthropicCacheTarget,
  readAnthropicCacheFacts,
  type AnthropicCacheState,
} from './anthropic-cache-facts.js';
import {
  anthropicRecoveryEvents,
  recoveryImageSize,
  type RecoveryImageFact,
} from './anthropic-recovery-facts.js';

export interface AnthropicRecoveryAdjustment {
  readonly bytes: number;
  readonly replaced: number;
}
const none: AnthropicRecoveryAdjustment = { bytes: 0, replaced: 0 };
const placeholderBytes = Buffer.byteLength(JSON.stringify(droppedImageBlock()));

async function required(
  facts: NativeFactIndexReader,
  key: ReadonlyArray<string | number>,
): Promise<readonly number[]> {
  const values = await facts.get(key);
  if (values === undefined)
    throw new Error(`Missing Anthropic image recovery facts: ${key.join('/')}`);
  return values;
}

function adjustment(
  fact: RecoveryImageFact,
  run: readonly number[],
  measured: StoredAnthropicRequestPlan,
  budget: ImageDimensionBudget,
): AnthropicRecoveryAdjustment {
  const [width, height, bytes] = fact.image;
  if (!exceedsAnthropicImageDimensions({ width, height }, budget)) return none;
  const [ordinal, original, position, leading] = fact.position;
  const offset = leading === 0 ? run[1] : 0;
  const block = run[0] > 1 ? position + offset : original;
  const marker =
    fact.source[3] === 0 &&
    hasAnthropicCacheTarget(measured.cache, ordinal, block)
      ? Buffer.byteLength(
          JSON.stringify({
            cache_control: { type: 'ephemeral', ttl: measured.cache?.ttl },
          }),
        ) - 1
      : 0;
  return { bytes: placeholderBytes - bytes - marker, replaced: 1 };
}

function imagePart(
  block: AnthropicMessageBlock,
  nested: number,
): AnthropicMessageBlock | undefined {
  if (nested === 0) return block;
  return block.type === 'tool_result' && Array.isArray(block.content)
    ? block.content[nested - 1]
    : undefined;
}

async function changedImage(
  engine: AnthropicStreamRepair,
  source: readonly number[],
): Promise<readonly number[]> {
  const [key, pieceAt, part, nested] = source;
  for await (const atom of engine.atoms(key)) {
    if (atom.key !== key) break;
    let at = 0;
    for await (const piece of atom.openPieces()) {
      if (at++ !== pieceAt || typeof piece === 'string') continue;
      const block = imagePart(piece[part], nested);
      const image = block === undefined ? undefined : recoveryImageSize(block);
      if (image !== undefined) return image;
    }
  }
  throw new Error('Changed Anthropic media lost its stored recovery position');
}

async function persistedAdjustment(
  facts: NativeFactIndexReader,
  engine: AnthropicStreamRepair,
  measured: StoredAnthropicRequestPlan,
  budget: ImageDimensionBudget,
): Promise<AnthropicRecoveryAdjustment> {
  const count = await required(facts, ['recovery-images']);
  let total = none;
  for (let at = 0; at < count[0]; at++) {
    const source = await required(facts, ['recovery-source', at]);
    const position = await required(facts, ['recovery-position', at]);
    const changed = engine.source.query.viewPlan.changedSources.some(
      (row) =>
        source[0] >= row.start * 4 &&
        source[0] < (row.start + row.oldCount) * 4,
    );
    const image = changed
      ? await changedImage(engine, source)
      : await required(facts, ['recovery-image', at]);
    const run = await required(facts, ['recovery-run', position[0]]);
    const next = adjustment({ source, position, image }, run, measured, budget);
    total = {
      bytes: total.bytes + next.bytes,
      replaced: total.replaced + next.replaced,
    };
  }
  return total;
}

async function pendingAdjustment(
  snapshot: VersionSnapshot,
  engine: AnthropicStreamRepair,
  measured: StoredAnthropicRequestPlan,
  budget: ImageDimensionBudget,
): Promise<AnthropicRecoveryAdjustment> {
  if (snapshot.units === engine.source.query.count) return none;
  const slot = requestFormatSlot(snapshot, measured.settings);
  const auxiliary = await snapshot.formatAuxiliary(slot);
  if (auxiliary === undefined)
    throw new Error('Missing Anthropic pending-media recovery prefix');
  const state: AnthropicCacheState =
    readAnthropicCacheFacts(auxiliary).current.kept;
  let images: RecoveryImageFact[] = [];
  let total = none;
  for await (const event of anthropicRecoveryEvents(
    engine,
    state,
    snapshot.units * 4,
  )) {
    if (event.kind === 'image') images.push(event.fact);
    else {
      for (const fact of images) {
        const next = adjustment(
          fact,
          [event.run.atoms, event.run.leading],
          measured,
          budget,
        );
        total = {
          bytes: total.bytes + next.bytes,
          replaced: total.replaced + next.replaced,
        };
      }
      images = [];
    }
  }
  return total;
}

export async function planAnthropicImageRecovery(
  snapshot: VersionSnapshot,
  engine: AnthropicStreamRepair,
  measured: StoredAnthropicRequestPlan,
  budget: ImageDimensionBudget | undefined,
): Promise<AnthropicRecoveryAdjustment> {
  if (budget === undefined) return none;
  const facts = await snapshot.nativeFacts(
    anthropicRepairScope(measured.settings),
  );
  const stored = await persistedAdjustment(facts, engine, measured, budget);
  const pending = await pendingAdjustment(snapshot, engine, measured, budget);
  return {
    bytes: stored.bytes + pending.bytes,
    replaced: stored.replaced + pending.replaced,
  };
}
