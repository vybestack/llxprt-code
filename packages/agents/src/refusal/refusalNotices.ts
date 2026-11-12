/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** "15 s", "250 ms" or "now" for a wait in milliseconds. */
export function formatRefusalDelay(ms: number): string {
  if (ms <= 0) return 'now';
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${ms} ms`;
}

/** Shown when a refused request is about to be resent. */
export function describeRefusalRetry(input: {
  readonly model: string;
  readonly delayMs: number;
  readonly retryNumber: number;
  readonly retries: number;
}): string {
  const wait =
    input.delayMs <= 0 ? 'now' : `in ${formatRefusalDelay(input.delayMs)}`;
  return `Model ${input.model} refused the request; retrying ${wait} (retry ${input.retryNumber} of ${input.retries}).`;
}

/** Shown when recovery gives up after at least one retry. */
export function describeRefusalStop(input: {
  readonly model: string;
  readonly delaysMs: readonly number[];
}): string {
  const retries = input.delaysMs.length;
  const backoff = input.delaysMs.every((ms) => ms <= 0)
    ? 'no wait'
    : `backoff ${input.delaysMs.map(formatRefusalDelay).join(', ')}`;
  const noun = retries === 1 ? 'retry' : 'retries';
  return `Model ${input.model} refused ${retries + 1} times (${retries} ${noun} with ${backoff}). Stopping.`;
}
