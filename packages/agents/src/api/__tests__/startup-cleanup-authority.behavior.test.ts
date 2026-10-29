/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import { HookControl } from '../control/hooks.js';
import { AggregateDisposeError } from '../disposeErrors.js';
import { buildPropertyAgent } from './helpers/agentHarness.js';

function causes(error: unknown): unknown[] {
  if (error instanceof AggregateError || error instanceof AggregateDisposeError)
    return error.errors.flatMap(causes);
  return [error];
}

describe('published agent startup cleanup authority', () => {
  it('reports a SessionStart failure and each resource cleanup failure once', async () => {
    const primary = new Error('SessionStart transport failed');
    const cleanup = new Error('media storage close failed');
    const start = spyOn(
      HookControl.prototype,
      'triggerSessionStart',
    ).mockRejectedValue(primary);
    const dispose = SessionMediaOwner.prototype.dispose;
    const media = spyOn(
      SessionMediaOwner.prototype,
      'dispose',
    ).mockImplementation(async function (this: SessionMediaOwner) {
      await dispose.call(this);
      throw cleanup;
    });
    try {
      const outcome = await buildPropertyAgent('plain-text.jsonl', {
        mcpEnabled: false,
        skillsSupport: false,
        recording: { enabled: false },
        telemetry: { enabled: false },
      }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(causes(outcome)).toStrictEqual([primary, cleanup]);
    } finally {
      start.mockRestore();
      media.mockRestore();
    }
  });
});
