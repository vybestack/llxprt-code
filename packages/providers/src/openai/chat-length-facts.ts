/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ChatVariant } from '@vybestack/llxprt-code-core/journal/slotSummary.js';

export interface ChatMessageLengthFact {
  readonly bytes: number;
  readonly dropped: boolean;
}
export interface ChatMediaLengthFact {
  readonly bytes: number | null;
  readonly video: boolean;
}
export interface ChatUnitLengthFacts {
  readonly speaker: string;
  readonly messages: readonly ChatMessageLengthFact[];
  readonly media: readonly ChatMediaLengthFact[];
}
const jsonBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), 'utf8');
export const chatMediaFrameBytes = (video: boolean): number =>
  jsonBytes({
    role: 'user',
    content: [
      {
        type: 'text',
        text: video
          ? '[Media from tool response]'
          : '[Images from tool response]',
      },
    ],
  });

export function chatUnitSummary(unit: ChatUnitLengthFacts): ChatVariant {
  const states = Array.from({ length: 6 }, (_, state) => state);
  const steps = states.map((state) => {
    let media = state % 3;
    let sep = state >= 3 ? 1 : 0;
    let bytes = 0;
    let count = 0;
    let carry = media === 0 ? 0 : 1;
    let p = 0;
    const emit = (size: number): void => {
      bytes += sep + size;
      sep = 1;
      count++;
    };
    if (unit.speaker !== 'tool' && media !== 0) {
      emit(chatMediaFrameBytes(media === 2));
      carry = 0;
      media = 0;
    }
    for (const message of unit.messages)
      if (!message.dropped) emit(message.bytes);
    if (unit.speaker === 'tool')
      for (const part of unit.media) {
        media = Math.max(media, part.video ? 2 : 1);
        if (part.bytes !== null) p += 1 + part.bytes;
      }
    return { bytes, count, out: sep * 3 + media, carry, p };
  });
  return {
    bytes: steps.map((step) => step.bytes),
    count: steps.map((step) => step.count),
    out: steps.map((step) => step.out),
    p: steps.map((step) => step.p),
    carry: steps.reduce((mask, step, state) => mask | (step.carry << state), 0),
  };
}
