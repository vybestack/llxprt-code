/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MessageActionReturn } from './types.js';
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

export { logger };
