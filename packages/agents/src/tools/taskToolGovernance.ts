/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import {
  canonicalizeToolName,
  buildSubagentExcludedToolNames,
  buildToolGovernance,
  getToolNameCandidates,
  isSubagentExcludedToolName,
  isToolBlocked,
} from '../core/toolGovernance.js';
import type { TaskToolParams } from './task.js';

/**
 * Internal normalized parameters derived from the public `TaskToolParams`.
 */
export interface TaskToolInvocationParams {
  subagentName: string;
  goalPrompt: string;
  behaviourPrompts: string[];
  toolWhitelist?: string[];
  outputSpec?: Record<string, string>;
  context: Record<string, unknown>;
  maxTurns?: number;
  async: boolean;
}

/**
 * Builds the governed tool whitelist from candidate tools and the registry,
 * filtering excluded tools, blocked tools, and tools not present in the
 * registry. Returns `undefined` when the result is empty so callers can apply
 * fail-closed semantics for explicit whitelists.
 */
export function buildGovernedToolWhitelist(
  candidateTools: string[] | undefined,
  registry: ToolRegistry,
  config: Config,
): string[] | undefined {
  if (!candidateTools || candidateTools.length === 0) {
    return undefined;
  }

  const excluded = buildSubagentExcludedToolNames();
  const governance = buildToolGovernance(config);
  const allowedRegistryTools = registry
    .getEnabledTools()
    .map((tool) => tool.name)
    .filter(
      (name): name is string =>
        typeof name === 'string' &&
        name.length > 0 &&
        !isSubagentExcludedToolName(name, excluded),
    );

  const allowedByCanonical = new Map<string, string[]>();
  for (const toolName of allowedRegistryTools) {
    for (const canonical of getToolNameCandidates(toolName)) {
      const existing = allowedByCanonical.get(canonical);
      if (existing === undefined) {
        allowedByCanonical.set(canonical, [toolName]);
      } else if (!existing.includes(toolName)) {
        existing.push(toolName);
      }
    }
  }

  const filteredTools = candidateTools.map((name) => {
    if (typeof name !== 'string') {
      return undefined;
    }

    const candidates = getToolNameCandidates(name);
    if (isSubagentExcludedToolName(name, excluded)) {
      return undefined;
    }
    if (candidates.some((canonical) => governance.disabled.has(canonical))) {
      return undefined;
    }

    for (const canonical of candidates) {
      const matches = allowedByCanonical.get(canonical);
      if (matches === undefined || matches.length !== 1) {
        continue;
      }
      const resolved = matches[0];
      if (!isToolBlocked(resolved, governance)) {
        return resolved;
      }
    }

    return undefined;
  });

  const validTools = filteredTools.filter(
    (name): name is string => typeof name === 'string' && name.length > 0,
  );

  if (validTools.length === 0) {
    return undefined;
  }

  const uniqueByCanonical = new Set<string>();
  const deduped: string[] = [];
  for (const tool of validTools) {
    const canonical = canonicalizeToolName(tool);
    if (!canonical || uniqueByCanonical.has(canonical)) {
      continue;
    }
    uniqueByCanonical.add(canonical);
    deduped.push(tool);
  }

  return deduped.length > 0 ? deduped : undefined;
}

/**
 * Filters excluded tools (task/list_subagents) from a whitelist when no
 * registry is available to perform full governance validation. Entries that
 * cannot be canonicalized are also dropped. Returns undefined if the result is
 * empty so the caller can apply fail-closed semantics for explicit whitelists.
 */
export function filterExcludedFromWhitelist(
  candidateTools: string[] | undefined,
): string[] | undefined {
  if (!candidateTools || candidateTools.length === 0) {
    return undefined;
  }

  const excluded = buildSubagentExcludedToolNames();
  const filtered = candidateTools.filter(
    (name): name is string =>
      typeof name === 'string' && !isSubagentExcludedToolName(name, excluded),
  );

  return filtered.length > 0 ? filtered : undefined;
}

/**
 * Removed TaskTool parameter spellings mapped to their canonical members.
 * Used only to reject legacy input with guidance — never to read values.
 */
const REMOVED_TASK_PARAM_SPELLINGS: ReadonlyMap<string, string> = new Map([
  ['subagentName', 'subagent_name'],
  ['goalPrompt', 'goal_prompt'],
  ['behaviourPrompts', 'behaviour_prompts'],
  ['behavior_prompts', 'behaviour_prompts'],
  ['behaviorPrompts', 'behaviour_prompts'],
  ['toolWhitelist', 'tool_whitelist'],
  ['output_spec', 'expected_outputs'],
  ['outputSpec', 'expected_outputs'],
  ['expectedOutputs', 'expected_outputs'],
  ['context_vars', 'context'],
  ['contextVars', 'context'],
]);

/**
 * Rejects removed TaskTool parameter spellings with an error naming the
 * canonical member. Returns `null` when every key is canonical.
 */
export function validateCanonicalTaskParamSpellings(
  params: TaskToolParams,
): string | null {
  for (const key of Object.keys(params)) {
    const canonical = REMOVED_TASK_PARAM_SPELLINGS.get(key);
    if (canonical !== undefined) {
      return `Task tool parameter '${key}' is not recognized; use the canonical '${canonical}'.`;
    }
  }
  return null;
}

/**
 * Validates that every value in an output-spec map is a plain string.
 * Rejects JSON-Schema-shaped objects (e.g. `{ type: "string", description: "..." }`)
 * that LLMs sometimes send when the parameter name invites a schema mental model.
 *
 * @returns An error message describing the first offending key, or `null` if valid.
 */
export function validateOutputSpec(
  spec: unknown,
  paramName: string,
): string | null {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    return `${paramName} must be an object mapping variable names to string descriptions.`;
  }
  for (const [key, value] of Object.entries(spec as Record<string, unknown>)) {
    if (typeof value !== 'string') {
      const typeLabel =
        typeof value === 'object'
          ? 'a JSON Schema object'
          : `a ${typeof value}`;
      return `${paramName} '${key}' must be a plain string description, not ${typeLabel}.`;
    }
  }
  return null;
}

/**
 * Validates the `expected_outputs` parameter from raw `TaskToolParams`.
 * Returns the first validation error, or `null` if valid.
 *
 * This is the single source of truth for output-param validation, shared by
 * both `validateToolParamValues` (pre-build schema-adjacent check) and
 * `resolveOutputSpec` (runtime normalization).
 */
export function validateOutputParams(params: TaskToolParams): string | null {
  if (params.expected_outputs === undefined) {
    return null;
  }
  return validateOutputSpec(params.expected_outputs, 'expected_outputs');
}

/**
 * Normalizes the public `TaskToolParams` (canonical snake_case members only)
 * into the internal camelCase `TaskToolInvocationParams`. Trims
 * prompts/tools, dedupes behaviour prompts, and resolves the async flag.
 *
 * @throws When `expected_outputs` contains non-string values.
 */
export function normalizeTaskParams(
  params: TaskToolParams,
): TaskToolInvocationParams {
  const subagentName = (params.subagent_name ?? '').trim();
  const goalPrompt = (params.goal_prompt ?? '').trim();

  const behaviourPrompts = [goalPrompt, ...(params.behaviour_prompts ?? [])]
    .map((prompt) => prompt.trim())
    .filter((prompt): prompt is string => Boolean(prompt))
    .filter((prompt, index, array) => array.indexOf(prompt) === index);

  const toolWhitelist = (params.tool_whitelist ?? [])
    .map((tool) => tool.trim())
    .filter((tool): tool is string => Boolean(tool));

  const outputSpec = resolveOutputSpec(params);

  const context = params.context ?? {};

  return {
    subagentName,
    goalPrompt,
    behaviourPrompts,
    toolWhitelist: toolWhitelist.length > 0 ? toolWhitelist : undefined,
    outputSpec,
    context,
    maxTurns: params.max_turns,
    async: params.async ?? false,
  };
}

/**
 * Resolves the output spec from `expected_outputs`. Validates that every
 * value is a plain string and throws with a clear message if a
 * JSON-Schema-shaped object is encountered.
 */
function resolveOutputSpec(
  params: TaskToolParams,
): Record<string, string> | undefined {
  const error = validateOutputParams(params);
  if (error !== null) {
    throw new Error(error);
  }
  return params.expected_outputs;
}
