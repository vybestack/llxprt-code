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
  type RuntimeModel,
} from '@vybestack/llxprt-code-core';
import { parseEphemeralSettingValue } from '@vybestack/llxprt-code-settings/settings/ephemeral-settings.js';
import type { SubscribeModelChanges } from '@vybestack/llxprt-code-core/utils/events.js';
import type { ClientCapabilitiesWithSession } from './acp-types.js';

const REASONING_VALUES = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const EMOJI_VALUES = ['allowed', 'auto', 'warn', 'error'];
const logger = new DebugLogger('llxprt:zed-integration:config-options');

function selectOption(value: string): acp.SessionConfigSelectOption {
  return { value, name: value };
}

function settingOption(
  readSetting: Agent['getEphemeralSetting'],
  id: string,
  name: string,
  category: acp.SessionConfigOptionCategory,
  values: readonly string[],
  fallback: string,
): acp.SessionConfigOption {
  const current = readSetting(id);
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
  listModels: Agent['listAvailableModels'],
): Promise<RuntimeModel[] | undefined> {
  try {
    return await listModels();
  } catch (error) {
    logger.debug(() => `Failed to load available models: ${String(error)}`);
    return undefined;
  }
}

export async function buildZedConfigOptions(
  readModel: Agent['getModel'],
  listModels: Agent['listAvailableModels'],
  readSetting: Agent['getEphemeralSetting'],
): Promise<acp.SessionConfigOption[]> {
  const currentModel = readModel();
  const models = await availableModels(listModels);
  return [
    ...(models === undefined || currentModel.length === 0
      ? []
      : [modelOption(currentModel, models)]),
    settingOption(
      readSetting,
      'reasoning.effort',
      'Thinking level',
      'thought_level',
      REASONING_VALUES,
      'medium',
    ),
    settingOption(
      readSetting,
      'emojifilter',
      'Emoji filter',
      '_display',
      EMOJI_VALUES,
      'auto',
    ),
  ];
}

export async function applyZedConfigOption(
  readModel: Agent['getModel'],
  listModels: Agent['listAvailableModels'],
  selectModel: Agent['setModel'],
  readSetting: Agent['getEphemeralSetting'],
  writeSetting: Agent['setEphemeralSetting'],
  configId: string,
  value: string,
): Promise<acp.SessionConfigOption[]> {
  if (configId === 'model') {
    const models = await availableModels(listModels);
    if (models === undefined) {
      throw acp.RequestError.internalError(
        { configId },
        'Unable to verify model availability.',
      );
    }
    if (value !== readModel() && !models.some(({ id }) => id === value)) {
      throw acp.RequestError.invalidParams({ value }, 'Unavailable model.');
    }
    try {
      await selectModel(value);
    } catch (error) {
      logger.debug(() => `Failed to set model: ${String(error)}`);
      throw acp.RequestError.internalError(
        { configId },
        'Unable to set model.',
      );
    }
    return buildZedConfigOptions(readModel, listModels, readSetting);
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
    writeSetting(configId, parsed.value);
    coreEvents.emitSettingsChanged();
  } catch (error) {
    logger.debug(() => `Failed to apply config option: ${String(error)}`);
    throw acp.RequestError.internalError(
      { configId },
      'Unable to apply config option.',
    );
  }
  return buildZedConfigOptions(readModel, listModels, readSetting);
}

export async function zedConfigOptionsForClient(
  capabilities: ClientCapabilitiesWithSession | undefined,
  readModel: Agent['getModel'],
  listModels: Agent['listAvailableModels'],
  readSetting: Agent['getEphemeralSetting'],
): Promise<Pick<acp.NewSessionResponse, 'configOptions'>> {
  return capabilities?.session?.configOptions === true
    ? {
        configOptions: await buildZedConfigOptions(
          readModel,
          listModels,
          readSetting,
        ),
      }
    : {};
}

export async function setZedConfigOption(
  readModel: Agent['getModel'],
  listModels: Agent['listAvailableModels'],
  selectModel: Agent['setModel'],
  readSetting: Agent['getEphemeralSetting'],
  writeSetting: Agent['setEphemeralSetting'],
  configId: string,
  value: string,
): Promise<acp.SetSessionConfigOptionResponse> {
  return {
    configOptions: await applyZedConfigOption(
      readModel,
      listModels,
      selectModel,
      readSetting,
      writeSetting,
      configId,
      value,
    ),
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
  readModel: Agent['getModel'],
  listModels: Agent['listAvailableModels'],
  readSetting: Agent['getEphemeralSetting'],
  sendUpdate: (update: acp.SessionUpdate) => Promise<void>,
  onError: (error: unknown) => void,
  subscribeModelChanges: SubscribeModelChanges,
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
          readModel,
          listModels,
          readSetting,
          sendUpdate,
          isStopped,
          onError,
        );
      }
    } finally {
      running = false;
    }
  }
  const releaseModelChanges = subscribeModelChanges(refresh);
  coreEvents.on(CoreEvent.SettingsChanged, refresh);
  return () => {
    stopped = true;
    releaseModelChanges();
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
  readModel: Agent['getModel'],
  listModels: Agent['listAvailableModels'],
  readSetting: Agent['getEphemeralSetting'],
  sendUpdate: (update: acp.SessionUpdate) => Promise<void>,
  isStopped: () => boolean,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    const configOptions = await buildZedConfigOptions(
      readModel,
      listModels,
      readSetting,
    );
    if (isStopped()) return;
    await sendUpdate({
      sessionUpdate: 'config_option_update',
      configOptions,
    });
  } catch (error) {
    onError(error);
  }
}
