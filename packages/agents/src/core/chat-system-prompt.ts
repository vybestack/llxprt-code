import type { SubagentDefinitionReads } from '@vybestack/llxprt-code-core';
import type { PromptPolicy } from '@vybestack/llxprt-code-core/core/prompts.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { resolveModelForSystemPrompt } from './systemPromptModel.js';

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  getEnvironmentContext,
  getDirectoryContextString,
} from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { getEnabledToolNamesForPrompt } from './clientToolGovernance.js';
import { buildSystemInstruction } from './system-instruction.js';
import type { CreateChatSessionDeps } from './ChatSessionFactory.js';
import type { SystemPromptAssembler } from './chatSession.js';

export async function assembleChatSystemPrompt(
  deps: CreateChatSessionDeps,
): Promise<{
  model: string;
  systemInstruction: string;
  systemPromptAssembler: SystemPromptAssembler;
}> {
  const { config, runtimeState } = deps;
  const logger = new DebugLogger('llxprt:client:start');
  const enabledToolNames =
    deps.toolRegistry === undefined
      ? []
      : getEnabledToolNamesForPrompt(deps.toolRegistry);
  const envParts = await getEnvironmentContext('', deps.workspaceDirectories());
  const model = resolveModelForSystemPrompt(runtimeState.model);
  if (deps.readRuntimeSettings === undefined)
    throw new Error('System prompt requires explicit session policy');
  const readPromptPolicy = (): PromptPolicy =>
    deps.readRuntimeSettings?.().promptPolicy ?? {};
  logger.debug(() => `DEBUG [client.startChat]: Model from config: ${model}`);
  const systemInstruction = await buildSystemInstruction(
    config,
    deps.readMcpInstructions,
    enabledToolNames,
    envParts,
    runtimeState.provider,
    model,
    deps.workspaceDirectories(),
    deps.instructions,
    readPromptPolicy(),
    deps.subagentDefinitions,
  );
  const systemPromptAssembler: SystemPromptAssembler = {
    assemble: async (request: {
      provider: string | undefined;
      model: string;
    }) =>
      buildSystemInstruction(
        config,
        deps.readMcpInstructions,
        enabledToolNames,
        await getEnvironmentContext('', deps.workspaceDirectories()),
        request.provider,
        request.model,
        deps.workspaceDirectories(),
        deps.instructions,
        readPromptPolicy(),
        deps.subagentDefinitions,
      ),
  };

  return { model, systemInstruction, systemPromptAssembler };
}

export function requireInstructionReads(
  instructions: CreateChatSessionDeps['instructions'] | undefined,
): CreateChatSessionDeps['instructions'] {
  if (instructions === undefined)
    throw new Error('Client instructions require explicit session composition');
  return instructions;
}

export async function refreshClientSystemInstruction(
  config: CreateChatSessionDeps['config'],
  tools: CreateChatSessionDeps['toolRegistry'],
  readMcpInstructions: CreateChatSessionDeps['readMcpInstructions'],
  provider: string | undefined,
  directories: readonly string[],
  instructions: CreateChatSessionDeps['instructions'],
  model: string,
  promptPolicy: PromptPolicy,
  subagents?: Pick<SubagentDefinitionReads, 'listSubagents'>,
): Promise<string> {
  return buildSystemInstruction(
    config,
    readMcpInstructions,
    tools === undefined ? [] : getEnabledToolNamesForPrompt(tools),
    await getEnvironmentContext('', directories),
    provider,
    model,
    directories,
    instructions,
    promptPolicy,
    subagents,
  );
}

export async function createDirectoryContextMessage(
  directories: readonly string[],
): Promise<IContent> {
  return {
    speaker: 'human',
    blocks: [
      { type: 'text', text: await getDirectoryContextString(directories) },
    ],
  };
}
