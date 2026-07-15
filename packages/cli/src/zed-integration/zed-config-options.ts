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
  DebugLogger,
  type Config,
  type RuntimeModel,
} from '@vybestack/llxprt-code-core';
import { parseEphemeralSettingValue } from '@vybestack/llxprt-code-providers/runtime.js';
import type { ClientCapabilitiesWithSession } from './acp-types.js';

const REASONING_VALUES = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const EMOJI_VALUES = ['allowed', 'auto', 'warn', 'error'];
const logger = new DebugLogger('llxprt:zed-integration:config-options');

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
    return await config.getProviderManager()?.getAvailableModels(provider);
  } catch (error) {
    logger.debug(() => `Failed to load available models: ${String(error)}`);
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
    ...(models === undefined || currentModel.length === 0
      ? []
      : [modelOption(currentModel, models)]),
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
    if (models === undefined) {
      throw acp.RequestError.internalError(
        { configId },
        'Unable to verify model availability.',
      );
    }
    if (value !== agent.getModel() && !models.some(({ id }) => id === value)) {
      throw acp.RequestError.invalidParams({ value }, 'Unavailable model.');
    }
    try {
      await agent.setModel(value);
    } catch (error) {
      throw acp.RequestError.internalError({ configId, error: String(error) });
    }
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
  value: string,
): Promise<acp.SetSessionConfigOptionResponse> {
  return {
    configOptions: await applyZedConfigOption(agent, config, configId, value),
  };
}

interface ConfigurableZedSession {
  setConfigOption(
    configId: string,
    value: string,
  ): Promise<acp.SetSessionConfigOptionResponse>;
}

export function dispatchZedConfigOption(
  capabilities: ClientCapabilitiesWithSession | undefined,
  sessions: ReadonlyMap<string, ConfigurableZedSession>,
  params: acp.SetSessionConfigOptionRequest,
): Promise<acp.SetSessionConfigOptionResponse> {
  const session = sessions.get(params.sessionId);
  if (session === undefined) {
    throw acp.RequestError.resourceNotFound(params.sessionId);
  }
  if (capabilities?.session?.configOptions !== true) {
    throw acp.RequestError.invalidParams(
      { sessionId: params.sessionId },
      'Config options not supported by client.',
    );
  }
  if (typeof params.value !== 'string') {
    throw acp.RequestError.invalidParams(
      { configId: params.configId },
      'Config value must be a string.',
    );
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
    // One loop owns refresh work; events received while it runs coalesce into
    // one additional pass instead of starting concurrent snapshots.
    if (running) return;
    running = true;
    void runRefreshLoop();
  };

  async function runRefreshLoop(): Promise<void> {
    try {
      while (pending && !stopped) {
        pending = false;
        await sendConfigOptionUpdate(
          agent,
          config,
          sendUpdate,
          isStopped,
          onError,
        );
      }
    } finally {
      running = false;
    }
  }
  coreEvents.on(CoreEvent.ModelChanged, refresh);
  coreEvents.on(CoreEvent.ModelProfileChanged, refresh);
  coreEvents.on(CoreEvent.SettingsChanged, refresh);
  return () => {
    stopped = true;
    coreEvents.off(CoreEvent.ModelChanged, refresh);
    coreEvents.off(CoreEvent.ModelProfileChanged, refresh);
    coreEvents.off(CoreEvent.SettingsChanged, refresh);
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

async function sendConfigOptionUpdate(
  agent: Pick<Agent, 'getModel' | 'getProviderStatus'>,
  config: Config,
  sendUpdate: (update: acp.SessionUpdate) => Promise<void>,
  isStopped: () => boolean,
  onError: (error: unknown) => void,
): Promise<void> {
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
