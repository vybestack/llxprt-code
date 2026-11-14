/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the index fact of the chat model, which messages the
 * body leaves out. `validToolMessage` keeps a tool message only when the last
 * assistant message with calls (or the tool media flush that clears them)
 * lists its call id; the check is replayed over the unit stream in order.
 */

import type { ChatUnit, Variant } from './chatTransducer.js';

/** `filterThinkingForContext`: any policy but 'none' and 'all' keeps the last. */
export type StripPolicy = 'none' | 'all' | 'allButLast';

export function variantOf(
  strip: StripPolicy,
  index: number,
  lastThinking: number,
): Variant {
  if (strip === 'none') return 0;
  if (strip === 'all') return 1;
  return index === lastThinking ? 0 : 1;
}

export function lastThinkingUnit(units: readonly ChatUnit[]): number {
  return units.reduce(
    (last, unit) => (unit.hasThinking ? unit.index : last),
    -1,
  );
}

/** Per unit, the indexes of the messages of its sent variant that are dropped. */
export function droppedMessages(
  units: readonly ChatUnit[],
  variantOfUnit: (index: number) => Variant,
): Array<ReadonlySet<number>> {
  const hasCalls = units.some((unit) => unit.hasCall);
  let lastCallIds: readonly string[] = [];
  let pendingImages = 0;
  return units.map((unit) => {
    const dropped = new Set<number>();
    if (unit.speaker !== 'tool' && pendingImages > 0) {
      pendingImages = 0;
      lastCallIds = [];
    }
    const variant = variantOfUnit(unit.index);
    unit.messages[variant].forEach((message, at) => {
      const tool = message.role === 'tool';
      if (tool && hasCalls && !lastCallIds.includes(message.toolCallId ?? '')) {
        dropped.add(at);
      } else if (message.role === 'assistant') {
        if (message.callIds !== undefined) lastCallIds = message.callIds;
      } else if (!tool) {
        lastCallIds = [];
      }
    });
    pendingImages += unit.images[variant].length;
    return dropped;
  });
}
