/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { getEnvironmentContext } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import { getEnabledToolNamesForPrompt } from './clientToolGovernance.js';
import {
  buildSystemInstruction,
  resolveModelForSystemPrompt,
} from './ChatSessionFactory.js';
import type { ChatSession } from './chatSession.js';

export async function updateClientSystemInstruction(
  config: Config,
  provider: string,
  chat: ChatSession,
): Promise<void> {
  const enabledToolNames = getEnabledToolNamesForPrompt(config);
  const envParts = await getEnvironmentContext(config);
  const model = resolveModelForSystemPrompt(config);
  const systemInstruction = await buildSystemInstruction(
    config,
    enabledToolNames,
    envParts,
    provider,
    model,
  );
  chat.setSystemInstruction(systemInstruction);
  const historyService = chat.getHistoryService();
  const systemPromptTokens = await historyService.estimateTokensForText(
    systemInstruction,
    model,
  );
  historyService.setBaseTokenOffset(systemPromptTokens);
}
