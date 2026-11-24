/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentClientGenerateConfig } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/toolDeclaration.js';
import type { SendMessageParams } from './chatSession.js';
import { canonicalizeToolName } from './toolGovernance.js';

export interface ToolSelectionHookResult {
  tools: ToolDeclaration[] | undefined;
  allowedFunctionNames: string[] | undefined;
}

/**
 * Applies the BeforeToolSelection hook to the tools a non-streaming send
 * offers, returning the tools the hook leaves and the names it allows.
 */
export async function applyToolSelectionHook(
  tools: AgentClientGenerateConfig['tools'],
  model: string,
  hookOwner?: NonNullable<SendMessageParams['recordingExecution']>['hookOwner'],
): Promise<ToolSelectionHookResult> {
  const toolsFromConfig = Array.isArray(tools) ? tools : [];
  if (hookOwner?.beforeToolSelection === undefined)
    return { tools: toolsFromConfig, allowedFunctionNames: undefined };
  const toolSelectionResult = await hookOwner.beforeToolSelection(
    { model, contents: [], tools: toolsFromConfig },
    hookOwner.signal,
  );
  const modifiedConfig = toolSelectionResult?.applyToolChoiceModifications({
    tools: toolsFromConfig,
  });
  const toolChoice = modifiedConfig?.toolChoice;
  if (toolChoice?.mode === 'none') {
    return { tools: [], allowedFunctionNames: [] };
  }
  const allowedFunctions = toolChoice?.allowedToolNames;
  if (!Array.isArray(allowedFunctions)) {
    return { tools: toolsFromConfig, allowedFunctionNames: undefined };
  }

  const allowedNames = new Set(allowedFunctions.map(canonicalizeToolName));
  const filteredTools = toolsFromConfig.filter((decl) =>
    allowedNames.has(canonicalizeToolName(decl.name)),
  );
  return { tools: filteredTools, allowedFunctionNames: allowedFunctions };
}
