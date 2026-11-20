/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import type { TurnProcessor } from '../TurnProcessor.js';
import type { TurnReceipt } from '@vybestack/llxprt-code-core/core/turnReceipt.js';

type SendMessageResult = Awaited<ReturnType<TurnProcessor['sendMessage']>>;
const receipt: SendMessageResult extends TurnReceipt ? true : false = true;
const payloadFree: 'content' extends keyof SendMessageResult ? false : true =
  true;

describe('TurnProcessor.sendMessage API shape', () => {
  it('returns a completion receipt without a response payload', () => {
    expect(receipt).toBe(true);
    expect(payloadFree).toBe(true);
  });
});
