/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Config,
  ContentGeneratorConfig,
  AgentClientContract,
  AgentChatContract,
} from '@vybestack/llxprt-code-core';
import * as fs from 'fs/promises';
import os from 'os';
import {
  setProviderApiKey,
  setProviderBaseUrl,
  clearActiveModelParam,
  getActiveModelParams,
  setActiveModelParam,
  switchActiveProvider,
} from '@vybestack/llxprt-code-providers/runtime.js';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';

interface DebugLoggerLike {
  debug: (fn: () => string) => void;
}

export async function applyRuntimeProviderOverrides(
  config: Config,
  logger: DebugLoggerLike,
): Promise<void> {
  const authKey = config.getEphemeralSetting('auth-key') as string | undefined;
  const authKeyfile = config.getEphemeralSetting('auth-keyfile') as
    | string
    | undefined;
  const baseUrl = config.getEphemeralSetting('base-url') as string | undefined;

  if (authKey && authKey.trim() !== '') {
    const result = await setProviderApiKey(authKey);
    logger.debug(() => `[zed-integration] ${result.message}`);
  } else if (authKeyfile) {
    try {
      const resolvedPath = authKeyfile.replace(/^~/, os.homedir());
      const keyFromFile = (await fs.readFile(resolvedPath, 'utf-8')).trim();
      if (keyFromFile) {
        const result = await setProviderApiKey(keyFromFile);
        config.setEphemeralSetting('auth-keyfile', resolvedPath);
        logger.debug(() => `[zed-integration] ${result.message}`);
      }
    } catch (error) {
      logger.debug(
        () =>
          `ERROR: Failed to load keyfile ${authKeyfile}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (baseUrl !== undefined) {
    const result = await setProviderBaseUrl(baseUrl);
    logger.debug(() => `[zed-integration] ${result.message}`);
  }
}

export async function activateProviderFromConfig(
  sessionConfig: Config,
  logger: DebugLoggerLike,
): Promise<{
  providerManager: ReturnType<Config['getProviderManager']>;
  hasActiveProvider: boolean;
}> {
  let providerManager = sessionConfig.getProviderManager();

  if (providerManager) {
    const pm = providerManager;
    const providerName = pm.getActiveProviderName();
    logger.debug(
      () =>
        `ProviderManager exists: ${pm.hasActiveProvider() ? 'has active provider' : 'no active provider'}`,
    );
    logger.debug(() => `Active provider name: ${providerName ?? 'none'}`);
  } else {
    logger.debug(() => 'No ProviderManager available');
  }

  const configProvider = sessionConfig.getProvider();
  let hasActiveProvider = providerManager?.hasActiveProvider() ?? false;

  if (configProvider) {
    logger.debug(() => `Config has provider: ${configProvider}`);
    try {
      const result = await switchActiveProvider(configProvider);
      providerManager = sessionConfig.getProviderManager();
      hasActiveProvider =
        providerManager?.hasActiveProvider() ?? result.changed;
      for (const info of result.infoMessages) {
        logger.debug(() => `[zed-integration] ${info}`);
      }
    } catch (error) {
      logger.debug(
        () =>
          `ERROR: Failed to activate provider ${configProvider}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (!hasActiveProvider && (providerManager?.hasActiveProvider() ?? false)) {
    hasActiveProvider = true;
  }

  return { providerManager, hasActiveProvider };
}

export function applyProfileModelParams(
  sessionConfig: Config,
  providerManager: ReturnType<Config['getProviderManager']>,
  logger: DebugLoggerLike,
): void {
  const activeProvider = providerManager?.getActiveProvider();
  if (!activeProvider) {
    return;
  }

  const configWithProfile = sessionConfig as Config & {
    _profileModelParams?: Record<string, unknown>;
    _cliModelParams?: Record<string, unknown>;
  };

  const mergedModelParams = {
    ...(configWithProfile._profileModelParams ?? {}),
    ...(configWithProfile._cliModelParams ?? {}),
  };
  const existingParams = getActiveModelParams();
  if (
    Object.keys(mergedModelParams).length === 0 &&
    Object.keys(existingParams).length === 0
  ) {
    return;
  }

  logger.debug(() => 'Setting model params from profile');
  const ephemeralBaseUrl = sessionConfig.getEphemeralSetting('base-url') as
    | string
    | undefined;
  if (
    ephemeralBaseUrl &&
    ephemeralBaseUrl !== 'none' &&
    'setBaseUrl' in activeProvider &&
    typeof (activeProvider as { setBaseUrl?: (url: string) => void })
      .setBaseUrl === 'function'
  ) {
    logger.debug(() => `Setting base URL: ${ephemeralBaseUrl}`);
    (activeProvider as { setBaseUrl: (url: string) => void }).setBaseUrl(
      ephemeralBaseUrl,
    );
  }

  for (const [key, value] of Object.entries(mergedModelParams)) {
    setActiveModelParam(key, value);
  }

  for (const key of Object.keys(existingParams)) {
    if (!(key in mergedModelParams)) {
      clearActiveModelParam(key);
    }
  }
}

export async function authenticateWithProviderOrFallback(
  sessionConfig: Config,
  providerManager: ReturnType<Config['getProviderManager']>,
  logger: DebugLoggerLike,
): Promise<void> {
  const providerManagerForAuth =
    providerManager?.hasActiveProvider() === true ? providerManager : undefined;
  if (providerManagerForAuth) {
    logger.debug(
      () =>
        `Auto-authenticating with provider: ${providerManagerForAuth.getActiveProviderName()}`,
    );

    await ensureProviderManagerOnConfig(
      sessionConfig,
      providerManagerForAuth,
      logger,
    );

    await sessionConfig.refreshAuth('provider');

    const contentGenConfig = sessionConfig.getContentGeneratorConfig();
    if (contentGenConfig && !contentGenConfig.providerManager) {
      logger.debug(() => 'Adding provider manager to ContentGeneratorConfig');
      contentGenConfig.providerManager = providerManagerForAuth;
    }
  } else {
    logger.debug(() => 'Auto-authenticating with OAuth');
    await sessionConfig.refreshAuth('oauth');
  }
}

async function ensureProviderManagerOnConfig(
  sessionConfig: Config,
  providerManagerForAuth: NonNullable<ReturnType<Config['getProviderManager']>>,
  logger: DebugLoggerLike,
): Promise<void> {
  logger.debug(() => 'Setting provider runtime factories on config');
  configureProviderRuntimeFactories(sessionConfig, providerManagerForAuth);

  const serverToolsProvider = providerManagerForAuth.getServerToolsProvider();
  if (
    serverToolsProvider &&
    serverToolsProvider.name === 'gemini' &&
    'setConfig' in serverToolsProvider &&
    typeof serverToolsProvider.setConfig === 'function'
  ) {
    logger.debug(
      () =>
        'Setting config on serverToolsProvider for web search (before auth)',
    );
    serverToolsProvider.setConfig(sessionConfig);
  }
}

export function verifyContentGeneratorConfig(
  sessionConfig: Config,
  logger: DebugLoggerLike,
): void {
  let contentGenConfig: ContentGeneratorConfig | undefined;
  try {
    contentGenConfig = sessionConfig.getContentGeneratorConfig();
    logger.debug(() => `ContentGeneratorConfig exists: ${!!contentGenConfig}`);
    if (contentGenConfig) {
      logger.debug(
        () =>
          `ContentGeneratorConfig has providerManager: ${(contentGenConfig as Record<string, unknown>).providerManager != null}`,
      );
    }
  } catch (error) {
    logger.debug(() => `Failed to get ContentGeneratorConfig: ${error}`);
    throw new Error(
      'Content generator config not created after authentication. Please check your credentials.',
    );
  }

  if (!contentGenConfig) {
    throw new Error(
      'Content generator config not created after authentication.',
    );
  }
}

export async function startChatWithRetry(
  agentClient: AgentClientContract | undefined,
  sessionConfig: Config,
  logger: DebugLoggerLike,
): Promise<AgentChatContract> {
  if (!agentClient) {
    throw new Error('AgentClient is required to start a chat session.');
  }
  try {
    return await agentClient.startChat();
  } catch (error) {
    logger.debug(() => `Error starting chat: ${error}`);

    if (
      error instanceof Error &&
      error.message.includes('Content generator config')
    ) {
      logger.debug(
        () => 'Attempting late authentication due to missing config',
      );

      const providerManager = sessionConfig.getProviderManager();
      if (providerManager?.hasActiveProvider() === true) {
        await sessionConfig.refreshAuth('provider');
      } else {
        await sessionConfig.refreshAuth('oauth');
      }

      return agentClient.startChat();
    }

    throw error;
  }
}
