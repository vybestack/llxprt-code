/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { RuntimeGenerateChatOptions } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import {
  bindPreparedTransportSignal,
  type PreparedPromptEnvelopeSend,
} from './promptEnvelopeSendSeam.js';

function buildPrepared(
  callerSignal: AbortSignal,
  transportToken: object,
): PreparedPromptEnvelopeSend {
  return {
    estimate: null,
    options: {
      contents: [],
      invocation: { signal: callerSignal },
      metadata: { abortSignal: callerSignal },
      promptEnvelopeTransportToken: transportToken,
    } as RuntimeGenerateChatOptions,
  };
}

describe('bindPreparedTransportSignal', () => {
  it('immutably binds the timeout signal while preserving prepared transport identity', () => {
    const callerSignal = new AbortController().signal;
    const timeoutSignal = new AbortController().signal;
    const transportToken = Object.freeze({});
    const prepared = buildPrepared(callerSignal, transportToken);

    const bound = bindPreparedTransportSignal(prepared, timeoutSignal);

    expect(bound).not.toBe(prepared);
    expect(bound.options).not.toBe(prepared.options);
    expect(bound.options.invocation?.signal).toBe(timeoutSignal);
    expect(bound.options.metadata?.['abortSignal']).toBe(timeoutSignal);
    expect(bound.options.promptEnvelopeTransportToken).toBe(transportToken);
    expect(prepared.options.invocation?.signal).toBe(callerSignal);
    expect(prepared.options.metadata?.['abortSignal']).toBe(callerSignal);
  });
});
