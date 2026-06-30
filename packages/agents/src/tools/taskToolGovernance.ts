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

const normalizeToolNameForPolicy = (name: string): string =>
  canonicalizeToolName(name);

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

  const allowedByCanonical = new Map<string, string>();
  for (const toolName of allowedRegistryTools) {
    for (const canonical of getToolNameCandidates(toolName)) {
      if (!allowedByCanonical.has(canonical)) {
        allowedByCanonical.set(canonical, toolName);
      }
    }
  }

  const filteredTools = candidateTools.map((name) => {
    if (typeof name !== 'string') {
      return undefined;
    }

    const candidates = getToolNameCandidates(name);
    if (candidates.some((canonical) => excluded.has(canonical))) {
      return undefined;
    }
    if (candidates.some((canonical) => governance.disabled.has(canonical))) {
      return undefined;
    }

    for (const canonical of candidates) {
      const resolved = allowedByCanonical.get(canonical);
      if (resolved && !isToolBlocked(resolved, governance)) {
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
    const canonical = normalizeToolNameForPolicy(tool);
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
 * Normalizes the public `TaskToolParams` (which accepts multiple alias keys)
 * into the canonical `TaskToolInvocationParams`. Trims prompts/tools, dedupes
 * behaviour prompts, and resolves the async flag.
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

  const outputSpec = params.output_spec ?? params.outputSpec ?? undefined;

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
