/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #2532: the Vercel AI SDK must not multiply HTTP attempts outside
 * the shared transport-attempt budget. Retry ownership belongs to the
 * RetryOrchestrator, so resolveModelCallParams pins SDK maxRetries to 0
 * regardless of the `retries` ephemeral (which configures orchestrator
 * attempts, not SDK-internal ones).
 */

import { describe, it, expect } from 'bun:test';
import { resolveModelCallParams } from './vercelRequestParams.js';
import type {
  BaseProvider,
  NormalizedGenerateChatOptions,
} from '../BaseProvider.js';

function makeOptions(
  ephemerals: Record<string, unknown>,
): NormalizedGenerateChatOptions {
  return {
    invocation: { modelParams: {}, ephemerals },
    settings: { get: () => undefined },
  } as unknown as NormalizedGenerateChatOptions;
}

describe('resolveModelCallParams maxRetries @issue:2532', () => {
  const provider = {} as BaseProvider;

  it('pins SDK maxRetries to 0 by default', () => {
    const params = resolveModelCallParams(makeOptions({}), {}, provider);
    expect(params.maxRetries).toBe(0);
  });

  it('keeps SDK maxRetries at 0 even when the retries ephemeral is set', () => {
    const params = resolveModelCallParams(
      makeOptions({ retries: 5 }),
      {},
      provider,
    );
    expect(params.maxRetries).toBe(0);
  });
});
