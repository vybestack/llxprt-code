/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { fromConfig } from '../fromConfig.js';
import { assembleProviderSwitch } from '../providerSwitchAssembly.js';
import { buildCliStyleConfig } from './helpers/buildCliStyleConfig.js';
import { FakeProvider } from '@vybestack/llxprt-code-providers';
import { fileURLToPath } from 'node:url';

function replacement(workingDir: string): FakeProvider {
  const provider = new FakeProvider(
    fileURLToPath(new URL('./fixtures/multi-turn-text.jsonl', import.meta.url)),
    workingDir,
  );
  provider.name = 'replacement';
  return provider;
}

describe('provider switch transaction ownership', () => {
  it('rejects replacement failure and restores the switching owner without disturbing a successful same-label sibling', async () => {
    const first = await buildCliStyleConfig('multi-turn-text.jsonl');
    const second = await buildCliStyleConfig('multi-turn-text.jsonl');
    first.config.adoptSessionId('same-label');
    second.config.adoptSessionId('same-label');
    const a = await fromConfig({
      settingsOwner: first.settingsOwner,
      settingsService: first.settingsService,
      agentClient: first.agentClient,
      providerManager: first.providerManager,
      config: first.config,
      mcpRuntime: first.mcpRuntime,
      messageBus: first.messageBus,
    });
    const b = await fromConfig({
      settingsOwner: second.settingsOwner,
      settingsService: second.settingsService,
      agentClient: second.agentClient,
      providerManager: second.providerManager,
      config: second.config,
      mcpRuntime: second.mcpRuntime,
      messageBus: second.messageBus,
    });
    const managerA = first.providerManager;
    const managerB = second.providerManager;

    managerA.registerProvider(replacement(first.config.getTargetDir()));
    managerB.registerProvider(replacement(second.config.getTargetDir()));
    const settingsA = first.settingsService;
    first.settingsOwner.writeUserParameter('auth-key', 'first-owner-key');
    first.settingsOwner.writeUserParameter('reasoning.enabled', false);
    const originalProvider = managerA.getProviderByName('fake');
    if (!originalProvider) throw new Error('Missing original fixture provider');
    const before = {
      settings: structuredClone(settingsA.exportForStateSnapshot()),
      provider: originalProvider,
      client: first.agentClient,
    };
    const ephemerals = structuredClone(
      first.settingsOwner.captureNamedParameters(),
    );
    const failure = new Error('owner client replacement rejected');
    let started = (): void => {};
    let release = (): void => {};
    const entered = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const rejectInitialization = async (): Promise<void> => {
      started();
      await gate;
      throw failure;
    };
    const switchA = assembleProviderSwitch(
      first.config,
      settingsA,
      managerA,
      null,
      () => 'agent',
      rejectInitialization,
      first.settingsOwner,
    );
    const switchB = assembleProviderSwitch(
      second.config,
      second.settingsService,
      managerB,
      null,
      () => 'subagent',
      () => second.sessionClient.refreshAuth(),
      second.settingsOwner,
    );
    try {
      const pending = switchA('replacement');
      const observed = pending.then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
      await entered;
      const sibling = await switchB('replacement');
      expect(sibling.changed).toBe(true);
      const siblingState = {
        global: {
          activeProvider: 'replacement',
          'base-url': 'http://fake-provider.local',
        },
        providers: {
          fake: { model: undefined },
          replacement: {
            'base-url': 'http://fake-provider.local',
            model: 'fake-model',
          },
        },
      };
      release();
      expect(await observed).toStrictEqual({ error: failure });
      expect(settingsA.exportForStateSnapshot()).toStrictEqual(before.settings);
      expect(first.settingsOwner.captureNamedParameters()).toStrictEqual(
        ephemerals,
      );
      expect(managerA.getActiveProvider()).toBe(before.provider);
      expect(first.agentClient).toBe(before.client);
      const siblingSnapshot = second.settingsService.exportForStateSnapshot();
      expect({
        global: siblingSnapshot.global,
        providers: Object.fromEntries(
          Object.entries(siblingSnapshot.providers).map(([name, values]) => [
            name,
            { ...values },
          ]),
        ),
        ...('tools' in siblingSnapshot ? { tools: siblingSnapshot.tools } : {}),
      }).toStrictEqual(siblingState);
      for await (const event of a.stream('Continue on the restored owner')) {
        if (event.type === 'error') throw new Error(event.error.message);
      }
      for await (const event of b.stream('Continue on the committed sibling')) {
        if (event.type === 'error') throw new Error(event.error.message);
      }
      expect(JSON.stringify(await a.getHistory())).toContain('restored owner');
      expect(JSON.stringify(await b.getHistory())).toContain(
        'committed sibling',
      );
    } finally {
      release();
      await a.dispose();
      await b.dispose();
      await first.cleanup();
      await second.cleanup();
    }
  }, 30000);
});
