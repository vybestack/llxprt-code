/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OpenAI-compatible reasoning dialect resolution.
 *
 * Rationale: llxprt cannot know an arbitrary OpenAI-compatible endpoint's
 * reasoning dialect. Guessing is exactly what produced Friendli 422
 * ("no such field: 'reasoning'" / "'thinking'") and Crusoe 403
 * ("parameter 'reasoning' is not allowed"). This module maps a known set of
 * hosts to at most ONE reasoning dialect and applies it. Every other host —
 * including canonical `api.openai.com` — emits nothing, so users retain full
 * control through `modelParams` passthrough (`thinking`, `reasoning_effort`,
 * or vendor-native fields such as `parse_reasoning`).
 *
 * Dialect table (issue #2896):
 *   host `openrouter.ai` / `*.openrouter.ai`    -> openrouter
 *   host `z.ai` / `*.z.ai`                      -> thinking
 *   host `bigmodel.cn` / `*.bigmodel.cn`        -> thinking
 *   everything else (incl. api.openai.com)      -> none
 */

/**
 * Every wire field that expresses reasoning intent on an OpenAI-compatible
 * Chat Completions body. When any of these is already present — because the
 * user supplied it through `modelParams` — automatic selection stands down so
 * exactly one representation reaches the provider. `parse_reasoning` is
 * Friendli's native field and belongs here for the same reason (issue #2896).
 */
export const REASONING_WIRE_KEYS: readonly string[] = [
  'reasoning',
  'thinking',
  'reasoning_effort',
  'parse_reasoning',
];

/** True when the body already carries an explicit reasoning representation. */
export function hasExplicitReasoningField(body: object): boolean {
  return REASONING_WIRE_KEYS.some((key) => key in body);
}

export type ReasoningDialect = 'openrouter' | 'thinking' | 'none';

export interface ReasoningSettings {
  enabled?: boolean;
  effort?: string;
}

/**
 * The single reasoning representation to place on the request body.
 * Discriminated on `key` so callers assign a precisely-typed value without
 * casts.
 */
export type AppliedReasoning =
  | { key: 'thinking'; value: { type: 'enabled' | 'disabled' } }
  | { key: 'reasoning'; value: Record<string, unknown> };

/**
 * Resolve the reasoning dialect for a given endpoint base URL.
 *
 * Host matching is robust: parses with `URL`, lowercases the hostname, and
 * compares with exact-or-dot-suffix matching so that
 * `evil-openrouter.ai.attacker.com` does NOT match, but `api.z.ai` does.
 */
export function resolveReasoningDialect(
  baseUrl: string | undefined,
): ReasoningDialect {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
    return 'none';
  }

  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return 'none';
  }

  if (hostname === '') {
    return 'none';
  }

  if (matchesHostSuffix(hostname, 'openrouter.ai')) {
    return 'openrouter';
  }

  if (
    matchesHostSuffix(hostname, 'z.ai') ||
    matchesHostSuffix(hostname, 'bigmodel.cn')
  ) {
    return 'thinking';
  }

  return 'none';
}

/**
 * Apply the resolved dialect to produce at most one reasoning representation.
 * Returns `null` when the dialect is `none` or the settings do not call for
 * emission (e.g. `enabled` is undefined for the `thinking` dialect).
 */
export function applyReasoningDialect(
  dialect: ReasoningDialect,
  settings: ReasoningSettings,
): AppliedReasoning | null {
  switch (dialect) {
    case 'openrouter':
      return applyOpenRouterDialect(settings);
    case 'thinking':
      return applyThinkingDialect(settings);
    case 'none':
    default:
      return null;
  }
}

function applyOpenRouterDialect(
  settings: ReasoningSettings,
): AppliedReasoning | null {
  // An explicit `reasoning.enabled: false` outranks a leftover effort level —
  // otherwise turning reasoning off would still request it.
  if (settings.enabled === false) {
    return { key: 'reasoning', value: { enabled: false } };
  }
  if (hasEffort(settings)) {
    return { key: 'reasoning', value: { effort: settings.effort } };
  }
  if (settings.enabled === true) {
    return { key: 'reasoning', value: { enabled: true } };
  }
  return null;
}

function applyThinkingDialect(
  settings: ReasoningSettings,
): AppliedReasoning | null {
  // Same precedence as the OpenRouter dialect: an explicit off wins, and an
  // effort level on its own still means "think" even though this dialect has
  // no way to express how hard.
  if (settings.enabled === false) {
    return { key: 'thinking', value: { type: 'disabled' } };
  }
  if (settings.enabled === true || hasEffort(settings)) {
    return { key: 'thinking', value: { type: 'enabled' } };
  }
  return null;
}

function hasEffort(settings: ReasoningSettings): boolean {
  return typeof settings.effort === 'string' && settings.effort !== '';
}

/**
 * Exact-or-dot-suffix host match. `hostname` and `suffix` are pre-lowercased.
 * Matches `openrouter.ai` exactly and any `*.openrouter.ai` subdomain, but
 * rejects `evil-openrouter.ai.attacker.com`.
 */
function matchesHostSuffix(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}
