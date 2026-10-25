import {
  gate,
  boundary,
  observe,
  successfulTurn,
  restoreEnvironment,
} from './helpers/profile-postcommit-lifetime-fixture.js';
import { ProfileManager, type Profile } from '@vybestack/llxprt-code-settings';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { useOwnedCredentials } from './helpers/owned-credential-fixture.js';

import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'bun:test';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { createAgent } from '../createAgent.js';
import { AgentConfig } from '../config-types.js';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import { type Agent } from '@vybestack/llxprt-code-agents';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { OAuthToken } from '@vybestack/llxprt-code-auth';
import {
  MemoryTokenStore,
  makeExpiredToken,
  makeToken,
} from './helpers/provider-auth-fixtures.js';
import { createRecordingProvider } from './helpers/recording-provider.js';
import { enableOAuthProviders } from './helpers/oauth-contribution.js';
import {
  createRefreshableOAuthContribution,
  createRefreshableOAuthProvider,
  type OAuthRefresh,
} from './helpers/refreshable-oauth-provider.js';

/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const fixtureDirectories: string[] = [];
const oauthAlias = 'postcommit-oauth';

describe('public profile postcommit OAuth lifetime (#2616)', () => {
  let promptDirectory: string;
  const previousPrompts = process.env.LLXPRT_PROMPTS_DIR;
  beforeAll(async () => {
    promptDirectory = await mkdtemp(join(tmpdir(), 'engine-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptDirectory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previousPrompts === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previousPrompts;
    await rm(promptDirectory, { recursive: true, force: true });
  });
  const builtCredentials = useOwnedCredentials();
  const otherCredentials = useOwnedCredentials();
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
    // The fake replay seam would pin every agent to the `fake` provider.
    delete process.env.LLXPRT_FAKE_RESPONSES;
    await enableOAuthProviders(directory, [oauthAlias]);
    const preparationEntered = gate();
    const preparationRelease = gate();
    const httpEntered = gate();
    const httpRelease = gate();
    const saveEntered = gate();
    const saveRelease = gate();
    const lockReleased = gate();
    let preparation = false;
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
    const agents: Agent[] = [];
    const pending: Array<Promise<unknown>> = [];
    const refreshNative: OAuthRefresh = async (current, signal) => {
      refreshStarted = true;
      refreshRequests++;
      committedAtRefresh = readModel() === 'committed-oauth-model';
      refreshSignal = signal;
      httpEntered.release();
      if (dispose === 'http' && refreshSignal) {
        const abortSignal = refreshSignal;
        await new Promise<void>((resolve, reject) => {
          const onAbort = (): void => reject(abortSignal.reason);
          abortSignal.addEventListener('abort', onAbort, { once: true });
          void httpRelease.promise.then(() => {
            abortSignal.removeEventListener('abort', onAbort);
            resolve();
          });
        });
      } else {
        await httpRelease.promise;
      }
      return {
        ...current,
        access_token: 'rotated-access',
        refresh_token: 'rotated-refresh',
        expiry: Math.floor(Date.now() / 1000) + (renewal ? 3600 : 120),
      };
    };
    const refreshOtherOwner: OAuthRefresh = async (current) => {
      otherRefreshRequests++;
      return {
        ...current,
        access_token: `owner-b-rotation-${otherRefreshRequests}`,
        refresh_token: 'refresh-owner-b-primary',
        expiry: Math.floor(Date.now() / 1000) + 600,
      };
    };
    const plainProvider = createRecordingProvider();
    const oauthContribution = createRefreshableOAuthContribution([
      { alias: oauthAlias, refresh: refreshNative },
    ]);
    try {
      const label = `postcommit-${randomUUID()}`;
      const ownerConfig = (
        provider: string,
        sessionId: string,
        tokenStore: AgentConfig['tokenStore'],
        credentialAuthority: AgentConfig['credentialAuthority'],
        providerContributions: AgentConfig['providerContributions'],
      ): AgentConfig => ({
        provider,
        model: 'initial-model',
        sessionId,
        workingDir: directory,
        telemetry: { enabled: false },
        recording: { enabled: false },
        interactive: true,
        tokenStore,
        credentialAuthority,
        providerContributions,
      });
      const profile: Profile = {
        version: 1,
        provider: oauthAlias,
        model: 'committed-oauth-model',
        modelParams: {},
        ephemeralSettings: {},
        auth: { type: 'oauth', buckets: ['primary', 'secondary'] },
      };
      const agent = await createAgent(
        ownerConfig(
          oauthAlias,
          label,
          store,
          builtCredentials().authority,
          oauthContribution.contributions,
        ),
      );
      agents.push(agent);
      const ownerB = await createAgent(
        ownerConfig(
          plainProvider.alias,
          label,
          otherStore,
          otherCredentials().authority,
          plainProvider.contributions,
        ),
      );
      agents.push(ownerB);
      await new ProfileManager().saveProfile('postcommit', profile);
      if (renewal) {
        vi.useFakeTimers();
        fakeTimers = true;
      }
      await store.saveToken(
        oauthAlias,
        renewal
          ? makeToken('old-primary', { expiresInSec: 600 })
          : makeExpiredToken('expired-primary'),
        'primary',
      );
      await store.saveToken(
        oauthAlias,
        makeExpiredToken('expired-secondary'),
        'secondary',
      );
      if (renewal) {
        otherRenewals = new OAuthManager(otherStore);
        otherRenewals.registerProvider(
          createRefreshableOAuthProvider({
            alias: oauthAlias,
            refresh: refreshOtherOwner,
          }),
        );
        await otherRenewals.toggleOAuthEnabled(oauthAlias);
        await otherStore.saveToken(
          oauthAlias,
          makeToken('owner-b-primary', { expiresInSec: 600 }),
          'primary',
        );
        await otherRenewals.configureProactiveRenewalsForProfile({
          provider: oauthAlias,
          auth: { type: 'oauth', buckets: ['primary'] },
        });
      }
      readModel = () => agent.getModel();
      // A closed agent has no model read, so the published models stand in
      // for the selected model after disposal.
      const publishedModels: string[] = [];
      agent.settings.subscribeModelChanges((published) => {
        if (published !== undefined) publishedModels.push(published.model);
      });
      preparation = true;
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
        expect(agent.getModel()).toBe('committed-oauth-model');
        const first = agent.dispose();
        const disposal = observe(first);
        pending.push(disposal.result);
        expect(refreshSignal?.aborted).toBe(true);
        expect(agent.dispose()).toBe(first);
        await successfulTurn(ownerB);
        expect(await application.result).toHaveProperty(
          'error.committed',
          true,
        );
        expect(await disposal.result).toStrictEqual({ value: undefined });
        expect(persisted).toBe(false);
        expect(publishedModels[publishedModels.length - 1]).toBe(
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
          (await store.getToken(oauthAlias, 'primary'))?.refresh_token,
        ).toBe('rotated-refresh');
        const ownerBToken = (await otherStore.getToken(oauthAlias, 'primary'))
          ?.access_token;
        await advanceTimersByTimeAsync(4000000);
        expect(
          (await otherStore.getToken(oauthAlias, 'primary'))?.access_token,
        ).not.toBe(ownerBToken);
        expect(refreshRequests).toBe(1);
        await otherRenewals?.configureProactiveRenewalsForProfile({});
        vi.useRealTimers();
        fakeTimers = false;
        if (dispose === 'renewal-replace') await successfulTurn(agent);
        return;
      }
      if (dispose) {
        expect(agent.getModel()).toBe('committed-oauth-model');
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
        expect(await application.result).toHaveProperty(
          'error.committed',
          true,
        );
        expect(publishedModels[publishedModels.length - 1]).toBe(
          'committed-oauth-model',
        );
        await expect(
          oauthContribution.managers[0].getOAuthToken(oauthAlias, 'primary'),
        ).rejects.toThrow('OAuth manager is disposed');
        expect(
          (await store.getToken(oauthAlias, 'primary'))?.refresh_token,
        ).toBe('rotated-refresh');
        const successor = await createAgent(
          ownerConfig(
            plainProvider.alias,
            `${label}-successor`,
            new MemoryTokenStore(),
            builtCredentials().authority,
            plainProvider.contributions,
          ),
        );
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
          (await store.getToken(oauthAlias, 'primary'))?.refresh_token,
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
        restoreEnvironment(environment);
      }
    }
  }

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
