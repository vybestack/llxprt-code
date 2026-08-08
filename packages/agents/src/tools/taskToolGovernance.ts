/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolGovernanceConfig } from '@vybestack/llxprt-code-tools/formatters/toolGovernanceUtils.js';
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
  config: ToolGovernanceConfig,
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
 * Validates the output-spec parameters (preferred `expected_outputs` and
 * deprecated `output_spec` alias) from raw `TaskToolParams`. Returns the first
 * validation error, or `null` if valid.
 *
 * This is the single source of truth for output-param validation, shared by
 * both `validateToolParamValues` (pre-build schema-adjacent check) and
 * `resolveOutputSpec` (runtime normalization).
 */
export function validateOutputParams(params: TaskToolParams): string | null {
  const preferred =
    params.expected_outputs ?? params.expectedOutputs ?? undefined;
  if (preferred !== undefined) {
    const error = validateOutputSpec(preferred, 'expected_outputs');
    if (error !== null) {
      return error;
    }
  }

  const legacy = params.output_spec ?? params.outputSpec ?? undefined;
  if (legacy !== undefined) {
    return validateOutputSpec(legacy, 'output_spec');
  }

  return null;
}

/**
 * Normalizes the public `TaskToolParams` (which accepts multiple alias keys)
 * into the canonical `TaskToolInvocationParams`. Trims prompts/tools, dedupes
 * behaviour prompts, and resolves the async flag.
 *
 * Output-spec resolution precedence (Issue #2255):
 *   1. expected_outputs / expectedOutputs (preferred, non-schema-suggestive)
 *   2. output_spec / outputSpec (deprecated alias)
 *
 * @throws When either source contains non-string values.
 */
export function normalizeTaskParams(
  params: TaskToolParams,
): TaskToolInvocationParams {
  const subagentName = (
    params.subagent_name ??
    params.subagentName ??
    ''
  ).trim();
  const goalPrompt = (params.goal_prompt ?? params.goalPrompt ?? '').trim();

  const behaviourPrompts = [goalPrompt, ...resolveBehaviourPrompts(params)]
    .map((prompt) => prompt.trim())
    .filter((prompt): prompt is string => Boolean(prompt))
    .filter((prompt, index, array) => array.indexOf(prompt) === index);

  const toolWhitelist = resolveToolWhitelist(params)
    .map((tool) => tool.trim())
    .filter((tool): tool is string => Boolean(tool));

  const outputSpec = resolveOutputSpec(params);

  const context =
    params.context ?? params.context_vars ?? params.contextVars ?? {};

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

function resolveBehaviourPrompts(params: TaskToolParams): string[] {
  return (
    firstDefined(
      params.behaviour_prompts,
      params.behavior_prompts,
      params.behaviourPrompts,
    ) ??
    params.behaviorPrompts ??
    []
  );
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function resolveToolWhitelist(params: TaskToolParams): string[] {
  return params.tool_whitelist ?? params.toolWhitelist ?? [];
}

/**
 * Resolves the output spec from `expected_outputs` (preferred) or the
 * deprecated `output_spec` alias. Validates that every value is a plain
 * string and throws with a clear message if a JSON-Schema-shaped object is
 * encountered.
 */
function resolveOutputSpec(
  params: TaskToolParams,
): Record<string, string> | undefined {
  const preferred =
    params.expected_outputs ?? params.expectedOutputs ?? undefined;
  const legacy = params.output_spec ?? params.outputSpec ?? undefined;

  const error = validateOutputParams(params);
  if (error !== null) {
    throw new Error(error);
  }

  if (preferred !== undefined) {
    return preferred;
  }

  if (legacy !== undefined) {
    return legacy;
  }

  return undefined;
}
