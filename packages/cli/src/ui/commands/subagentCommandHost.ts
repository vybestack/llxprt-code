/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  SubagentDefinitionReads,
  SubagentDefinitionWrites,
  AgentClientContract,
  AgentClientMessageParams,
  ContentGeneratorConfig,
} from '@vybestack/llxprt-code-core';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { SubagentCommandOperations } from './subagentCommand.js';
import { getResponseTextFromBlocks } from '@vybestack/llxprt-code-core';
import { createDetachedAutoPromptClient } from '../../runtime/autoPromptDetachedClient.js';
import { generateAutoPrompt } from '../utils/autoPromptGenerator.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';

const logger = new DebugLogger('llxprt:subagent:auto-prompt');

export function bindSubagentCommand(
  reads: SubagentDefinitionReads | undefined,
  writes: SubagentDefinitionWrites | undefined,
  listProfiles: () => Promise<string[]>,
  isFuzzyEnabled: () => boolean,
  generatePrompt: (description: string) => Promise<string>,
  isConfigured: boolean,
  addItem: UseHistoryManagerReturn['addItem'],
): SubagentCommandOperations {
  const requireReads = (): SubagentDefinitionReads => {
    if (!reads) throw new Error('Subagent definitions unavailable');
    return reads;
  };
  return {
    isAvailable: reads !== undefined && writes !== undefined,
    isConfigured,
    listSubagents: (...args) => requireReads().listSubagents(...args),
    loadSubagent: (...args) => requireReads().loadSubagent(...args),
    subagentExists: (...args) => requireReads().subagentExists(...args),
    subagentExistsOnDisk: (name) => requireReads().subagentExistsOnDisk(name),
    hasSettingsSubagent: (name) => requireReads().hasSettingsSubagent(name),
    validateProfileReference: (name) =>
      requireReads().validateProfileReference(name),
    saveSubagent: (name, profile, prompt) => {
      if (!writes) throw new Error('Subagent definitions unavailable');
      return writes.saveSubagent(name, profile, prompt);
    },
    listProfiles,
    isFuzzyEnabled,
    generatePrompt,
    addItem,
  };
}

export function bindAutoPromptOperation(
  readProvider: () => string,
  readClient: () => AgentClientContract | null | undefined,
  createDetached: () => Promise<AgentClientContract>,
  readConfig: () => ContentGeneratorConfig | undefined,
): (description: string) => Promise<string> {
  return (description) =>
    generateAutoPrompt(description, async (request) => {
      const providerName = readProvider().toLowerCase();
      const live = readClient();
      const detached =
        live == null || providerName === 'gemini'
          ? await createDetachedAutoPromptClient(createDetached, readConfig())
          : undefined;
      const client = detached ?? live;
      if (client == null) {
        throw new Error(
          'Unable to access the AI client. Please configure authentication.',
        );
      }
      logger.log(() => '[auto-prompt] generating expanded prompt', {
        provider: providerName,
      });
      try {
        return await requestPromptText(client, request);
      } finally {
        await detached?.dispose();
      }
    });
}

async function requestPromptText(
  client: AgentClientContract,
  request: AgentClientMessageParams,
): Promise<string> {
  const output = await client.generateDirectMessage(
    request,
    'subagent-auto-prompt',
  );
  return getResponseTextFromBlocks(output.content.blocks) ?? '';
}
