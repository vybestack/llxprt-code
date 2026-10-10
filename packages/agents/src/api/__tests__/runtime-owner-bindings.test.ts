/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createAgentRuntimeFactoryBindings } from '../runtimeFactories.js';
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Config,
  OAuthToken,
  TokenStore,
} from '@vybestack/llxprt-code-core';
import { createAgent, type Agent } from '../index.js';
import { createRuntimeActivationBindings } from '@vybestack/llxprt-code-providers/runtime.js';
import {
  ProviderFileLifecycle,
  resolveProviderFilePolicy,
} from '@vybestack/llxprt-code-providers/providerFilePolicy.js';

class MemoryStore implements TokenStore {
  private readonly tokens = new Map<string, OAuthToken>();
  async getToken(provider: string): Promise<OAuthToken | null> {
    return this.tokens.get(provider) ?? null;
  }
  async saveToken(provider: string, token: OAuthToken): Promise<void> {
    this.tokens.set(provider, token);
  }
  async removeToken(provider: string): Promise<void> {
    this.tokens.delete(provider);
  }
  async listProviders(): Promise<string[]> {
    return [...this.tokens.keys()];
  }
  async listBuckets(): Promise<string[]> {
    return [];
  }
  async getBucketStats(): Promise<null> {
    return null;
  }
  async acquireAuthLock(): Promise<boolean> {
    return true;
  }
  async releaseAuthLock(): Promise<void> {}
  async acquireRefreshLock(): Promise<boolean> {
    return true;
  }
  async releaseRefreshLock(): Promise<void> {}
}

describe('public Agent runtime owner bindings', () => {
  it('assigns independent provider-file owners to public Agents sharing a session label', async () => {
    const home = await mkdtemp(join(tmpdir(), 'runtime-owner-files-'));
    const oldHome = process.env.LLXPRT_CONFIG_HOME;
    const oldFake = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_CONFIG_HOME = home;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
    );
    const agents: Agent[] = [];
    const owners: object[] = [];
    const configs: Config[] = [];
    try {
      for (const model of ['first-model', 'second-model']) {
        const base = createRuntimeActivationBindings();
        const agent = await createAgent({
          provider: 'fake',
          model,
          sessionId: 'shared-session-label',
          workingDir: process.cwd(),
          tokenStore: new MemoryStore(),
          runtimeActivationBindings: {
            ...base,
            setRuntimeContext(settingsService, config, options) {
              configs.push(config);
              const lifecycle = options.providerFileLifecycle;
              if (lifecycle !== undefined) owners.push(lifecycle);
              return base.setRuntimeContext(settingsService, config, options);
            },
          },
        });
        agents.push(agent);
      }
      expect(owners).toHaveLength(2);
      expect(owners[0]).not.toBe(owners[1]);
      expect(configs[0]).not.toBe(configs[1]);
      await Promise.all(
        agents.map((agent, index) =>
          agent.setProvider('fake', `switched-model-${index}`),
        ),
      );
      expect(agents.map((agent) => agent.getModel())).toStrictEqual([
        'switched-model-0',
        'switched-model-1',
      ]);
      const replies = await Promise.all(
        agents.map((agent) => agent.generate('reply with a short sentence')),
      );
      expect(replies).toStrictEqual(['turn one reply', 'turn one reply']);
      await agents[0].dispose();
      await expect(agents[0].generate('closed')).rejects.toThrow(
        'Agent is closed',
      );
      expect(await agents[1].generate('survivor')).toBe('turn two reply');
    } finally {
      for (const agent of agents) await agent.dispose();
      if (oldHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = oldHome;
      if (oldFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = oldFake;
      await rm(home, { recursive: true, force: true });
    }
  });

  it('keeps same-label profile, credential, factory and cleanup owners separate through interleaved activation', async () => {
    const home = await mkdtemp(join(tmpdir(), 'runtime-owner-bindings-'));
    const oldHome = process.env.LLXPRT_CONFIG_HOME;
    const oldFake = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_CONFIG_HOME = home;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
    );
    const agents: Agent[] = [];
    const stores = [new MemoryStore(), new MemoryStore()];
    const events: string[][] = [[], []];
    const factories = [
      createAgentRuntimeFactoryBindings(),
      createAgentRuntimeFactoryBindings(),
    ];
    const factoryEvents: string[][] = [[], []];
    const makeBindings = (index: number) => {
      const base = createRuntimeActivationBindings();
      return {
        ...base,
        async registerInfrastructure(
          ...args: Parameters<typeof base.registerInfrastructure>
        ) {
          expect(args[1].getTokenStore()).toBe(stores[index]);
          events[index].push('activated');
          await base.registerInfrastructure(...args);
          const owner = args[2].config;
          if (!owner) throw new Error('Activation did not supply an owner');
          expect('providerManager' in owner).toBe(false);
        },
        async disposeRuntime(
          ...args: Parameters<NonNullable<typeof base.disposeRuntime>>
        ) {
          events[index].push('disposed');
          await base.disposeRuntime?.(...args);
        },
      };
    };
    try {
      const [first, second] = await Promise.all(
        [0, 1].map(async (index) => {
          const agent = await createAgent({
            provider: 'fake',
            model: `owner-model-${index}`,
            workingDir: process.cwd(),
            sessionId: 'same-owner-label',
            tokenStore: stores[index],
            runtimeFactoryBindings: {
              ...factories[index],
              agentClientFactory: (...args) => {
                factoryEvents[index].push('constructed');
                return factories[index].agentClientFactory(...args);
              },
            },
            runtimeActivationBindings: makeBindings(index),
          });
          agents.push(agent);
          return agent;
        }),
      );
      first.setModelParam('temperature', 0.2);
      second.setModelParam('temperature', 0.8);
      const firstProfile = first.captureProfile();
      const secondProfile = second.captureProfile();
      expect(firstProfile.modelParams).toMatchObject({ temperature: 0.2 });
      expect(secondProfile.modelParams).toMatchObject({ temperature: 0.8 });
      expect(first.getRuntimeDiagnosticsSnapshot().modelName).toBe(
        'owner-model-0',
      );
      expect(second.getRuntimeDiagnosticsSnapshot().modelName).toBe(
        'owner-model-1',
      );
      expect(factoryEvents.every((ownerEvents) => ownerEvents.length > 0)).toBe(
        true,
      );
      const credential = (value: string): OAuthToken => ({
        access_token: value,
        refresh_token: `refresh-${value}`,
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer',
        scope: '',
      });
      await stores[0].saveToken('codex', credential('first'));
      await stores[1].saveToken('codex', credential('second'));
      expect((await stores[0].getToken('codex'))?.access_token).toBe('first');
      expect((await stores[1].getToken('codex'))?.access_token).toBe('second');
      expect(events).toStrictEqual([['activated'], ['activated']]);
      const failedOwnerEvents: string[] = [];
      const failedFilesDeleted: string[] = [];
      const failedBindings = createRuntimeActivationBindings();
      await expect(
        createAgent({
          provider: 'fake',
          model: 'failed-owner',
          workingDir: process.cwd(),
          sessionId: 'same-owner-label',
          tokenStore: new MemoryStore(),
          runtimeFactoryBindings: createAgentRuntimeFactoryBindings(),
          runtimeActivationBindings: {
            ...failedBindings,
            async registerInfrastructure(...args) {
              await failedBindings.registerInfrastructure(...args);
              const lifecycle = args[2].providerFileLifecycle;
              if (!(lifecycle instanceof ProviderFileLifecycle)) {
                throw new Error('Failed owner missing file lifecycle');
              }
              const retained = await lifecycle.retain({
                cacheKey: 'failed-owner-file',
                fileId: 'failed-owner-file',
                bytes: 5,
                identity: {
                  provider: 'kimi',
                  baseURL: 'https://api.kimi.test/v1',
                  credentialHash: 'failed-owner-credential',
                },
                policy: resolveProviderFilePolicy({
                  configuredMode: 'session',
                  configuredRetentionMs: 60_000,
                  configuredDeletion: 'delete',
                  providerFileReferences: true,
                  zeroDataRetention: 'incompatible-while-retained',
                  zeroDataRetentionRequired: false,
                }),
                scopeId: 'same-owner-label',
                deleteRemote: async (fileId) => {
                  failedFilesDeleted.push(fileId);
                },
              });
              await retained.lease.release();
              throw new Error('activation rejected');
            },
            async disposeRuntime(...args) {
              failedOwnerEvents.push('disposed');
              await failedBindings.disposeRuntime?.(...args);
            },
          },
        }),
      ).rejects.toThrow('activation rejected');
      expect(failedOwnerEvents).toStrictEqual(['disposed']);
      expect(failedFilesDeleted).toStrictEqual(['failed-owner-file']);
      expect(first.captureProfile().modelParams).toMatchObject({
        temperature: 0.2,
      });
      expect(second.captureProfile().modelParams).toMatchObject({
        temperature: 0.8,
      });
      await second.setProvider('fake', 'surviving-model');
      expect(second.getRuntimeDiagnosticsSnapshot().modelName).toBe(
        'surviving-model',
      );
      await second.dispose();

      expect(events).toStrictEqual([['activated'], ['activated', 'disposed']]);
      await first.dispose();
      expect(events).toStrictEqual([
        ['activated', 'disposed'],
        ['activated', 'disposed'],
      ]);
    } finally {
      for (const agent of agents) await agent.dispose();
      if (oldHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = oldHome;
      if (oldFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = oldFake;
      await rm(home, { recursive: true, force: true });
    }
  });
  it('disposes only the exact file owner when public Agents share a runtime label', async () => {
    const home = await mkdtemp(join(tmpdir(), 'runtime-owner-collision-'));
    const oldHome = process.env.LLXPRT_CONFIG_HOME;
    const oldFake = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_CONFIG_HOME = home;
    process.env.LLXPRT_FAKE_RESPONSES = fileURLToPath(
      new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
    );
    const agents: Agent[] = [];
    const owners: ProviderFileLifecycle[] = [];
    const deleted: string[] = [];
    try {
      for (const fileId of ['first-file', 'second-file']) {
        const base = createRuntimeActivationBindings();
        const agent = await createAgent({
          provider: 'fake',
          model: 'first-model',
          sessionId: 'shared-disposal-label',
          workingDir: process.cwd(),
          tokenStore: new MemoryStore(),
          runtimeActivationBindings: {
            ...base,
            setRuntimeContext(settings, config, options) {
              const owner = options.providerFileLifecycle;
              if (owner instanceof ProviderFileLifecycle) owners.push(owner);
              return base.setRuntimeContext(settings, config, options);
            },
          },
        });
        agents.push(agent);
        const owner = owners[owners.length - 1];
        const retained = await owner.retain({
          cacheKey: fileId,
          fileId,
          bytes: 5,
          identity: {
            provider: 'kimi',
            baseURL: 'https://api.kimi.test/v1',
            credentialHash: 'test-credential',
          },
          policy: resolveProviderFilePolicy({
            configuredMode: 'session',
            configuredRetentionMs: 60_000,
            configuredDeletion: 'delete',
            providerFileReferences: true,
            zeroDataRetention: 'incompatible-while-retained',
            zeroDataRetentionRequired: false,
          }),
          scopeId: 'shared-disposal-label',
          deleteRemote: async (deletedId: string) => {
            deleted.push(deletedId);
          },
        });
        await retained.lease.release();
      }
      await agents[0].dispose();
      expect(deleted).toStrictEqual(['first-file']);
      expect(
        owners.map((owner) => owner.snapshot().retainedFiles),
      ).toStrictEqual([0, 1]);
      await agents[1].setProvider('fake', 'switched-model');
      expect(agents[1].getModel()).toBe('switched-model');
      await expect(agents[0].generate('disposed')).rejects.toThrow(
        'Agent is closed',
      );
      await agents[1].dispose();
      expect(deleted).toStrictEqual(['first-file', 'second-file']);
    } finally {
      for (const agent of agents) await agent.dispose();
      if (oldHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = oldHome;
      if (oldFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = oldFake;
      await rm(home, { recursive: true, force: true });
    }
  });
  it('switches and saves distinct provider profiles for same-label Agents after a sibling closes', async () => {
    const home = await mkdtemp(join(tmpdir(), 'runtime-provider-profiles-'));
    const oldHome = process.env.LLXPRT_CONFIG_HOME;
    const oldFake = process.env.LLXPRT_FAKE_RESPONSES;
    process.env.LLXPRT_CONFIG_HOME = home;
    delete process.env.LLXPRT_FAKE_RESPONSES;
    const agents: Agent[] = [];
    try {
      const [kimi, openai] = await Promise.all(
        [
          { provider: 'kimi', model: 'kimi-k3', key: 'kimi-secret' },
          { provider: 'openai', model: 'gpt-4o-mini', key: 'openai-secret' },
        ].map(async ({ provider, model, key }) => {
          const agent = await createAgent({
            provider,
            model,
            sessionId: 'same-provider-label',
            workingDir: process.cwd(),
            auth: { apiKey: key, baseUrl: 'http://127.0.0.1:1/v1' },
            tokenStore: new MemoryStore(),
          });
          agents.push(agent);
          return agent;
        }),
      );
      expect(kimi.getProvider()).toBe('kimi');
      expect(openai.getProvider()).toBe('openai');
      expect(kimi.captureProfile().provider).toBe('kimi');
      expect(openai.captureProfile().provider).toBe('openai');
      await Promise.all([
        kimi.setProvider('kimi', 'kimi-profile-model'),
        openai.setProvider('openai', 'openai-profile-model'),
      ]);
      await Promise.all([
        kimi.saveProfileSnapshot('owner-kimi'),
        openai.saveProfileSnapshot('owner-openai'),
      ]);
      expect(kimi.captureProfile().model).toBe('kimi-profile-model');
      expect(openai.captureProfile().model).toBe('openai-profile-model');
      await kimi.dispose();
      await openai.setProvider('openai', 'openai-surviving-model');
      expect(openai.getRuntimeDiagnosticsSnapshot()).toMatchObject({
        providerName: 'openai',
        modelName: 'openai-surviving-model',
      });
    } finally {
      for (const agent of agents) await agent.dispose();
      if (oldHome === undefined) delete process.env.LLXPRT_CONFIG_HOME;
      else process.env.LLXPRT_CONFIG_HOME = oldHome;
      if (oldFake === undefined) delete process.env.LLXPRT_FAKE_RESPONSES;
      else process.env.LLXPRT_FAKE_RESPONSES = oldFake;
      await rm(home, { recursive: true, force: true });
    }
  });
});
