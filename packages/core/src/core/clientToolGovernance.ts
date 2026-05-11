/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FunctionDeclaration } from '@google/genai';
import type { ToolRegistryView } from '../runtime/AgentRuntimeContext.js';
import type { ToolRegistry } from '../tools/tool-registry.js';
import type { Config } from '../config/config.js';
import { shouldIncludeSubagentDelegation } from '../prompt-config/subagent-delegation.js';

export { shouldIncludeSubagentDelegation } from '../prompt-config/subagent-delegation.js';

/**
 * Reads the tool governance ephemeral settings (allowed/disabled tool lists).
 * Returns undefined if neither list is configured.
 */
export function getToolGovernanceEphemerals(config: Config):
  | {
      allowed?: string[];
      disabled?: string[];
    }
  | undefined {
  const allowedList = readToolList(config.getEphemeralSetting('tools.allowed'));
  const disabledList = readToolList(
    config.getEphemeralSetting('tools.disabled') ??
      config.getEphemeralSetting('disabled-tools'),
  );

  const hasAllowed = allowedList.length > 0;
  const hasDisabled = disabledList.length > 0;

  if (!hasAllowed && !hasDisabled) {
    return undefined;
  }

  return {
    allowed: hasAllowed ? allowedList : undefined,
    disabled: hasDisabled ? disabledList : undefined,
  };
}

/**
 * Parses a raw tool list setting value into a clean string array.
 * Filters out non-string and empty entries.
 */
export function readToolList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const filtered = value
    .filter(
      (entry): entry is string =>
        typeof entry === 'string' && entry.trim().length > 0,
    )
    .map((entry) => entry.trim());
  return filtered.length > 0 ? [...filtered] : [];
}

/**
 * Builds the list of FunctionDeclarations for a given ToolRegistryView.
 * Falls back to getAllTools then getFunctionDeclarations.
 */
export function buildToolDeclarationsFromView(
  toolRegistry: ToolRegistry | undefined,
  view: ToolRegistryView,
): FunctionDeclaration[] {
  if (!toolRegistry) {
    return [];
  }

  const allowedNames = view.listToolNames();
  if (allowedNames.length === 0) {
    return [];
  }

  const declarations: FunctionDeclaration[] = [];
  if (typeof toolRegistry.getFunctionDeclarations === 'function') {
    const declarationsByName = new Map(
      toolRegistry
        .getFunctionDeclarations()
        .map((decl) => [decl.name, decl] as const),
    );
    for (const name of allowedNames) {
      const declaration = declarationsByName.get(name);
      if (declaration) {
        declarations.push(declaration);
      }
    }
    return declarations;
  }

  if (typeof toolRegistry.getAllTools === 'function') {
    const toolsByName = new Map(
      toolRegistry.getAllTools().map((tool) => [tool.name, tool]),
    );
    for (const name of allowedNames) {
      const tool = toolsByName.get(name);
      if (!tool) {
        continue;
      }
      const schema = (tool as { schema?: FunctionDeclaration }).schema;
      if (schema) {
        declarations.push(schema);
      }
    }
  }
  return declarations;
}

/**
 * Returns the deduplicated list of enabled tool names for use in system prompts.
 */
export function getEnabledToolNamesForPrompt(config: Config): string[] {
  const toolRegistry = config.getToolRegistry();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Config test doubles and runtime bootstrap may omit a tool registry.
  if (toolRegistry == null) {
    return [];
  }
  if (
    typeof (toolRegistry as { getEnabledTools?: unknown }).getEnabledTools !==
    'function'
  ) {
    return [];
  }
  return Array.from(
    new Set(
      toolRegistry
        .getEnabledTools()
        .map((tool) => tool.name)
        .filter(Boolean),
    ),
  );
}

/**
 * Determines whether to include subagent delegation instructions in the prompt.
 * Delegates to the shared shouldIncludeSubagentDelegation function.
 */
export async function shouldIncludeSubagentDelegationForConfig(
  config: Config,
  enabledToolNames: string[],
): Promise<boolean> {
  return shouldIncludeSubagentDelegation(enabledToolNames, () =>
    config.getSubagentManager(),
  );
}
