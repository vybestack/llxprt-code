/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateChatOptions } from '../IProvider.js';
import { RetriesExhaustedError } from '../errors.js';
import { tryConsumeTransportAttempt } from '../transportAttemptBudget.js';
import {
  createLinkedAbortController,
  getRequestSignal,
  withRequestSignal,
  type LinkedAbortController,
} from '../utils/abortSignal.js';

export function requireTransportAttempt(options: GenerateChatOptions): void {
  if (!tryConsumeTransportAttempt(options)) {
    const message = 'Transport attempt budget exhausted';
    throw new RetriesExhaustedError(message, 'server_error', {
      cause: new Error(message),
    });
  }
}

export interface DelegateAttempt {
  readonly linked: LinkedAbortController;
  readonly options: GenerateChatOptions;
}

export function createDelegateAttempt(
  options: GenerateChatOptions,
): DelegateAttempt {
  const linked = createLinkedAbortController(getRequestSignal(options));
  return {
    linked,
    options: withRequestSignal(options, linked.controller.signal),
  };
}

export async function* cleanupDelegateAttempt<T>(
  attempt: DelegateAttempt,
  stream: AsyncIterable<T>,
): AsyncGenerator<T> {
  let requestFailed = false;
  let requestFailure: unknown;
  let cleanupFailure: unknown;
  try {
    yield* stream;
  } catch (error) {
    requestFailed = true;
    requestFailure = error;
  } finally {
    attempt.linked.controller.abort();
    try {
      attempt.linked.dispose();
    } catch (error) {
      cleanupFailure = error;
    }
  }
  if (requestFailed) throw requestFailure;
  if (cleanupFailure !== undefined) throw cleanupFailure;
}
