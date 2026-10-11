import type { SubagentDefinitionReads } from '@vybestack/llxprt-code-core';
import type { PromptPolicy } from '@vybestack/llxprt-code-core/core/prompts.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import { resolvePromptMemory } from './promptMemoryPolicy.js';
import { shouldIncludeSubagentDelegationForConfig } from './clientToolGovernance.js';
export async function buildSystemInstruction(
  config: Config,
  readMcpInstructions: () => string | undefined,
  enabledToolNames: string[],
  environmentMetadata: ReadonlyArray<{ readonly text?: string }>,
  provider: string | undefined,
  model: string,
  directories: readonly string[],
  instructions: InstructionReadOperations,
  promptPolicy: PromptPolicy,
  subagents?: Pick<SubagentDefinitionReads, 'listSubagents'>,
): Promise<string> {
  const { userMemory, coreMemory, mcpInstructions } = await resolvePromptMemory(
    config,
    readMcpInstructions,
    directories,
    instructions,
  );

  const includeSubagentDelegation =
    await shouldIncludeSubagentDelegationForConfig(subagents, enabledToolNames);
  const interactionMode = config.isInteractive()
    ? 'interactive'
    : 'non-interactive';

  let systemInstruction = await getCoreSystemPromptAsync({
    userMemory,
    coreMemory,
    mcpInstructions,
    model,
    provider,
    policy: promptPolicy,
    tools: enabledToolNames,
    includeSubagentDelegation,
    interactionMode,
  });

  const metadata = environmentMetadata
    .map((part) => part.text ?? '')
    .join('\n');
  const envContextText = [metadata, instructions.snapshot().environmentMemory]
    .filter(Boolean)
    .join('\n\n');
  if (envContextText) {
    systemInstruction = envContextText + '\n\n' + systemInstruction;
  }

  return systemInstruction;
}
