/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandContext, MessageActionReturn } from './types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core';

const logger = new DebugLogger('llxprt:ui:profile-command');

type ProfileConfigService = Partial<
  Pick<
    NonNullable<CommandContext['services']['config']>,
    'getProviderManager' | 'setProvider'
  >
> & {
  getAgentClient?: () =>
    | (ReturnType<
        NonNullable<CommandContext['services']['config']>['getAgentClient']
      > & { setTools?: () => void | Promise<void> })
    | undefined;
};

export type ProfileLoadResultView = {
  infoMessages?: string[];
  warnings?: string[];
  modelName?: string;
};

export function formatProfileMessages(
  messages: readonly string[] | undefined,
  prefix: string,
): string {
  return messages?.map((message) => `\n${prefix}${message}`).join('') ?? '';
}

export function classifyLoadError(
  error: unknown,
  profileName: string,
): MessageActionReturn {
  if (!(error instanceof Error)) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to load profile: ${String(error)}`,
    };
  }
  if (error.message.includes('OAuth bucket')) {
    return { type: 'message', messageType: 'error', content: error.message };
  }
  if (error.message.includes('not found')) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Profile '${profileName}' not found`,
    };
  }
  if (error.message.includes('corrupted')) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Profile '${profileName}' is corrupted`,
    };
  }
  if (error.message.includes('missing required fields')) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Profile '${profileName}' is invalid: missing required fields`,
    };
  }
  return {
    type: 'message',
    messageType: 'error',
    content: `Failed to load profile: ${error.message}`,
  };
}

async function switchProviderManager(
  providerManager: {
    setActiveProvider(name: string): void | Promise<void>;
    getActiveProvider(): { name: string } | undefined;
  },
  providerName: string,
): Promise<void> {
  logger.debug(
    () =>
      `[profile] forcing config provider manager switch to '${providerName}'`,
  );
  try {
    void providerManager.setActiveProvider(providerName);
    logActiveProviderName(providerManager);
  } catch (error) {
    logger.error(
      () =>
        `[profile] failed to set provider on config manager: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function logActiveProviderName(providerManager: {
  setActiveProvider(name: string): void | Promise<void>;
  getActiveProvider(): { name: string } | undefined;
}): void {
  logger.debug(() => {
    let activeName = 'unknown';
    try {
      activeName = providerManager.getActiveProvider()?.name ?? 'unknown';
    } catch (readError) {
      logger.debug(
        () =>
          `[profile] unable to read active provider: ${readError instanceof Error ? readError.message : String(readError)}`,
      );
    }
    return `[profile] config manager active provider after switch: ${activeName}`;
  });
}

async function refreshGeminiTools(
  configService: ProfileConfigService,
): Promise<void> {
  const agentClient = configService.getAgentClient?.();
  if (agentClient !== undefined && typeof agentClient.setTools === 'function') {
    try {
      await agentClient.setTools();
    } catch (error) {
      logger.warn(
        () =>
          `[profile] failed to refresh Gemini tool schema after load: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export async function applyLoadedProfileConfig(
  context: CommandContext,
  result: { providerName?: string },
): Promise<void> {
  const configService = context.services
    .config as unknown as ProfileConfigService | null;
  if (configService === null) {
    return;
  }

  const providerManager = configService.getProviderManager?.();
  if (result.providerName) {
    if (providerManager !== undefined) {
      await switchProviderManager(providerManager, result.providerName);
    }
    configService.setProvider?.(result.providerName);
  }

  await refreshGeminiTools(configService);
}

export function recordProviderSwitch(
  context: CommandContext,
  result: { providerName?: string },
  profileLoadResult: ProfileLoadResultView,
): void {
  try {
    const runtime = getRuntimeApi();
    const statusAfter = runtime.getActiveProviderStatus();
    context.recordingIntegration?.recordProviderSwitch(
      statusAfter.providerName ?? result.providerName ?? '',
      statusAfter.modelName ?? profileLoadResult.modelName ?? 'unknown',
    );
  } catch {
    // Best-effort recording -- don't let it block profile loading
  }
}

export function schedulePaymentModeCheck(
  context: CommandContext,
  previousProvider: string | undefined,
): void {
  const extendedContext = context as CommandContext & {
    checkPaymentModeChange?: (forcePreviousProvider?: string) => void;
  };
  if (extendedContext.checkPaymentModeChange) {
    setTimeout(
      () => extendedContext.checkPaymentModeChange?.(previousProvider),
      100,
    );
  }
}

export { logger };
