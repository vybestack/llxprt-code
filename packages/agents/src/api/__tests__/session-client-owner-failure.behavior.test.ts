/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { MessageBusType } from '@vybestack/llxprt-code-core/confirmation-bus/types.js';
import { Storage } from '@vybestack/llxprt-code-storage';
import { AgentClient } from '../../core/client.js';
import { SessionClientOwner } from '../../session/session-client-owner.js';
import {
  createSessionClientEngineFixture,
  type SessionClientEngineFixture,
} from './helpers/session-client-engine-fixture.js';

class CountingClient extends AgentClient {
  disposals = 0;
  failInitialize = false;
  override async initialize(
    ...args: Parameters<AgentClient['initialize']>
  ): Promise<void> {
    if (this.failInitialize) throw new Error('refresh boom');
    await super.initialize(...args);
  }
  override async dispose(): Promise<void> {
    this.disposals += 1;
    await super.dispose();
  }
}

interface ReplacementOwner {
  readonly owner: SessionClientOwner;
  readonly clients: CountingClient[];
  readonly scopeCleanups: string[];
}

async function createReplacementOwner(
  built: SessionClientEngineFixture,
  failFromClient: number,
): Promise<ReplacementOwner> {
  const clients: CountingClient[] = [];
  const scopeCleanups: string[] = [];
  const owner = await SessionClientOwner.create(
    built.config,
    assembleTaskSchemaPolicy(built.settingsService),
    built.handle.providerManager,
    (config, state, instructions, store) => {
      if (store === undefined) throw new Error('Missing factory store');
      const client = new CountingClient(
        config,
        state,
        instructions ?? (() => undefined),
        store,
        built.mcp.workspacePaths,
      );
      client.failInitialize = clients.length >= failFromClient;
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
  owner.bindProviderFiles(
    built.handle.providerFileLifecycle,
    (provider) => built.handle.oauthManager.composeRetryOperations(provider),
    async (scope) => {
      scopeCleanups.push(scope);
    },
  );
  return { owner, clients, scopeCleanups };
}

describe('Session client replacement failure', () => {
  it('disposes a replacement whose refresh fails once and keeps the previous client usable', async () => {
    const built = await createSessionClientEngineFixture();
    const { owner, clients } = await createReplacementOwner(built, 2);
    try {
      await owner.refreshAuth();
      const previous = owner.getAgentClient();
      expect(clients).toHaveLength(2);

      await expect(owner.refreshAuth()).rejects.toThrow('refresh boom');

      const abandoned = clients[2];
      expect(clients).toHaveLength(3);
      expect(abandoned.disposals).toBe(1);
      expect(owner.getAgentClient()).toBe(previous);
      expect(clients[1].disposals).toBe(0);
      await expect(owner.refreshAuth()).rejects.toThrow('refresh boom');
      expect(clients[3].disposals).toBe(1);
      expect(abandoned.disposals).toBe(1);
    } finally {
      await owner.dispose();
      await built.cleanup();
    }
  }, 30000);

  it('disposes a profile candidate whose preparation fails once and keeps the previous client usable', async () => {
    const built = await createSessionClientEngineFixture();
    const { owner, clients, scopeCleanups } = await createReplacementOwner(
      built,
      2,
    );
    try {
      await owner.refreshAuth();
      const previous = owner.getAgentClient();

      await expect(owner.prepareProfileClientReplacement()).rejects.toThrow(
        'refresh boom',
      );

      expect(clients[2].disposals).toBe(1);
      expect(owner.getAgentClient()).toBe(previous);
      expect(clients[1].disposals).toBe(0);
      expect(scopeCleanups).toStrictEqual([]);
      await owner.dispose();
      expect(clients[1].disposals).toBe(1);
      expect(clients[2].disposals).toBe(1);
      expect(scopeCleanups).toHaveLength(1);
    } finally {
      await built.cleanup();
    }
  }, 30000);
});

describe('Session client owner policy persistence at disposal', () => {
  it('joins accepted policy writes and reports their failure', async () => {
    const built = await createSessionClientEngineFixture();
    const policiesDir = Storage.getUserPoliciesDir();
    await mkdir(dirname(policiesDir), { recursive: true });
    await rm(policiesDir, { recursive: true, force: true });
    // A file where the policies directory belongs makes persistence fail.
    await writeFile(policiesDir, 'not a directory');
    try {
      built.owner.messageBus.publish({
        type: MessageBusType.UPDATE_POLICY,
        toolName: 'write_file',
        persist: true,
      });

      const reported = await built.owner.dispose().then(
        () => undefined,
        (error: unknown) => error,
      );

      expect(reported).toBeInstanceOf(AggregateError);
      if (!(reported instanceof AggregateError))
        throw new Error('Disposal did not reject');
      const persistence = reported.errors.find(
        (error: unknown): error is AggregateError =>
          error instanceof AggregateError &&
          error.message === 'Session policy persistence failed',
      );
      expect(persistence?.errors).toHaveLength(1);
    } finally {
      await rm(policiesDir, { force: true });
      await built.cleanup().catch(() => undefined);
    }
  }, 30000);
});
