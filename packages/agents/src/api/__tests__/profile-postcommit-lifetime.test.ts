/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, describe, expect, it, spyOn, vi } from 'bun:test';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { fromConfig, type Agent } from '@vybestack/llxprt-code-agents';
import {
  OAuthManager,
  AnthropicOAuthProvider,
} from '@vybestack/llxprt-code-providers/auth.js';
import { ProfileManager, type Profile } from '@vybestack/llxprt-code-settings';
import type { OAuthToken } from '@vybestack/llxprt-code-auth';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import {
  MemoryTokenStore,
  makeExpiredToken,
  makeToken,
} from './helpers/provider-auth-fixtures.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';

const fixtureDirectories: string[] = [];

function gate(): { promise: Promise<void>; release: () => void } {
  let release = (): void => {
    throw new Error('Uninitialized gate');
  };
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function boundary(promise: Promise<void>, name: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Did not reach ${name}`)),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function observe<T>(promise: Promise<T>): {
  settled: () => boolean;
  result: Promise<{ value: T } | { error: unknown }>;
} {
  let settled = false;
  const result = promise.then(
    (value) => {
      settled = true;
      return { value };
    },
    (error: unknown) => {
      settled = true;
      return { error };
    },
  );
  return { settled: () => settled, result };
}

async function successfulTurn(agent: Agent): Promise<void> {
  const events = [];
  for await (const event of agent.stream('continue independently', {
    mcpDiscovery: 'skip',
  }))
    events.push(event);
  expect(events.filter((event) => event.type === 'error')).toStrictEqual([]);
  expect(events.filter((event) => event.type === 'done')).toStrictEqual([
    { type: 'done', reason: 'stop' },
  ]);
}

function restoreEnvironment(
  environment: ReadonlyMap<string, string | undefined>,
): void {
  for (const [key, value] of environment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function exercise(
  dispose: boolean | 'http' | 'renewal-replace' | 'renewal-dispose',
): Promise<void> {
  const renewal =
    dispose === 'renewal-replace' || dispose === 'renewal-dispose';
  const root = join(tmpdir(), 'llxprt-profile-postcommit-repros');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, 'fixture-'));
  fixtureDirectories.push(directory);
  let fakeTimers = false;
  const keys = [
    'LLXPRT_CONFIG_HOME',
    'LLXPRT_DATA_HOME',
    'LLXPRT_CACHE_HOME',
    'LLXPRT_LOG_HOME',
    'LLXPRT_FAKE_RESPONSES',
  ];
  const environment = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys.filter((key) => key !== 'LLXPRT_FAKE_RESPONSES'))
    process.env[key] = directory;
  const preparationEntered = gate();
  const preparationRelease = gate();
  const httpEntered = gate();
  const httpRelease = gate();
  const saveEntered = gate();
  const saveRelease = gate();
  const lockReleased = gate();
  let preparation = true;
  let refreshStarted = false;
  let refreshRequests = 0;
  let otherRefreshRequests = 0;
  let persisted = false;
  let committedAtRefresh = false;
  let refreshSignal: AbortSignal | null | undefined;
  let readModel = (): string => '';
  class PausedStore extends MemoryTokenStore {
    override async getToken(
      provider: string,
      bucket?: string,
    ): Promise<OAuthToken | null> {
      if (preparation) {
        preparationEntered.release();
        await preparationRelease.promise;
      }
      return super.getToken(provider, bucket);
    }
    override async saveToken(
      provider: string,
      token: OAuthToken,
      bucket?: string,
    ): Promise<void> {
      if (token.access_token === 'rotated-access') {
        saveEntered.release();
        await saveRelease.promise;
        await super.saveToken(provider, token, bucket);
        persisted = true;
        return;
      }
      await super.saveToken(provider, token, bucket);
    }
    override async releaseRefreshLock(): Promise<void> {
      lockReleased.release();
    }
  }
  const store = new PausedStore();
  const otherStore = new MemoryTokenStore();
  let otherRenewals: OAuthManager | undefined;
  const configs: Array<Awaited<ReturnType<typeof buildCliStyleConfig>>> = [];
  const agents: Agent[] = [];
  const pending: Array<Promise<unknown>> = [];
  const transport = spyOn(globalThis, 'fetch').mockImplementation(
    async (input, init): Promise<Response> => {
      if (
        String(input) !== 'https://console.anthropic.com/v1/oauth/token' ||
        !(init?.body instanceof URLSearchParams) ||
        init.body.get('grant_type') !== 'refresh_token'
      ) {
        throw new Error(`Unexpected network request: ${String(input)}`);
      }
      if (
        init.body.get('refresh_token')?.startsWith('refresh-owner-b') === true
      ) {
        otherRefreshRequests++;
        return Response.json({
          access_token: `owner-b-rotation-${otherRefreshRequests}`,
          refresh_token: 'refresh-owner-b-primary',
          expires_in: 600,
        });
      }
      refreshStarted = true;
      refreshRequests++;
      committedAtRefresh = readModel() === 'committed-oauth-model';
      refreshSignal = init.signal;
      httpEntered.release();
      if (dispose === 'http' && refreshSignal) {
        const signal = refreshSignal;
        await new Promise<void>((resolve, reject) => {
          const onAbort = (): void => reject(signal.reason);
          signal.addEventListener('abort', onAbort, { once: true });
          void httpRelease.promise.then(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          });
        });
      } else {
        await httpRelease.promise;
      }
      return Response.json({
        access_token: 'rotated-access',
        refresh_token: 'rotated-refresh',
        expires_in: renewal ? 3600 : 120,
      });
    },
  );
  try {
    const label = `postcommit-${randomUUID()}`;
    for (let index = 0; index < 2; index++) {
      configs.push(
        await buildCliStyleConfig('multi-turn-text.jsonl', {
          sessionId: label,
          workingDir: directory,
          telemetry: { enabled: false },
          recording: { enabled: false },
        }),
      );
    }
    const [built, other] = configs;
    const manager = built.providerManager;

    const provider = new FakeProvider(
      fileURLToPath(
        new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
      ),
      directory,
    );
    provider.name = 'claudecode';
    provider.baseProviderConfig = { baseURL: 'https://api.anthropic.com' };
    manager.registerProvider(provider);
    const profile: Profile = {
      version: 1,
      provider: 'claudecode',
      model: 'committed-oauth-model',
      modelParams: {},
      ephemeralSettings: {},
      auth: { type: 'oauth', buckets: ['primary', 'secondary'] },
    };
    const profiles = new ProfileManager();
    await profiles.saveProfile('postcommit', profile);
    if (renewal) {
      vi.useFakeTimers();
      fakeTimers = true;
    }
    await store.saveToken(
      'claudecode',
      renewal
        ? makeToken('old-primary', { expiresInSec: 600 })
        : makeExpiredToken('expired-primary'),
      'primary',
    );
    await store.saveToken(
      'claudecode',
      makeExpiredToken('expired-secondary'),
      'secondary',
    );
    const oauth = new OAuthManager(store, undefined, {
      config: built.config,
      messageBus: built.messageBus,
    });
    oauth.registerProvider(new AnthropicOAuthProvider(store));
    await oauth.toggleOAuthEnabled('claudecode');
    const agent = await fromConfig({
      oauthManager: oauth,
      providerFileLifecycle: built.runtime.providerFileLifecycle,
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      config: built.config,
      mcpRuntime: built.mcpRuntime,
      messageBus: built.messageBus,
      sessionId: label,
    });
    agents.push(agent);
    const ownerB = await fromConfig({
      settingsOwner: other.settingsOwner,
      settingsService: other.settingsService,
      providerManager: other.providerManager,
      config: other.config,
      mcpRuntime: other.mcpRuntime,
      messageBus: other.messageBus,
      sessionId: label,
    });

    agents.push(ownerB);
    if (renewal) {
      otherRenewals = new OAuthManager(otherStore, undefined, {
        config: other.config,
        messageBus: other.messageBus,
      });
      otherRenewals.registerProvider(new AnthropicOAuthProvider(otherStore));
      await otherRenewals.toggleOAuthEnabled('claudecode');
      await otherStore.saveToken(
        'claudecode',
        makeToken('owner-b-primary', { expiresInSec: 600 }),
        'primary',
      );
      await otherRenewals.configureProactiveRenewalsForProfile({
        provider: 'claudecode',
        auth: { type: 'oauth', buckets: ['primary'] },
      });
    }
    readModel = () => agent.getModel();
    const application = observe(
      agent.profiles.applySnapshot(profile, { profileName: 'postcommit' }),
    );
    pending.push(application.result);
    await boundary(preparationEntered.promise, 'preparation token read');
    expect(refreshStarted).toBe(false);
    expect(application.settled()).toBe(false);
    preparation = false;
    preparationRelease.release();
    if (renewal) {
      expect(await application.result).toHaveProperty(
        'value.modelName',
        'committed-oauth-model',
      );
      expect(refreshStarted).toBe(false);
      await advanceTimersByTimeAsync(305000);
    }
    await boundary(httpEntered.promise, 'postcommit native OAuth refresh');
    expect(committedAtRefresh).toBe(true);
    const settledDuringHttp = application.settled();
    if (dispose === 'http') {
      const first = agent.dispose();
      const disposal = observe(first);
      pending.push(disposal.result);
      expect(refreshSignal?.aborted).toBe(true);
      expect(agent.dispose()).toBe(first);
      await successfulTurn(ownerB);
      expect(await application.result).toHaveProperty('error.committed', true);
      expect(await disposal.result).toStrictEqual({ value: undefined });
      expect(persisted).toBe(false);
      expect(built.settingsOwner.readSelectedModel()).toBe(
        'committed-oauth-model',
      );
      return;
    }
    httpRelease.release();
    await boundary(saveEntered.promise, 'rotated token persistence');
    expect(persisted).toBe(false);
    if (renewal) {
      const draining = observe<unknown>(
        dispose === 'renewal-dispose'
          ? agent.dispose()
          : agent.profiles.applySnapshot({
              ...profile,
              model: 'replacement-without-renewals',
              auth: undefined,
            }),
      );
      pending.push(draining.result);
      await successfulTurn(ownerB);
      expect(draining.settled()).toBe(false);
      saveRelease.release();
      expect(await draining.result).not.toHaveProperty('error');
      expect(persisted).toBe(true);
      expect(
        (await store.getToken('claudecode', 'primary'))?.refresh_token,
      ).toBe('rotated-refresh');
      const ownerBToken = (await otherStore.getToken('claudecode', 'primary'))
        ?.access_token;
      await advanceTimersByTimeAsync(4000000);
      expect(
        (await otherStore.getToken('claudecode', 'primary'))?.access_token,
      ).not.toBe(ownerBToken);
      expect(refreshRequests).toBe(1);
      await otherRenewals?.configureProactiveRenewalsForProfile({});
      vi.useRealTimers();
      fakeTimers = false;
      if (dispose === 'renewal-replace') await successfulTurn(agent);
      return;
    }
    if (dispose) {
      const first = agent.dispose();
      const firstObservation = observe(first);
      pending.push(firstObservation.result);
      const second = agent.dispose();
      const secondObservation = observe(second);
      pending.push(secondObservation.result);
      await successfulTurn(ownerB);
      expect({
        firstSettled: firstObservation.settled(),
        secondSettled: secondObservation.settled(),
        sharedPromise: first === second,
      }).toStrictEqual({
        firstSettled: false,
        secondSettled: false,
        sharedPromise: true,
      });
      saveRelease.release();
      await boundary(lockReleased.promise, 'refresh lock release');
      expect(await firstObservation.result).toStrictEqual({
        value: undefined,
      });
      expect(await secondObservation.result).toStrictEqual({
        value: undefined,
      });
      expect(await application.result).toHaveProperty('error.committed', true);
      expect(built.settingsOwner.readSelectedModel()).toBe(
        'committed-oauth-model',
      );
      expect(
        (await oauth.getOAuthToken('claudecode', 'primary'))?.refresh_token,
      ).toBe('rotated-refresh');
      await built.agentClient.startChat(await built.agentClient.getHistory());
      const successor = await fromConfig({
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        agentClient: built.agentClient,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        messageBus: built.messageBus,
        sessionId: `${label}-successor`,
      });
      try {
        agents.push(successor);
        await successfulTurn(successor);
      } finally {
        await successor.dispose();
      }
    } else {
      await successfulTurn(ownerB);
      expect({
        settledDuringHttp,
        settledDuringSave: application.settled(),
        applying: agent.profiles.isApplying(),
      }).toStrictEqual({
        settledDuringHttp: false,
        settledDuringSave: false,
        applying: true,
      });
      saveRelease.release();
      await boundary(lockReleased.promise, 'refresh lock release');
      expect(await application.result).toHaveProperty(
        'value.modelName',
        'committed-oauth-model',
      );
      expect(
        (await store.getToken('claudecode', 'primary'))?.refresh_token,
      ).toBe('rotated-refresh');
      await successfulTurn(agent);
    }
  } finally {
    preparation = false;
    preparationRelease.release();
    httpRelease.release();
    saveRelease.release();
    try {
      await Promise.all(pending);
      await Promise.all(agents.map((agent) => agent.dispose()));
      await otherRenewals?.configureProactiveRenewalsForProfile({});
    } finally {
      if (fakeTimers) {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
      transport.mockRestore();
      for (const built of [...configs].reverse()) {
        await built.config.dispose();
        await built.cleanup();
      }
      restoreEnvironment(environment);
    }
  }
}

describe('public profile postcommit OAuth lifetime (#2616)', () => {
  afterAll(async () => {
    await Promise.all(
      fixtureDirectories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    );
  });
  it('joins native refresh and token persistence before completing apply', async () => {
    await expect(exercise(false)).resolves.toBeUndefined();
  }, 30000);
  it('shares pending disposal until committed token persistence finishes', async () => {
    await expect(exercise(true)).resolves.toBeUndefined();
  }, 30000);
  it('aborts the native HTTP refresh immediately on public disposal', async () => {
    await expect(exercise('http')).resolves.toBeUndefined();
  }, 30000);
  it('joins a fired renewal during replacement and prevents old rescheduling', async () => {
    await expect(exercise('renewal-replace')).resolves.toBeUndefined();
  }, 30000);
  it('joins a fired installed renewal on disposal after apply has completed', async () => {
    await expect(exercise('renewal-dispose')).resolves.toBeUndefined();
  }, 30000);
});
