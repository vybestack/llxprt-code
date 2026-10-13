/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, spyOn } from 'bun:test';
import { AgentClient } from '../../core/client.js';
import { assembleAgentActivationBootstrap } from '../providerSwitchAssembly.js';
import {
  createSessionClientEngineFixture,
  engineGate,
} from './helpers/session-client-engine-fixture.js';

describe('Acquisition rollback', () => {
  it('joins failed bootstrap binding cleanup and retains both failures', async () => {
    const built = await createSessionClientEngineFixture();
    const gate = engineGate();
    const entered = engineGate();
    const bindingError = new Error('bootstrap binding failed');
    const cleanupError = new Error('bootstrap cleanup failed');
    const dispose = AgentClient.prototype.dispose;
    let disposals = 0;
    const binding = spyOn(
      AgentClient.prototype,
      'bindIdeContext',
    ).mockImplementation(() => {
      throw bindingError;
    });
    const cleanup = spyOn(AgentClient.prototype, 'dispose').mockImplementation(
      async function (this: AgentClient): Promise<void> {
        disposals += 1;
        entered.release();
        await gate.promise;
        await dispose.call(this);
        throw cleanupError;
      },
    );
    let settled = false;
    const pending = Promise.resolve()
      .then(() =>
        assembleAgentActivationBootstrap(
          built.config,
          built.settingsService,
          built.handle.providerManager,
          null,
          () => undefined,
          'borrowed',
          undefined,
          built.mcp,
          undefined,
          undefined,
          built.handle.settingsOwner,
        ),
      )
      .then(
        () => undefined,
        (error: unknown) => {
          settled = true;
          return error;
        },
      );
    try {
      await Promise.race([
        entered.promise,
        pending.then((failure) => {
          throw failure;
        }),
      ]);
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);
      gate.release();
      const failure = await pending;
      expect(failure).toBeInstanceOf(AggregateError);
      if (!(failure instanceof AggregateError))
        throw new Error('Missing aggregate');
      expect(failure.errors).toStrictEqual([bindingError, cleanupError]);
      expect(disposals).toBe(1);
    } finally {
      gate.release();
      await pending;
      binding.mockRestore();
      cleanup.mockRestore();
      await built.cleanup();
    }
  }, 30000);
});
