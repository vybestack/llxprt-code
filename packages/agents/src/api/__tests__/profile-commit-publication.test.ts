/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { fromConfig } from '../fromConfig.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import {
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core/utils/events.js';
import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import {
  MemoryTokenStore,
  makeToken,
} from './helpers/provider-auth-fixtures.js';

import { createLoopHolder, rebuildLoop } from '../loop/rebuildLoop.js';

function originalCauses(error: unknown): unknown[] {
  return error instanceof AggregateError
    ? error.errors.flatMap(originalCauses)
    : [error];
}

describe('profile-commit-publication', () => {
  it.each([false, true])(
    'retains committed state and retires both old subscriptions (removal throws: %s)',
    async (removalThrows) => {
      const built = await buildCliStyleConfig('multi-turn-text.jsonl');
      const ownerModels = coreEvents.listeners(CoreEvent.ModelChanged);
      const ownerProfiles = coreEvents.listeners(CoreEvent.ModelProfileChanged);
      const agent = await fromConfig({
        oauthManager: built.runtime.oauthManager,
        providerFileLifecycle: built.runtime.providerFileLifecycle,
        settingsOwner: built.settingsOwner,
        settingsService: built.settingsService,
        providerManager: built.providerManager,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        messageBus: built.messageBus,
      });
      const manager = built.providerManager;

      const alternative = new FakeProvider(
        fileURLToPath(
          new URL('./fixtures/multi-turn-text.jsonl', import.meta.url),
        ),
        built.config.getTargetDir(),
      );
      alternative.name = 'alternative';
      alternative.baseProviderConfig = {
        baseURL: 'https://alternative.invalid',
      };
      manager.registerProvider(alternative);
      const oldModels = coreEvents
        .listeners(CoreEvent.ModelChanged)
        .filter((listener) => !ownerModels.includes(listener));
      const oldProfiles = coreEvents
        .listeners(CoreEvent.ModelProfileChanged)
        .filter((listener) => !ownerProfiles.includes(listener));
      await agent.agentClient.startChat();
      const { agentClient: priorClient } = agent;
      const history = priorClient.getHistoryService();
      const modelError = new Error('model listener failed');
      const profileError = new Error('profile listener failed');
      const removalError = new Error('old model removal failed');
      const onModel = (): never => {
        throw modelError;
      };
      const onProfile = (): never => {
        throw profileError;
      };
      let removalFailed = false;
      const onRemove = (
        event: string | symbol,
        listener: (...args: unknown[]) => void,
      ): void => {
        if (
          removalThrows &&
          !removalFailed &&
          event === CoreEvent.ModelChanged &&
          oldModels.includes(listener)
        ) {
          removalFailed = true;
          throw removalError;
        }
      };
      coreEvents.on(CoreEvent.ModelChanged, onModel);
      coreEvents.on(CoreEvent.ModelProfileChanged, onProfile);
      coreEvents.addListener('removeListener', onRemove);
      try {
        const outcome = await agent.profiles
          .applySnapshot({
            version: 1,
            provider: 'alternative',
            model: 'committed-after-listener-error',
            modelParams: {},
            ephemeralSettings: {},
          })
          .then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          );
        expect(outcome).toHaveProperty('error.committed', true);
        expect(outcome).toHaveProperty(
          'error.result.modelName',
          'committed-after-listener-error',
        );
        if (!('error' in outcome))
          throw new Error('Expected committed failure');
        expect(originalCauses(outcome.error)).toContain(modelError);
        expect(originalCauses(outcome.error)).toContain(profileError);
        expect(originalCauses(outcome.error).includes(removalError)).toBe(
          removalThrows,
        );
        for (const listener of oldModels)
          expect(coreEvents.listeners(CoreEvent.ModelChanged)).not.toContain(
            listener,
          );
        for (const listener of oldProfiles)
          expect(
            coreEvents.listeners(CoreEvent.ModelProfileChanged),
          ).not.toContain(listener);
        expect(agent.agentClient).not.toBe(priorClient);
        expect(agent.agentClient.getHistoryService()).toBe(history);
        expect(agent.getModel()).toBe('committed-after-listener-error');
        expect(agent.profiles.isApplying()).toBe(false);
        coreEvents.off(CoreEvent.ModelChanged, onModel);
        coreEvents.off(CoreEvent.ModelProfileChanged, onProfile);
        coreEvents.removeListener('removeListener', onRemove);
        await agent.profiles.applySnapshot({
          version: 1,
          provider: 'alternative',
          model: 'recovered',
          modelParams: {},
          ephemeralSettings: {},
        });
        const events = [];
        for await (const event of agent.stream(
          'continue after notification failure',
          { mcpDiscovery: 'skip' },
        ))
          events.push(event);
        expect(events.filter((event) => event.type === 'error')).toStrictEqual(
          [],
        );
        expect(events.filter((event) => event.type === 'done')).toStrictEqual([
          { type: 'done', reason: 'stop' },
        ]);
      } finally {
        coreEvents.off(CoreEvent.ModelChanged, onModel);
        coreEvents.off(CoreEvent.ModelProfileChanged, onProfile);
        coreEvents.removeListener('removeListener', onRemove);
        await agent.dispose();
        await built.config.dispose();
        await built.cleanup();
      }
    },
    30000,
  );

  it('rolls back supported active-provider loss after model selection', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    const agent = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      config: built.config,
      mcpRuntime: built.mcpRuntime,
      messageBus: built.messageBus,
    });
    const settings = built.settingsService;
    const manager = built.providerManager;
    if (!(manager instanceof ProviderManager))
      throw new Error('Expected real provider manager');
    const before = agent.captureProfile();
    const interrupt = (event: { key: string; newValue: unknown }): void => {
      if (event.key === 'temperature' && event.newValue === 0.25)
        manager.clearActiveProvider();
    };
    settings.on('provider-change', interrupt);
    try {
      await expect(
        agent.profiles.applySnapshot({
          version: 1,
          provider: 'fake',
          model: 'late-loss',
          modelParams: { temperature: 0.25 },
          ephemeralSettings: {},
        }),
      ).rejects.toThrow('Active provider "fake" is not registered');
      expect(agent.captureProfile()).toStrictEqual(before);
      expect(agent.getProvider()).toBe('fake');
      expect(agent.profiles.isApplying()).toBe(false);
    } finally {
      settings.off('provider-change', interrupt);
      await agent.dispose();
      await built.cleanup();
    }
  }, 30000);

  it('keeps the previous real loop runnable after replacement construction fails', async () => {
    const built = await buildCliStyleConfig('plain-text.jsonl');
    try {
      const holder = createLoopHolder();
      const deps = {
        telemetry: built.settingsOwner.telemetry,
        loopHolder: holder,
        resolveClient: () => built.agentClient,
        toolSelection: built.agentClient.tools,
        config: built.config,
        mcpRuntime: built.mcpRuntime,
        messageBus: built.messageBus,
        readExecutionPolicy: () =>
          built.settingsOwner.readToolExecutionPolicy(),
        getToolGovernance: () =>
          built.settingsOwner.readToolGovernance(
            built.config.getExcludeTools() ?? [],
          ),
      };
      const previous = rebuildLoop(deps);
      const controller = holder.activeRunController;
      if (!controller) throw new Error('Initial loop controller missing');
      const failure = new Error('replacement loop configuration failed');
      const interactive = vi
        .spyOn(built.config, 'isInteractive')
        .mockImplementationOnce(() => {
          throw failure;
        });
      try {
        expect(() => rebuildLoop(deps)).toThrow(failure);
      } finally {
        interactive.mockRestore();
      }
      const events = [];
      for await (const event of previous.run(
        'prior loop remains usable',
        controller.signal,
      ))
        events.push(event);
      expect(events.some((event) => event.kind === 'stream')).toBe(true);
    } finally {
      await built.cleanup();
    }
  }, 30000);

  it('retains renewal schedules and publishes no profile success when real loop preparation fails', async () => {
    const built = await buildCliStyleConfig('multi-turn-text.jsonl');
    const store = new MemoryTokenStore();
    const oauth = new OAuthManager(store, undefined, {
      config: built.config,
      messageBus: built.messageBus,
    });
    oauth.registerProvider({
      name: 'fake',
      initiateAuth: async () => {
        throw new Error('Unexpected interactive auth');
      },
      getToken: async () => null,
      refreshToken: async (token) => ({
        ...token,
        access_token: `${token.access_token}-renewed`,
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
    });
    await oauth.toggleOAuthEnabled('fake');
    const agent = await fromConfig({
      settingsOwner: built.settingsOwner,
      settingsService: built.settingsService,
      agentClient: built.agentClient,
      providerManager: built.providerManager,
      config: built.config,
      mcpRuntime: built.mcpRuntime,
      messageBus: built.messageBus,
    });
    const models: string[] = [];
    const profiles: unknown[] = [];
    const onModel = (model: string): void => {
      models.push(model);
    };
    const onProfile = (profile: unknown): void => {
      profiles.push(profile);
    };
    coreEvents.on(CoreEvent.ModelChanged, onModel);
    coreEvents.on(CoreEvent.ModelProfileChanged, onProfile);
    const initialModel = agent.getModel();
    try {
      const initialEvents = [];
      for await (const event of agent.stream('remember the prior conversation'))
        initialEvents.push(event);
      expect(initialEvents.some((event) => event.type === 'error')).toBe(false);
      const priorHistory = await agent.getHistory();
      expect(priorHistory.length).toBeGreaterThan(0);
      vi.useFakeTimers();
      for (const bucket of ['old', 'replacement']) {
        await store.saveToken(
          'fake',
          makeToken(bucket, { expiresInSec: 600 }),
          bucket,
        );
      }
      await oauth.configureProactiveRenewalsForProfile({
        provider: 'fake',
        auth: { type: 'oauth', buckets: ['old'] },
      });
      oauth.setSessionBucket('fake', 'old');
      const failure = new Error('loop configuration unavailable');
      const interactive = vi
        .spyOn(built.config, 'isInteractive')
        .mockImplementationOnce(() => {
          throw failure;
        });
      try {
        await expect(
          agent.profiles.applySnapshot(
            {
              version: 1,
              provider: 'fake',
              model: 'replacement-model',
              modelParams: {},
              ephemeralSettings: {},
              auth: { type: 'oauth', buckets: ['replacement'] },
            },
            { profileName: 'replacement' },
          ),
        ).rejects.toBe(failure);
      } finally {
        interactive.mockRestore();
      }
      expect(agent.getModel()).toBe(initialModel);
      expect(oauth.getSessionBucket('fake')).toBe('old');
      expect(agent.profiles.isApplying()).toBe(false);
      await advanceTimersByTimeAsync(305000);
      expect((await store.getToken('fake', 'old'))?.access_token).toBe(
        'old-renewed',
      );
      expect((await store.getToken('fake', 'replacement'))?.access_token).toBe(
        'replacement',
      );
      expect(profiles).toStrictEqual([]);
      expect(models).toStrictEqual([]);
      vi.useRealTimers();
      expect(await agent.getHistory()).toStrictEqual(priorHistory);
      const recoveredEvents = [];
      for await (const event of agent.stream('continue on the prior profile'))
        recoveredEvents.push(event);
      expect(recoveredEvents.some((event) => event.type === 'error')).toBe(
        false,
      );
      expect(recoveredEvents.some((event) => event.type === 'done')).toBe(true);
      await agent.profiles.applySnapshot(
        {
          version: 1,
          provider: 'fake',
          model: 'committed-model',
          modelParams: {},
          ephemeralSettings: {},
        },
        { profileName: 'committed' },
      );
      expect(agent.getModel()).toBe('committed-model');
      expect(profiles).toHaveLength(1);
      expect(models).toStrictEqual(['committed-model']);
    } finally {
      coreEvents.off(CoreEvent.ModelChanged, onModel);
      coreEvents.off(CoreEvent.ModelProfileChanged, onProfile);
      vi.useRealTimers();
      await agent.dispose();
      await built.cleanup();
    }
  }, 30000);
});
