/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 phase 0: the OpenAI chat length model as a finite-state
 * transducer over the unit stream, and its transfer summaries.
 *
 * Boundary state (6 states, closed under every unit):
 *   sep   : a message has been written, so a comma is due before the next
 *   media : tool media is pending a flush: none, images only, or has a video
 * plus one additive counter P, the bytes of the pending media parts. A flush
 * reads P once, so the transfer function is affine in the incoming P with a
 * 0/1 coefficient, and that composes.
 *
 * A unit contributes by (its stored facts, boundary state). A node summary is
 * a total function from the 6 incoming states. Composition is function
 * composition. Test-side code.
 */

import { jsonBytes } from '../../../../__tests__/support/lengthModel/bytes.js';

/** Which stored variant of a unit is sent: thinking kept (0) or removed (1). */
export type Variant = 0 | 1;

/** One id occurrence in a message, with the bytes of its id placeholder. */
export interface IdUse {
  readonly kind: 'mapped' | 'unmapped';
  /** mapped: the raw call id. unmapped: a unique key of the occurrence. */
  readonly key: string;
  /** Bytes of the id placeholder that the stored message length leaves out. */
  readonly placeholderBytes: number;
}

export interface ChatMessageFact {
  /** JSON bytes of the message, id placeholders left out. */
  readonly bytes: number;
  readonly role: string;
  /** The ids an assistant message lists; undefined when it has no calls. */
  readonly callIds: readonly string[] | undefined;
  readonly toolCallId?: string;
  readonly uses: readonly IdUse[];
}

export interface PendingMedia {
  readonly video: boolean;
  /** JSON bytes of the converted part; null when no part is written. */
  readonly part: number | null;
}

export interface ChatUnit {
  readonly index: number;
  readonly speaker: string;
  readonly hasThinking: boolean;
  readonly hasCall: boolean;
  readonly messages: readonly [
    readonly ChatMessageFact[],
    readonly ChatMessageFact[],
  ];
  /** The tool media this row adds to the pending flush (tool rows only). */
  readonly images: readonly [readonly PendingMedia[], readonly PendingMedia[]];
}

export interface ChatState {
  readonly sep: 0 | 1;
  readonly media: 0 | 1 | 2;
}

export const STATES: readonly ChatState[] = ([0, 1] as const).flatMap((sep) =>
  ([0, 1, 2] as const).map((media) => ({ sep, media })),
);

export function stateIndex(sep: number, media: number): number {
  return sep * 3 + media;
}

/** The state after the system message: a comma is due, nothing pending. */
export const START = stateIndex(1, 0);

export interface ChatSummary {
  readonly out: readonly number[];
  readonly bytes: readonly number[];
  /** 1 when pending media entering the node survives it (no flush). */
  readonly carry: readonly number[];
  /** Pending media bytes the node adds. */
  readonly pending: readonly number[];
  readonly messages: readonly number[];
}

export const IDENTITY: ChatSummary = {
  out: STATES.map((_, at) => at),
  bytes: STATES.map(() => 0),
  carry: STATES.map((state) => (state.media === 0 ? 0 : 1)),
  pending: STATES.map(() => 0),
  messages: STATES.map(() => 0),
};

const TOOL_MEDIA_TEXT = (video: boolean): number =>
  jsonBytes({
    type: 'text',
    text: video ? '[Media from tool response]' : '[Images from tool response]',
  });

/** `{"role":"user","content":` and `}` around the tool media parts. */
const FLUSH_FRAME = jsonBytes({ role: 'user', content: [] }) - 2;

/** Bytes of a tool-media message without the parts it carries: `[` and `]`. */
function flushBytes(video: boolean): number {
  return FLUSH_FRAME + 2 + TOOL_MEDIA_TEXT(video);
}

/** The model variants. `ignoreMediaParts` is the control without P. */
export interface LeafOptions {
  readonly ignoreMediaParts: boolean;
}

interface StateStep {
  out: number;
  bytes: number;
  carry: number;
  pending: number;
  messages: number;
}

function stepState(
  unit: ChatUnit,
  variant: Variant,
  dropped: ReadonlySet<number>,
  state: ChatState,
  options: LeafOptions,
): StateStep {
  let { sep, media } = state;
  const step: StateStep = {
    out: 0,
    bytes: 0,
    carry: media === 0 ? 0 : 1,
    pending: 0,
    messages: 0,
  };
  const emit = (size: number): void => {
    step.bytes += sep + size;
    sep = 1;
    step.messages += 1;
  };
  if (unit.speaker !== 'tool' && media !== 0) {
    emit(flushBytes(media === 2));
    step.carry = 0;
    media = 0;
  }
  unit.messages[variant].forEach((message, at) => {
    if (!dropped.has(at)) emit(message.bytes);
  });
  if (unit.speaker === 'tool') {
    for (const image of unit.images[variant]) {
      const kind: 1 | 2 = image.video ? 2 : 1;
      if (kind > media) media = kind;
      if (image.part !== null && !options.ignoreMediaParts) {
        step.pending += 1 + image.part;
      }
    }
  }
  step.out = stateIndex(sep, media);
  return step;
}

export function leaf(
  unit: ChatUnit,
  variant: Variant,
  dropped: ReadonlySet<number>,
  options: LeafOptions,
): ChatSummary {
  const steps = STATES.map((state) =>
    stepState(unit, variant, dropped, state, options),
  );
  return {
    out: steps.map((step) => step.out),
    bytes: steps.map((step) => step.bytes),
    carry: steps.map((step) => step.carry),
    pending: steps.map((step) => step.pending),
    messages: steps.map((step) => step.messages),
  };
}

/**
 * Entries are affine in the incoming pending bytes P (zero unless the
 * incoming state has media pending): `bytes' = bytes + (1 - carry) * P` and
 * `P_out = carry * P + pending`. The flush of the pending bytes that the left
 * node leaves behind is owed by the right node when it does not carry them on.
 */
export function compose(left: ChatSummary, right: ChatSummary): ChatSummary {
  const at = STATES.map((_, index) => index);
  const mid = at.map((index) => left.out[index]);
  return {
    out: mid.map((m) => right.out[m]),
    bytes: at.map((index) => {
      const m = mid[index];
      const owed = STATES[m].media !== 0 && right.carry[m] === 0 ? 1 : 0;
      return left.bytes[index] + right.bytes[m] + owed * left.pending[index];
    }),
    carry: at.map((index) => left.carry[index] * right.carry[mid[index]]),
    pending: at.map(
      (index) =>
        right.carry[mid[index]] * left.pending[index] +
        right.pending[mid[index]],
    ),
    messages: at.map(
      (index) => left.messages[index] + right.messages[mid[index]],
    ),
  };
}

export function sameSummary(left: ChatSummary, right: ChatSummary): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export interface ChatTotal {
  /** Bytes of the stream's messages, commas included, without the brackets. */
  readonly bytes: number;
  readonly messages: number;
}

/**
 * The root summary read from `start`: the end-of-stream flush of the media
 * still pending, which owes the whole run's pending bytes.
 */
export function totalOf(root: ChatSummary, start: number = START): ChatTotal {
  const end = STATES[root.out[start]];
  let bytes = root.bytes[start];
  let messages = root.messages[start];
  if (end.media !== 0) {
    bytes += end.sep + flushBytes(end.media === 2) + root.pending[start];
    messages += 1;
  }
  return { bytes, messages };
}
