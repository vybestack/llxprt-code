/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GenerateChatOptions } from '../IProvider.js';
import { RetriesExhaustedError } from '../errors.js';
import { consumeTransportAttempt } from '../transportAttemptBudget.js';
import {
  createLinkedAbortController,
  getRequestSignal,
  withRequestSignal,
  type LinkedAbortController,
} from '../utils/abortSignal.js';

export function requireTransportAttempt(options: GenerateChatOptions): void {
  if (!consumeTransportAttempt(options)) {
    const message = 'Transport attempt budget exhausted';
    throw new RetriesExhaustedError(message, 'server_error', {
      cause: new Error(message),
    });
  }
}

export function createDelegateAttempt(options: GenerateChatOptions): {
  readonly linked: LinkedAbortController;
  readonly options: GenerateChatOptions;
} {
  const linked = createLinkedAbortController(getRequestSignal(options));
  return {
    linked,
    options: withRequestSignal(options, linked.controller.signal),
  };
}
