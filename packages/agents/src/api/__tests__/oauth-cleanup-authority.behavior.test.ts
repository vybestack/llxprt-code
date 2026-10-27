/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { AggregateDisposeError } from '../disposeErrors.js';
import { buildPropertyAgent } from './helpers/agentHarness.js';

describe('OAuth cleanup authority', () => {
  it('reports an OAuth release failure once through the provider owner', async () => {
    const built = await buildPropertyAgent('plain-text.jsonl', {
      mcpEnabled: false,
      skillsSupport: false,
      recording: { enabled: false },
      telemetry: { enabled: false },
    });
    const cleanup = new Error('OAuth external resource close failed');
    const dispose = OAuthManager.prototype.dispose;
    const oauth = spyOn(OAuthManager.prototype, 'dispose').mockImplementation(
      async function (this: OAuthManager) {
        await dispose.call(this);
        throw cleanup;
      },
    );
    try {
      const outcome = await built.agent.dispose().then(
        () => undefined,
        (error: unknown) => error,
      );
      if (!(outcome instanceof AggregateDisposeError))
        throw new Error('Missing aggregate cleanup failure');
      expect(outcome.errors).toStrictEqual([cleanup]);
    } finally {
      oauth.mockRestore();
      await built.cleanup();
    }
  });
});
