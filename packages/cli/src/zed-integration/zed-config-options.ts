/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as acp from '@agentclientprotocol/sdk';
import type { Agent } from '@vybestack/llxprt-code-agents';
import {
  coreEvents,
  CoreEvent,
  type Config,
  type RuntimeModel,
} from '@vybestack/llxprt-code-core';
import { parseEphemeralSettingValue } from '@vybestack/llxprt-code-providers/runtime.js';
import type { ClientCapabilitiesWithSession } from './acp-types.js';

const REASONING_VALUES = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const EMOJI_VALUES = ['allowed', 'auto', 'warn', 'error'];

function selectOption(value: string): acp.SessionConfigSelectOption {
  return { value, name: value };
}

function settingOption(
  config: Config,
  id: string,
  name: string,
  category: acp.SessionConfigOptionCategory,
  values: readonly string[],
  fallback: string,
): acp.SessionConfigOption {
  const current = config.getEphemeralSetting(id);
  return {
    type: 'select',
    id,
    name,
    category,
    currentValue: typeof current === 'string' ? current : fallback,
    options: values.map(selectOption),
  };
}

function modelOption(
  currentModel: string,
  models: readonly RuntimeModel[],
): acp.SessionConfigOption {
  const available = models.some(({ id }) => id === currentModel)
    ? models
    : [{ id: currentModel, name: currentModel, provider: '' }, ...models];
  return {
    type: 'select',
    id: 'model',
    name: 'Model',
    category: 'model',
    currentValue: currentModel,
    options: available.map((model) => ({ value: model.id, name: model.name })),
  };
}

async function availableModels(
  agent: Pick<Agent, 'getProviderStatus'>,
  config: Config,
): Promise<RuntimeModel[] | undefined> {
  try {
    const provider = agent.getProviderStatus().provider;
    return (
      (await config.getProviderManager()?.getAvailableModels(provider)) ?? []
    );
  } catch {
    return undefined;
  }
}

export async function buildZedConfigOptions(
  agent: Pick<Agent, 'getModel' | 'getProviderStatus'>,
  config: Config,
): Promise<acp.SessionConfigOption[]> {
  const currentModel = agent.getModel();
  const models = await availableModels(agent, config);
  return [
    ...(models === undefined ? [] : [modelOption(currentModel, models)]),
    settingOption(
      config,
      'reasoning.effort',
      'Thinking level',
      'thought_level',
      REASONING_VALUES,
      'medium',
    ),
    settingOption(
      config,
      'emojifilter',
      'Emoji filter',
      '_display',
      EMOJI_VALUES,
      'auto',
    ),
  ];
}

export async function applyZedConfigOption(
  agent: Agent,
  config: Config,
  configId: string,
  value: string,
): Promise<acp.SessionConfigOption[]> {
  if (configId === 'model') {
    const models = await availableModels(agent, config);
    if (
      value !== agent.getModel() &&
      models?.some(({ id }) => id === value) !== true
    ) {
      throw acp.RequestError.invalidParams({ value }, 'Unavailable model.');
    }
    await agent.setModel(value);
    return buildZedConfigOptions(agent, config);
  }
  if (configId !== 'reasoning.effort' && configId !== 'emojifilter') {
    throw acp.RequestError.invalidParams(
      { configId },
      'Unknown config option.',
    );
  }
  const parsed = parseEphemeralSettingValue(configId, value);
  if (!parsed.success) {
    throw acp.RequestError.invalidParams({ configId }, parsed.message);
  }
  try {
    config.setEphemeralSetting(configId, parsed.value);
    coreEvents.emitSettingsChanged();
  } catch (error) {
    throw acp.RequestError.internalError({ configId, error: String(error) });
  }
  return buildZedConfigOptions(agent, config);
}

export async function zedConfigOptionsForClient(
  capabilities: ClientCapabilitiesWithSession | undefined,
  agent: Pick<Agent, 'getModel' | 'getProviderStatus'>,
  config: Config,
): Promise<Pick<acp.NewSessionResponse, 'configOptions'>> {
  return capabilities?.session?.configOptions === true
    ? { configOptions: await buildZedConfigOptions(agent, config) }
    : {};
}

export async function setZedConfigOption(
  agent: Agent,
  config: Config,
  configId: string,
  value: string | boolean,
): Promise<acp.SetSessionConfigOptionResponse> {
  if (typeof value !== 'string') {
    throw acp.RequestError.invalidParams(
      { configId },
      'Expected select value.',
    );
  }
  return {
    configOptions: await applyZedConfigOption(agent, config, configId, value),
  };
}

interface ConfigurableZedSession {
  setConfigOption(
    configId: string,
    value: string | boolean,
  ): Promise<acp.SetSessionConfigOptionResponse>;
}

export function dispatchZedConfigOption(
  capabilities: ClientCapabilitiesWithSession | undefined,
  sessions: ReadonlyMap<string, ConfigurableZedSession>,
  params: acp.SetSessionConfigOptionRequest,
): Promise<acp.SetSessionConfigOptionResponse> {
  const session = sessions.get(params.sessionId);
  if (session === undefined || capabilities?.session?.configOptions !== true) {
    throw acp.RequestError.resourceNotFound(params.sessionId);
  }
  return session.setConfigOption(params.configId, params.value);
}

export function observeZedConfigOptions(
  agent: Pick<Agent, 'getModel' | 'getProviderStatus'>,
  config: Config,
  sendUpdate: (update: acp.SessionUpdate) => Promise<void>,
  onError: (error: unknown) => void,
): () => void {
  let stopped = false;
  let running = false;
  let pending = false;
  const isStopped = () => stopped;
  const refresh = () => {
    pending = true;
    if (running) return;
    running = true;
    void (async () => {
      while (pending && !stopped) {
        pending = false;
        try {
          const configOptions = await buildZedConfigOptions(agent, config);
          if (isStopped()) return;
          await sendUpdate({
            sessionUpdate: 'config_option_update',
            configOptions,
          });
        } catch (error) {
          onError(error);
        }
      }
      running = false;
    })();
  };
  coreEvents.on(CoreEvent.ModelChanged, refresh);
  coreEvents.on(CoreEvent.SettingsChanged, refresh);
  return () => {
    stopped = true;
    try {
      coreEvents.off(CoreEvent.ModelChanged, refresh);
    } catch {
      // Listener removal is best-effort during teardown.
    }
    try {
      coreEvents.off(CoreEvent.SettingsChanged, refresh);
    } catch {
      // Listener removal is best-effort during teardown.
    }
  };
}

export function zedSessionConfigOptions(
  capabilities: ClientCapabilitiesWithSession | undefined,
  session: { getConfigOptions(): Promise<acp.SessionConfigOption[]> },
): Promise<Pick<acp.LoadSessionResponse, 'configOptions'>> {
  return capabilities?.session?.configOptions === true
    ? session.getConfigOptions().then((configOptions) => ({ configOptions }))
    : Promise.resolve({});
}
