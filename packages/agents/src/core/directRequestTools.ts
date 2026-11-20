/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { AgentClientGenerateConfig } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';
import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { SendMessageParams } from './chatSession.js';
import { canonicalizeToolName } from './toolGovernance.js';

export interface ToolSelectionHookResult {
  tools: ToolDeclaration[] | undefined;
  allowedFunctionNames: string[] | undefined;
}

export async function selectDirectRequestTools(
  model: string,
  tools: AgentClientGenerateConfig['tools'],
  hookOwner?: NonNullable<SendMessageParams['recordingExecution']>['hookOwner'],
): Promise<ToolSelectionHookResult> {
  const toolsFromConfig = Array.isArray(tools) ? tools : [];
  if (hookOwner?.beforeToolSelection === undefined)
    return { tools: toolsFromConfig, allowedFunctionNames: undefined };
  const result = await hookOwner.beforeToolSelection(
    { model, contents: [], tools: toolsFromConfig },
    hookOwner.signal,
  );
  const choice = result?.applyToolChoiceModifications({
    tools: toolsFromConfig,
  }).toolChoice;
  if (choice?.mode === 'none') return { tools: [], allowedFunctionNames: [] };
  const allowedFunctions = choice?.allowedToolNames;
  if (!Array.isArray(allowedFunctions))
    return { tools: toolsFromConfig, allowedFunctionNames: undefined };
  const allowed = new Set(allowedFunctions.map(canonicalizeToolName));
  return {
    tools: toolsFromConfig.filter((tool) =>
      allowed.has(canonicalizeToolName(tool.name)),
    ),
    allowedFunctionNames: allowedFunctions,
  };
}

export function logDirectRequestTools(
  logger: DebugLogger,
  providerName: string,
  model: string,
  tools: ToolDeclaration[] | undefined,
  baseUrl: string | undefined,
): void {
  if (Array.isArray(tools) && tools.length === 0)
    logger.warn(
      () =>
        '[TurnProcessor] Tools array exists but has 0 function declarations!',
      { tools, provider: providerName },
    );
  logger.debug(
    () => '[TurnProcessor] Calling provider.generateChatCompletion',
    {
      providerName,
      model,
      toolCount: Array.isArray(tools) ? tools.length : 0,
      baseUrl,
    },
  );
}
