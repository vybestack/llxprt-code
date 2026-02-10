/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  GeminiClient,
  createRuntimeStateFromConfig,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import {
  FunctionCallingConfigMode,
  SendMessageParameters,
} from '@google/genai';
import { getRuntimeBridge } from '../contexts/RuntimeContext.js';

const logger = new DebugLogger('llxprt:subagent:auto-prompt');

export function createDetachedGeminiClient(config: Config): GeminiClient {
  const baseRuntimeId =
    typeof config.getSessionId === 'function'
      ? config.getSessionId()
      : undefined;
  const runtimeState = createRuntimeStateFromConfig(config, {
    runtimeId: `${baseRuntimeId ?? 'llxprt-session'}#subagent-auto#${Date.now().toString(36)}`,
  });
  const client = new GeminiClient(config, runtimeState);
  if (typeof client.clearTools === 'function') {
    client.clearTools();
  }
  return client;
}

export async function generateAutoPrompt(
  config: Config,
  description: string,
): Promise<string> {
  const autoModePrompt = `Generate a detailed system prompt for a subagent with the following purpose:\n\n${description}\n\nRequirements:\n- Create a comprehensive system prompt that defines the subagent's role, capabilities, and behavior\n- Be specific and actionable\n- Use clear, professional language\n- Output ONLY the system prompt text, no explanations or metadata`;

  const requestPayload: SendMessageParameters = {
    message: autoModePrompt,
    config: {
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.NONE,
        },
      },
      serverTools: [],
    } as SendMessageParameters['config'] & { serverTools: unknown[] },
  };

  const providerName =
    typeof config.getProvider === 'function'
      ? config.getProvider()?.toLowerCase()
      : undefined;
  let client = config.getGeminiClient();
  let cleanupDetached: GeminiClient | undefined;
  let useRuntimeScope = true;

  if (!client || providerName === 'gemini') {
    cleanupDetached = createDetachedGeminiClient(config);
    client = cleanupDetached;
    useRuntimeScope = false;
  }

  if (!client) {
    throw new Error(
      'Unable to access Gemini client. Run /auth login or try manual mode.',
    );
  }

  const requestFromClient = async (
    targetClient: GeminiClient,
    options?: { useRuntimeScope?: boolean },
  ): Promise<{ text?: string }> => {
    const executeRequest = () =>
      targetClient.generateDirectMessage(
        requestPayload,
        'subagent-auto-prompt',
      );
    if (options?.useRuntimeScope === false) {
      return executeRequest();
    }
    try {
      const runtimeBridge = getRuntimeBridge();
      return await runtimeBridge.runWithScope(executeRequest);
    } catch (_runtimeError) {
      return executeRequest();
    }
  };

  logger.log(() => '[auto-prompt] generating expanded prompt', {
    provider: providerName,
  });

  let response: { text?: string };
  try {
    response = await requestFromClient(client, { useRuntimeScope });
  } finally {
    cleanupDetached?.dispose?.();
  }

  const text = response.text || '';
  if (text.trim() === '') {
    throw new Error(
      'Model returned empty response. Try manual mode or rephrase your description.',
    );
  }
  return text;
}
