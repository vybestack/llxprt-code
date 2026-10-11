/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import { AgentClient } from '../../core/client.js';
import { createOwnedSessionRoots } from '../policyComposition.js';
import {
  createSessionClientEngineFixture,
  engineGate,
} from './helpers/session-client-engine-fixture.js';

describe('Acquisition rollback', () => {
  it('joins post-create policy binding rollback without releasing borrowed workspace resources', async () => {
    const built = await createSessionClientEngineFixture();
    const gate = engineGate();
    const entered = engineGate();
    const policy = new RuntimePolicyOwner(built.config);
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
    const pending = createOwnedSessionRoots(
      built.handle,
      built.media,
      (config, state, instructions, store, paths) => {
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
      {
        filesystemOwner: built.mcp.workspaceFilesystem,
        filesystemOwnership: 'caller',
        memoryOwner: { owner: built.mcp.workspaceMemory, ownership: 'caller' },
        definitionOwner: built.mcp.workspaceDefinitions,
        definitionOwnership: 'caller',
      },
      policy,
      undefined,
      false,
    ).then(
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
      expect(disposals).toBe(1);
      expect(built.mcp.workspaceFilesystem.paths.directories()).toContain(
        built.config.getTargetDir(),
      );
      await built.owner.publishTools();
    } finally {
      gate.release();
      await pending;
      await policy.dispose();
      await built.cleanup();
    }
  }, 30000);
});
