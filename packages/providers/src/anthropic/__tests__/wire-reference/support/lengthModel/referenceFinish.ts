/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0, reference machine stage 3: the merge of consecutive
 * roles, the finishing pass, and the cache controls (context prefix, tail
 * breakpoint, anchor breakpoint, and the media purge boundary pass). It is
 * the reference materializer: the facts and overlays must reproduce today's
 * JSON byte for byte before any length claim is made. Test-side code.
 */

import type { AnthropicMessageBlock } from '../../../../AnthropicMessageNormalizer.js';
import { getEmptyMessagePlaceholder } from '../../../../AnthropicMessageValidator.js';
import { tagMediaPurgeBoundaryBlock } from '../../../../AnthropicMediaPurgeCache.js';
import { readPurgeBlockTag } from '../../../../AnthropicMediaPurgeCache.js';
import { modelSupportsPrefill } from '../../../../AnthropicModelData.js';
import { sanitizeBlockForCacheControl } from '../../../../AnthropicRequestBuilder.js';
import { selectLastCacheableBlockIndex } from '../../../../AnthropicRequestBuilder.js';
import { formatContextPrefix } from '../../../../../utils/systemPromptPlacement.js';
import type { WireSettings } from '../wireBuilderHarness.js';
import { assemble } from './referenceAssemble.js';
import {
  cacheable,
  type Assembled,
  type OBlock,
  type OMsg,
  type Overlay,
  type Policy,
} from './referenceTypes.js';
import { validate } from './referenceValidate.js';
import { blockFact, jsonBytes, type UnitFact } from './unitFacts.js';

const CONTINUE_TEXT = 'Continue the conversation';

type Ttl = '5m' | '1h';

function leads(obj: AnthropicMessageBlock, role: 'U' | 'A'): boolean {
  if (role === 'U') return obj.type === 'tool_result';
  return obj.type === 'thinking' || obj.type === 'redacted_thinking';
}

function blockify(message: OMsg): void {
  if (message.text === undefined) return;
  const fact = blockFact({ type: 'text', text: message.text });
  const anchored = message.anchorText === true && cacheable(fact.obj);
  if (message.purgeText !== undefined) {
    tagMediaPurgeBoundaryBlock(fact.obj, message.purgeText);
  }
  message.blocks = [{ f: fact, obj: fact.obj, anchored }, ...message.blocks];
  delete message.text;
  delete message.anchorText;
  delete message.purgeText;
}

export function mergeRoles(list: readonly OMsg[]): OMsg[] {
  const out: OMsg[] = [];
  for (const message of list) {
    if (out.length > 0 && out[out.length - 1].role === message.role) {
      const previous = out[out.length - 1];
      blockify(previous);
      blockify(message);
      previous.blocks = [...previous.blocks, ...message.blocks];
      previous.atoms = [...previous.atoms, ...message.atoms];
      previous.ordered = true;
    } else {
      out.push(message);
    }
  }
  return out;
}

export interface Finish {
  reasoningEnabled: boolean;
  currentModel?: string;
}

function textMessage(role: 'U' | 'A', text: string): OMsg {
  return { id: -1, role, text, blocks: [], atoms: [] };
}

function orderMerged(list: readonly OMsg[]): void {
  for (const message of list) {
    if (message.ordered !== true) continue;
    message.blocks = [
      ...message.blocks.filter((blk) => leads(blk.obj, message.role)),
      ...message.blocks.filter((blk) => !leads(blk.obj, message.role)),
    ];
    delete message.ordered;
  }
}

function fillEmpty(message: OMsg): void {
  const placeholder = getEmptyMessagePlaceholder(
    message.role === 'A' ? 'assistant' : 'user',
  );
  if (message.text !== undefined) {
    if (message.text.trim() === '') message.text = placeholder;
    return;
  }
  if (message.blocks.length === 0) {
    message.text = placeholder;
    return;
  }
  message.blocks = message.blocks.filter(
    (blk) => !(blk.obj.type === 'text' && blk.obj.text.trim() === ''),
  );
  if (message.blocks.length === 0) message.text = placeholder;
}

export function finish(list: readonly OMsg[], options: Finish): OMsg[] {
  orderMerged(list);
  let out = [...list];
  if (out.length > 0 && out[0].role !== 'U') {
    out = [textMessage('U', CONTINUE_TEXT), ...out];
  }
  if (out.length === 0) out = [textMessage('U', 'Hello')];
  const last = out[out.length - 1];
  if (
    last.role === 'A' &&
    (options.reasoningEnabled || !modelSupportsPrefill(options.currentModel))
  ) {
    out = [...out, textMessage('U', CONTINUE_TEXT)];
  }
  out.forEach(fillEmpty);
  return out;
}

export interface CacheOpts {
  ttl?: Ttl;
  contextPrefix?: string;
  /** The semantic media purge mode asks for a boundary breakpoint. */
  mediaPurge?: boolean;
  /**
   * Negative control only: skip the three-breakpoint limit of the purge
   * pass. A model that ignores the limit must be wrong on the corpus.
   */
  controlIgnoreBreakpointLimit?: boolean;
}

const messageBytes = (message: OMsg): number =>
  jsonBytes({
    role: message.role === 'U' ? 'user' : 'assistant',
    content: message.text ?? message.blocks.map((blk) => blk.obj),
  });

function toStringArray(message: OMsg, ttl: Ttl): void {
  if (message.text === undefined) return;
  const obj = sanitizeBlockForCacheControl(
    { type: 'text', text: message.text },
    ttl,
  );
  delete message.text;
  delete message.anchorText;
  message.blocks = [
    { f: blockFact(obj), obj, anchored: false },
    ...message.blocks,
  ];
}

function lastCacheable(message: OMsg): OBlock | undefined {
  for (let at = message.blocks.length - 1; at >= 0; at -= 1) {
    if (cacheable(message.blocks[at].obj)) return message.blocks[at];
  }
  return undefined;
}

/** Measures the messages a pass touches, before and after. */
class Touched {
  private readonly before = new Map<OMsg, number>();

  touch(message: OMsg): void {
    if (!this.before.has(message)) {
      this.before.set(message, messageBytes(message));
    }
  }

  get count(): number {
    return this.before.size;
  }

  get delta(): number {
    let sum = 0;
    for (const [message, was] of this.before)
      sum += messageBytes(message) - was;
    return sum;
  }
}

function applyTail(list: readonly OMsg[], ttl: Ttl, touched: Touched): void {
  const tail = list[list.length - 1];
  touched.touch(tail);
  if (tail.text !== undefined) {
    toStringArray(tail, ttl);
    return;
  }
  const blk = lastCacheable(tail);
  if (blk !== undefined) blk.obj = sanitizeBlockForCacheControl(blk.obj, ttl);
}

/** True when this message holds the anchor, whether or not it needed a breakpoint. */
function anchorMessage(message: OMsg, ttl: Ttl, touched: Touched): boolean {
  if (message.text !== undefined) {
    if (message.anchorText !== true || message.text.trim() === '') return false;
    touched.touch(message);
    toStringArray(message, ttl);
    return true;
  }
  const blk = message.blocks.find((candidate) => candidate.anchored);
  if (blk === undefined) return false;
  if ('cache_control' in blk.obj) return true;
  touched.touch(message);
  blk.obj = sanitizeBlockForCacheControl(blk.obj, ttl);
  return true;
}

function applyAnchor(list: readonly OMsg[], ttl: Ttl, touched: Touched): void {
  list.some((message) => anchorMessage(message, ttl, touched));
}

interface Location {
  readonly message: number;
  readonly block: number;
}

/** The single boundary tag the converter left on a message or block, if any. */
function taggedBoundary(list: readonly OMsg[]): Location | undefined {
  const found: Location[] = [];
  list.forEach((message, at) => {
    if (message.text !== undefined) {
      if (message.purgeText !== undefined) {
        found.push({ message: at, block: 0 });
      }
      return;
    }
    message.blocks.forEach((blk, index) => {
      if (readPurgeBlockTag(blk.obj) !== undefined) {
        found.push({ message: at, block: index });
      }
    });
  });
  return found.length === 1 ? found[0] : undefined;
}

function oldestImage(list: readonly OMsg[]): Location | undefined {
  for (let at = 0; at < list.length; at += 1) {
    const index = list[at].blocks.findIndex((blk) => blk.obj.type === 'image');
    if (list[at].text === undefined && index >= 0) {
      return { message: at, block: index };
    }
  }
  return undefined;
}

function previousCacheable(
  list: readonly OMsg[],
  image: Location,
): Location | undefined {
  const own = list[image.message];
  if (own.text === undefined && image.block > 0) {
    const index = selectLastCacheableBlockIndex(
      own.blocks.slice(0, image.block).map((blk) => blk.obj),
    );
    if (index >= 0) return { message: image.message, block: index };
  }
  for (let at = image.message - 1; at >= 0; at -= 1) {
    const message = list[at];
    if (message.text !== undefined) {
      if (message.text.trim().length > 0) return { message: at, block: 0 };
      continue;
    }
    const index = selectLastCacheableBlockIndex(
      message.blocks.map((blk) => blk.obj),
    );
    if (index >= 0) return { message: at, block: index };
  }
  return undefined;
}

function breakpoints(list: readonly OMsg[]): number {
  let count = 0;
  for (const message of list) {
    if (message.text !== undefined) continue;
    for (const blk of message.blocks) {
      if ('cache_control' in blk.obj) count += 1;
    }
  }
  return count;
}

export type PurgeEvidence = 'added' | 'reused' | undefined;

/** The media purge pass: `attachMediaPurgeCacheControl` over the reference messages. */
function applyPurge(
  list: readonly OMsg[],
  ttl: Ttl,
  touched: Touched,
  ignoreLimit: boolean,
): PurgeEvidence {
  const tagged = taggedBoundary(list);
  const image = oldestImage(list);
  if (tagged === undefined || image === undefined) return undefined;
  const expected = previousCacheable(list, image);
  if (
    expected === undefined ||
    expected.message !== tagged.message ||
    expected.block !== tagged.block
  ) {
    return undefined;
  }
  const message = list[tagged.message];
  if (
    message.text === undefined &&
    'cache_control' in message.blocks[tagged.block].obj
  ) {
    return 'reused';
  }
  if (!ignoreLimit && breakpoints(list) >= 3) return undefined;
  touched.touch(message);
  if (message.text !== undefined) {
    toStringArray(message, ttl);
  } else {
    const blk = message.blocks[tagged.block];
    blk.obj = sanitizeBlockForCacheControl(blk.obj, ttl);
  }
  return 'added';
}

export interface CacheResult {
  list: OMsg[];
  /** Bytes the cache controls add, measured on the messages they touch. */
  delta: number;
  /** Messages the plan read (tail, anchor, purge boundary): bounded by 3. */
  touched: number;
  evidence: PurgeEvidence;
}

function prefixMessage(cache: CacheOpts, text: string): OMsg {
  const message: OMsg = { id: -2, role: 'U', blocks: [], atoms: [] };
  if (cache.ttl === undefined) {
    message.text = text;
  } else {
    const obj = sanitizeBlockForCacheControl({ type: 'text', text }, cache.ttl);
    message.blocks = [{ f: blockFact(obj), obj, anchored: false }];
  }
  return message;
}

export function applyCache(
  list: readonly OMsg[],
  cache: CacheOpts,
): CacheResult {
  let out = [...list];
  let delta = 0;
  if (cache.contextPrefix !== undefined && cache.contextPrefix !== '') {
    const message = prefixMessage(
      cache,
      formatContextPrefix(cache.contextPrefix),
    );
    out = [message, ...out];
    delta += 1 + messageBytes(message);
  }
  if (cache.ttl === undefined) {
    return { list: out, delta, touched: 0, evidence: undefined };
  }
  const touched = new Touched();
  applyTail(out, cache.ttl, touched);
  applyAnchor(out, cache.ttl, touched);
  const evidence =
    cache.mediaPurge === true
      ? applyPurge(
          out,
          cache.ttl,
          touched,
          cache.controlIgnoreBreakpointLimit === true,
        )
      : undefined;
  return {
    list: out,
    delta: delta + touched.delta,
    touched: touched.count,
    evidence,
  };
}

export function toJson(list: readonly OMsg[]): string {
  return JSON.stringify(
    list.map((message) => ({
      role: message.role === 'U' ? 'user' : 'assistant',
      content: message.text ?? message.blocks.map((blk) => blk.obj),
    })),
  );
}

export interface ReferenceRun {
  json: string;
  overlay: Overlay[];
  asm: Assembled;
  repaired: boolean;
  final: OMsg[];
  cacheDelta: number;
  touched: number;
  evidence: PurgeEvidence;
}

/** The reference run, end to end. */
export function referenceRun(
  units: readonly UnitFact[],
  policy: Policy,
  settings: WireSettings,
  cache: CacheOpts,
): ReferenceRun {
  const asm = assemble(units, policy);
  const validated = validate(asm, units);
  const finished = finish(mergeRoles(validated.msgs), {
    reasoningEnabled: settings.reasoningEnabled,
    currentModel: settings.currentModel,
  });
  const cached = applyCache(finished, cache);
  return {
    json: toJson(cached.list),
    overlay: validated.overlay,
    asm,
    repaired: validated.repaired,
    final: cached.list,
    cacheDelta: cached.delta,
    touched: cached.touched,
    evidence: cached.evidence,
  };
}
