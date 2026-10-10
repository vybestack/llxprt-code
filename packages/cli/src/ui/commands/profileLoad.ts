/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandContext, MessageActionReturn } from './types.js';
import {
  agentActiveProviderStatus,
  agentProviderSwitchRecorder,
  recordActiveProviderSwitch,
} from '../utils/recordActiveProviderSwitch.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';

const logger = new DebugLogger('llxprt:ui:profile-command');

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

export async function applyLoadedProfileConfig(
  context: CommandContext,
): Promise<void> {
  await context.services.agent?.sessionClient.publishTools();
}

export async function recordProviderSwitch(
  context: CommandContext,
  result: { providerName?: string },
  profileLoadResult: ProfileLoadResultView,
  reportFailure: (message: string) => void,
): Promise<void> {
  const agent = context.services.agent;
  if (!agent) throw new Error('Session agent is unavailable');
  return recordActiveProviderSwitch(
    context.recordingOwner === 'agent'
      ? agentProviderSwitchRecorder((event) =>
          agent.session.recordRecordingEvent(event),
        )
      : context.recordingIntegration,
    agentActiveProviderStatus(
      () => agent.getProvider(),
      () => agent.getModel(),
    ),
    reportFailure,
    {
      providerName: result.providerName,
      modelName: profileLoadResult.modelName,
    },
  );
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
