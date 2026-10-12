/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  buildZedConfigOptions,
  setZedConfigOption,
} from './zed-config-options.js';
import { fromConfig } from '@vybestack/llxprt-code-agents';
import { buildCliStyleConfig } from '../../agents/src/api/__tests__/helpers/buildCliStyleConfig.js';
import { projectZedSessionAgent } from './zed-session-ports.js';
import { resolveZedContextWindowSize } from './zed-helpers.js';

describe('ACP model selection without provider-manager authority', () => {
  it('re-queries live models after switching and retains the current model outside the catalogue', async () => {
    let model = 'retained';
    const settings = {
      getEphemeralSetting: () => undefined,
      setEphemeralSetting: () => undefined,
    };
    const models = {
      getModel: () => model,
      listAvailableModels: async () =>
        ['first', 'second'].map((id) => ({
          id,
          name: id.toUpperCase(),
          provider: 'local',
        })),
      setModel: async (next: string) => {
        model = next;
      },
    };
    const initial = await buildZedConfigOptions(models, settings);
    expect(initial[0]).toMatchObject({
      id: 'model',
      currentValue: 'retained',
      options: [
        { value: 'retained', name: 'retained' },
        { value: 'first', name: 'FIRST' },
        { value: 'second', name: 'SECOND' },
      ],
    });
    const updated = await setZedConfigOption(
      models,
      settings,
      'model',
      'second',
    );
    expect(updated.configOptions[0]).toMatchObject({
      currentValue: 'second',
      options: [
        { value: 'first', name: 'FIRST' },
        { value: 'second', name: 'SECOND' },
      ],
    });
    await expect(
      setZedConfigOption(models, settings, 'model', 'unavailable'),
    ).rejects.toMatchObject({ code: -32602 });
  });
  it('retains public Agent model queries and provider responses while usage reads stay live', async () => {
    const owner = await buildCliStyleConfig('plain-text.jsonl');
    const agent = await fromConfig({
      settingsService: owner.settingsService,
      config: owner.config,
      providerManager: owner.providerManager,
      messageBus: owner.messageBus,
      mcpRuntime: owner.mcpRuntime,
    });
    try {
      const port = projectZedSessionAgent(agent);
      expect(
        ['providerManager', 'agentClient', 'sessionClient'].filter(
          (key) => key in port,
        ),
      ).toStrictEqual([]);
      const provider = owner.providerManager.getActiveProvider();
      if (!provider) throw new Error('Expected an activated provider');
      let limit = 8192;
      provider.getContextLimit = () => limit;
      const modelReads = {
        getModel: () => port.getModel(),
        listAvailableModels: () => port.listAvailableModels(),
      };
      const settings = {
        getModel: () => port.getModel(),
        getEphemeralSetting: (key: string) => agent.getEphemeralSetting(key),
        setEphemeralSetting: (key: string, value: unknown) =>
          agent.setEphemeralSetting(key, value),
      };
      await agent.setModel('retained-model');
      const options = await buildZedConfigOptions(modelReads, settings);
      expect(options[0]).toMatchObject({
        id: 'model',
        currentValue: 'retained-model',
      });
      const firstLimit = resolveZedContextWindowSize(settings, () =>
        port.getProviderContextLimit(),
      );
      limit *= 2;
      expect(
        resolveZedContextWindowSize(settings, () =>
          port.getProviderContextLimit(),
        ),
      ).toBe(firstLimit * 2);
      const response = await agent.chat('Retain the ACP provider response');
      expect(response.text).toContain('a plain text reply');
    } finally {
      await agent.dispose();
      await owner.cleanup();
    }
  });
});
