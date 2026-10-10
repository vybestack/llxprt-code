/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type { ToolDeclaration } from '@vybestack/llxprt-code-core/llm-types/index.js';
import {
  isJsonSchema,
  type JsonSchema,
} from '@vybestack/llxprt-code-core/llm-types/index.js';
import type { ToolRegistryView } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import { shouldIncludeSubagentDelegation } from '@vybestack/llxprt-code-core/prompt-config/subagent-delegation.js';

export { shouldIncludeSubagentDelegation } from '@vybestack/llxprt-code-core/prompt-config/subagent-delegation.js';

/**
 * Convert a Gemini-era FunctionDeclaration (name/description/parameters/
 * parametersJsonSchema) into a neutral ToolDeclaration. Schema resolution
 * order: parametersJsonSchema → parameters → {} (empty object).
 */
export function toToolDeclaration(decl: {
  name?: string;
  description?: string;
  parametersJsonSchema?: unknown;
  parameters?: unknown;
}): ToolDeclaration | null {
  const name = typeof decl.name === 'string' ? decl.name : '';
  if (name.length === 0) {
    return null;
  }
  let schema: JsonSchema = {};
  if (isJsonSchema(decl.parametersJsonSchema)) {
    schema = decl.parametersJsonSchema;
  } else if (isJsonSchema(decl.parameters)) {
    schema = decl.parameters;
  }
  const result: ToolDeclaration = {
    name,
    parametersJsonSchema: schema,
  };
  if (typeof decl.description === 'string') {
    result.description = decl.description;
  }
  return result;
}

/**
 * Reads the tool governance ephemeral settings (allowed/disabled tool lists).
 * Returns undefined if neither list is configured.
 */
export function getToolGovernanceEphemerals(policy: {
  readonly allowed?: readonly string[];
  readonly disabled?: readonly string[];
}):
  | {
      allowed?: string[];
      disabled?: string[];
    }
  | undefined {
  const rawAllowed = policy.allowed;
  const allowedList = readToolList(rawAllowed);
  const disabledList = readToolList(policy.disabled);

  const allowedExplicit = Array.isArray(rawAllowed);
  const hasDisabled = disabledList.length > 0;

  if (!allowedExplicit && !hasDisabled) {
    return undefined;
  }

  return {
    allowed: allowedExplicit ? allowedList : undefined,
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
  toolRegistry: ToolSelection | undefined,
  view?: Pick<ToolRegistryView, 'listToolNames'>,
): ToolDeclaration[] {
  if (!toolRegistry) {
    return [];
  }
  if (view === undefined) {
    return toolRegistry.getFunctionDeclarations().flatMap((declaration) => {
      const converted = toToolDeclaration(declaration);
      return converted === null ? [] : [converted];
    });
  }

  const allowedNames = view.listToolNames();
  if (allowedNames.length === 0) {
    return [];
  }

  const declarations: ToolDeclaration[] = [];
  if (typeof toolRegistry.getFunctionDeclarations === 'function') {
    const declarationsByName = new Map(
      toolRegistry
        .getFunctionDeclarations()
        .map((decl) => [decl.name ?? '', decl] as const),
    );
    for (const name of allowedNames) {
      const declaration = declarationsByName.get(name);
      if (!declaration) continue;
      const converted = toToolDeclaration(declaration);
      if (converted) declarations.push(converted);
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
      const schema = (tool as { schema?: ToolDeclaration }).schema;
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
export function getEnabledToolNamesForPrompt(selection: {
  getFunctionDeclarations(): ReadonlyArray<{ readonly name?: string }>;
}): string[] {
  return [
    ...new Set(
      selection
        .getFunctionDeclarations()
        .map((tool) => tool.name)
        .filter(
          (name): name is string => name !== undefined && name.length > 0,
        ),
    ),
  ];
}

/**
 * Determines whether to include subagent delegation instructions in the prompt.
 * Delegates to the shared shouldIncludeSubagentDelegation function.
 */
export async function shouldIncludeSubagentDelegationForConfig(
  definitions: { listSubagents(): Promise<string[]> } | undefined,
  enabledToolNames: string[],
): Promise<boolean> {
  return shouldIncludeSubagentDelegation(enabledToolNames, () => definitions);
}
