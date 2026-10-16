/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Aggregate } from '../../aggregate.js';
import type { SlotSummary, SummaryKind } from '../../slotSummary.js';
import type { SlotTable } from '../../slotTable.js';
import { MUTATION } from '../../recordKinds.js';
import type { TrailerHeader } from '../../trailerRecord.js';
import type { SeededRandom } from './seededRandom.js';

const STATES = { anthropic: 10, chat: 6, responses: 2 } as const;

function list<T>(count: number, make: () => T): T[] {
  return Array.from({ length: count }, make);
}

function transferTable(random: SeededRandom, states: number) {
  return {
    bytes: list(states, () => random.bits(53)),
    count: list(states, () => random.mixed(2 ** 32)),
    out: list(states, () => random.int(states)),
  };
}

export function randomSlotSummary(
  random: SeededRandom,
  kind: SummaryKind,
): SlotSummary {
  const states = STATES[kind];
  const variant = () => transferTable(random, states);
  if (kind === 'anthropic') {
    return {
      kind,
      variants: [variant(), variant()],
      cOut: [random.int(256), random.int(256)],
      lastL: [random.bigBits(64), random.bigBits(64)],
    };
  }
  if (kind === 'chat') {
    const chat = () => ({
      ...variant(),
      p: list(states, () => random.bits(53)),
      carry: random.int(1 << states),
    });
    return { kind, variants: [chat(), chat()] };
  }
  const responses = () => ({ ...variant(), r: random.mixed(2 ** 32) });
  return { kind, variants: [responses(), responses()] };
}

function triple<T>(make: () => T): readonly [T, T, T] {
  return [make(), make(), make()];
}

export function randomAggregate(random: SeededRandom): Aggregate {
  const u32 = () => random.mixed(2 ** 32);
  const u64 = () => random.bits(53);
  const label = () => random.bigBits(64);
  return {
    rows: u32(),
    curated: u32(),
    units: u32(),
    tokens: [u64(), u64(), u64(), u64()],
    tokensMissing: [u32(), u32(), u32(), u32()],
    liveBytes: u64(),
    mediaChars: u64(),
    imageChars: triple(u64),
    pdfBytes: triple(u64),
    imageRows: u32(),
    thinkingRows: u32(),
    callRows: u32(),
    reconRows: u32(),
    pairSensitiveRows: u32(),
    imageContribRows: u32(),
    callBlocks: u32(),
    unmappedBlocks: u32(),
    lastThinking: label(),
    lastInvalidate: label(),
    lastCacheable: label(),
    firstAnchor: label(),
    firstImage: label(),
    ownerBloom: label(),
    missingBase: triple(u32),
    missingImg: triple(u32),
    stamp: triple(() => ({ gen: u32(), imageGen: u32() })),
    summaries: triple(() => random.bytes(296)),
  };
}

export function randomSlotTable(random: SeededRandom): SlotTable {
  const u32 = () => random.mixed(2 ** 32);
  const format = () => ({
    formatKeyHash: random.bigBits(64),
    formatRev: u32(),
    gen: u32(),
    imageKeyHash: random.bigBits(64),
    imageGen: u32(),
  });
  const family = () => ({
    familyKeyHash: random.bigBits(64),
    estimatorRev: u32(),
    gen: u32(),
  });
  return {
    formatSlots: triple(format),
    familySlots: [family(), family(), family(), family()],
  };
}

export function randomTrailer(
  random: SeededRandom,
  selfOffset: number,
  syncMarker: Uint8Array,
): TrailerHeader {
  const offset = () => random.bits(48);
  const mutations = Object.values(MUTATION);
  return {
    selfOffset,
    commitSeq: random.bits(48),
    parent: offset(),
    skip: triple(offset),
    lineage: random.bigBits(64),
    lineageDepth: random.bits(40),
    mutation: mutations[random.int(mutations.length)],
    groupTag: random.bigBits(56),
    mutationArg0: random.bigBits(64),
    mutationArg1: random.bigBits(64),
    rowRoot: offset(),
    idRoot: offset(),
    metaRoot: offset(),
    stateRoot: offset(),
    nextLabel: random.bigBits(64),
    firstLabel: random.bigBits(64),
    lastRowOffset: offset(),
    lastOwner: random.mixed(2 ** 32),
    ckptBytes: random.bits(53),
    rootAggregate: randomAggregate(random),
    slots: randomSlotTable(random),
    durableEnd: selfOffset + 1500,
    syncMarker,
  };
}
