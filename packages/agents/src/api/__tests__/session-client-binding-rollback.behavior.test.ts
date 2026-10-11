/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { AgentClient } from '../../core/client.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import {
  createSessionClientEngineFixture,
  engineGate,
  type SessionClientEngineFixture,
} from './helpers/session-client-engine-fixture.js';

class BindingFailureClient extends AgentClient {
  failBinding = false;
  disposals = 0;
  cleanupGate: Promise<void> = Promise.resolve();
  cleanupEntered: () => void = () => {};
  override bindIdeContext(
    ...args: Parameters<AgentClient['bindIdeContext']>
  ): void {
    if (this.failBinding) throw new Error('candidate binding failed');
    super.bindIdeContext(...args);
  }
  override async dispose(): Promise<void> {
    this.disposals += 1;
    this.cleanupEntered();
    await this.cleanupGate;
    await super.dispose();
    if (this.failBinding) throw new Error('candidate cleanup failed');
  }
}

async function bindingOwner(
  built: SessionClientEngineFixture,
  gate: ReturnType<typeof engineGate>,
  entered: ReturnType<typeof engineGate>,
): Promise<{ owner: SessionClientOwner; clients: BindingFailureClient[] }> {
  const clients: BindingFailureClient[] = [];
  const owner = await SessionClientOwner.create(
    built.config,
    assembleTaskSchemaPolicy(built.settingsService),
    built.handle.providerManager,
    (config, state, instructions, store) => {
      if (store === undefined) throw new Error('Missing media store');
      const client = new BindingFailureClient(
        config,
        state,
        instructions ?? (() => undefined),
        store,
        built.mcp.workspacePaths,
      );
      client.failBinding = clients.length > 0;
      if (client.failBinding) {
        client.cleanupGate = gate.promise;
        client.cleanupEntered = entered.release;
      }
      clients.push(client);
      return client;
    },
    built.media.store,
    built.mcp.readInstructions,
    built.mcp.workspacePaths,
    built.handle.settingsOwner,
    built.handle.contentGeneratorFactory,
    built.handle.tokenizerFactory,
  );
  return { owner, clients };
}

async function checkRollback(
  operation: (owner: SessionClientOwner) => Promise<unknown>,
): Promise<readonly number[]> {
  const built = await createSessionClientEngineFixture();
  const gate = engineGate();
  const entered = engineGate();
  const { owner, clients } = await bindingOwner(built, gate, entered);
  const previous = owner.getAgentClient();
  let settled = false;
  const pending = operation(owner).then(
    () => undefined,
    (error: unknown) => {
      settled = true;
      return error;
    },
  );
  try {
    await entered.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(owner.getAgentClient()).toBe(previous);
    gate.release();
    const failure = await pending;
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof AggregateError))
      throw new Error('Missing aggregate');
    expect(
      failure.errors.map((error: unknown) =>
        error instanceof Error ? error.message : String(error),
      ),
    ).toStrictEqual(['candidate binding failed', 'candidate cleanup failed']);
    expect(clients[1].disposals).toBe(1);
    await owner.dispose();
    return clients.map((client) => client.disposals);
  } finally {
    gate.release();
    await pending;
    await owner.dispose();
    await built.cleanup();
  }
}

describe('Session candidate binding rollback', () => {
  it('joins replacement cleanup and reports both failures without replacing the live client', async () => {
    expect(await checkRollback((owner) => owner.refreshAuth())).toStrictEqual([
      1, 1,
    ]);
  }, 30000);
  it('joins profile-candidate cleanup and reports both failures without replacing the live client', async () => {
    expect(
      await checkRollback((owner) => owner.prepareProfileClientReplacement()),
    ).toStrictEqual([1, 1]);
  }, 30000);
});
