/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RepairMessage } from './anthropic-repair-source.js';

/** Messages have nondecreasing ends, including overlapping result/chain pairs. */
export function firstRepairMessage(
  messages: readonly RepairMessage[],
  from: number,
): number {
  let low = 0;
  let high = messages.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (messages[middle].end < from) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function repairMessageAt(
  messages: readonly RepairMessage[],
  at: number,
  slot: RepairMessage['slot'],
): RepairMessage | undefined {
  for (
    let index = firstRepairMessage(messages, at);
    index < messages.length;
    index++
  ) {
    const message = messages[index];
    if (message.start > at) break;
    if (message.slot === slot) return message;
  }
  return undefined;
}
