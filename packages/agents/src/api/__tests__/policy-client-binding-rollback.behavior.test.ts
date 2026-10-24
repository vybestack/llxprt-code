/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { AgentClient } from '../../core/client.js';
import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { buildAgent } from './helpers/agentHarness.js';
import { gate as createGate } from './helpers/async-child-disposal-join-fixture.js';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

describe('createAgent session client binding rollback', () => {
  const credentials = useOwnedCredentials();

  it('joins the created client cleanup before rejecting a post-create binding failure and keeps both errors', async () => {
    const gate = createGate();
    const entered = createGate();
    let disposals = 0;
    let settled = false;
    class PolicyFailureClient extends AgentClient {
      bindings = 0;
      override bindIdeContext(
        ...args: Parameters<AgentClient['bindIdeContext']>
      ): void {
        this.bindings += 1;
        if (this.bindings > 1) throw new Error('policy binding failed');
        super.bindIdeContext(...args);
      }
      override async dispose(): Promise<void> {
        disposals += 1;
        entered.release();
        await gate.promise;
        await super.dispose();
        throw new Error('policy client cleanup failed');
      }
    }
    const pending = buildAgent('plain-text.jsonl', {
      credentialAuthority: credentials().authority,
      sessionId: 'policy-client-binding-rollback',
      runtimeFactoryBindings: {
        ...createAgentRuntimeFactoryBindings(),
        agentClientFactory: (config, state, instructions, store, paths) => {
          if (store === undefined || paths === undefined)
            throw new Error('Missing client inputs');
          return new PolicyFailureClient(
            config,
            state,
            instructions ?? (() => undefined),
            store,
            paths,
          );
        },
      },
    }).then(
      () => undefined,
      (error: unknown) => {
        settled = true;
        return error;
      },
    );
    try {
      const progress = await Promise.race([
        entered.promise.then(() => 'cleanup'),
        pending.then(() => 'rejected'),
      ]);
      expect(progress).toBe('cleanup');
      expect(settled).toBe(false);
      gate.release();
      const failure = await pending;
      expect(failure).toBeInstanceOf(AggregateError);
      if (!(failure instanceof AggregateError)) throw failure;
      const [binding, cleanup] = failure.errors;
      if (!(binding instanceof Error))
        throw new Error('Expected binding error');
      expect(binding.message).toBe('policy binding failed');
      if (!(cleanup instanceof AggregateError))
        throw new Error('Expected client cleanup aggregate');
      expect(cleanup.errors.map((error: Error) => error.message)).toStrictEqual(
        ['policy client cleanup failed'],
      );
      expect(disposals).toBe(1);
    } finally {
      gate.release();
      await pending;
    }
  }, 30000);
});
