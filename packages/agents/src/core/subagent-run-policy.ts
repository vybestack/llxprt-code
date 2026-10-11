/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Profile } from '@vybestack/llxprt-code-settings';
import type { SubagentRunPolicy } from '@vybestack/llxprt-code-core/session/session-settings-policies.js';
import {
  type RunConfig,
  UNLIMITED_OUTPUT_TOKENS_TOTAL,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { getNumberSetting } from './subagentSettingsAccess.js';

/** Subagent-specific fallback when no valid max-turn setting is materialized. */
const DEFAULT_UNCONFIGURED_MAX_TURNS = 1000;

/**
 * Ceiling on the aggregate output tokens one subagent run may generate.
 *
 * Deriving this purely from `max_turns * modelMaxOutputTokens` reproduces the
 * bound that failed in #3335: the 1000-turn fallback times a 16,384-token model
 * ceiling is 16.4M tokens, and the incident run was still inside that budget at
 * turn 253. The derived value is therefore clamped to this ceiling.
 *
 * 2M output tokens is roughly 4,000 turns of ordinary 500-token responses, or
 * 122 consecutive maximum-length 16,384-token responses. A subagent still
 * generating maximum-length responses after 122 turns is looping, not working.
 * Ordinary runs generate well under 500k, so this leaves at least 4x headroom.
 */
const MAX_OUTPUT_TOKENS_TOTAL_CEILING = 2_000_000;

/** Subagent-specific fallback when no model output ceiling is resolvable. */
const DEFAULT_UNCONFIGURED_MAX_OUTPUT_TOKENS_TOTAL =
  MAX_OUTPUT_TOKENS_TOTAL_CEILING;

export function buildResolvedRunConfig(
  profile: Profile,
  custom: RunConfig | undefined,
  policy: SubagentRunPolicy,
): RunConfig {
  return buildRunConfig(
    profile,
    custom,
    resolveModelMaxOutputTokens(profile),
    policy,
  );
}

function buildRunConfig(
  profile: Profile,
  custom: RunConfig | undefined,
  resolvedModelMaxOutputTokens: number | undefined,
  policy: SubagentRunPolicy,
): RunConfig {
  const profileMaxTime = getNumberSetting(profile.ephemeralSettings, [
    'subagent.max_time_minutes',
    'max_time_minutes',
  ]);

  const runConfig: RunConfig = {
    max_time_minutes:
      custom?.max_time_minutes ?? profileMaxTime ?? Number.POSITIVE_INFINITY,
  };

  const profileMaxTurns = getNumberSetting(profile.ephemeralSettings, [
    'maxTurnsPerPrompt',
  ]);

  const parentMaxTurns = policy.maxTurnsPerPrompt;

  const maxTurns = custom?.max_turns ?? profileMaxTurns ?? parentMaxTurns;

  if (maxTurns === undefined) {
    runConfig.max_turns = DEFAULT_UNCONFIGURED_MAX_TURNS;
  } else if (maxTurns > 0) {
    runConfig.max_turns = Math.floor(maxTurns);
  }

  const profileMaxOutputTokensTotal = getNumberSetting(
    profile.ephemeralSettings,
    ['subagent-max-output-tokens-total'],
  );
  const parentMaxOutputTokensTotal = policy.maxOutputTokensTotal;
  const configuredMaxOutputTokensTotal =
    custom?.max_output_tokens_total ??
    profileMaxOutputTokensTotal ??
    parentMaxOutputTokensTotal;
  // Proportional to the turn budget where the catalog gives us a model
  // ceiling, but never above MAX_OUTPUT_TOKENS_TOTAL_CEILING — see the
  // constant's comment for why the unclamped product is not a real bound.
  const defaultMaxOutputTokensTotal =
    runConfig.max_turns !== undefined &&
    resolvedModelMaxOutputTokens !== undefined
      ? Math.min(
          runConfig.max_turns * resolvedModelMaxOutputTokens,
          MAX_OUTPUT_TOKENS_TOTAL_CEILING,
        )
      : DEFAULT_UNCONFIGURED_MAX_OUTPUT_TOKENS_TOTAL;
  const maxOutputTokensTotal =
    configuredMaxOutputTokensTotal ?? defaultMaxOutputTokensTotal;

  // -1 is the unlimited sentinel and is the only value that omits the budget.
  // Testing `> 0` instead would silently discard a deliberate 0 (stop
  // immediately) and turn it into no budget at all, which is its opposite.
  // checkOutputBudget treats -1 the same way, and the two must agree.
  // A non-finite value must not reach the budget. `checkOutputBudget` tests
  // `total >= budget`, which is false for both Infinity and NaN, so either
  // one silently disables enforcement entirely while looking configured.
  // Falling back to the derived default keeps a bad explicit value from being
  // more permissive than supplying none at all.
  const usableMaxOutputTokensTotal = Number.isFinite(maxOutputTokensTotal)
    ? maxOutputTokensTotal
    : defaultMaxOutputTokensTotal;

  if (usableMaxOutputTokensTotal !== UNLIMITED_OUTPUT_TOKENS_TOTAL) {
    runConfig.max_output_tokens_total = Math.max(
      0,
      Math.floor(usableMaxOutputTokensTotal),
    );
  }

  if (custom?.grace_period_seconds !== undefined) {
    runConfig.grace_period_seconds = custom.grace_period_seconds;
  }

  return runConfig;
}

/**
 * The model's declared per-response output ceiling, read from the profile.
 *
 * Deliberately does not consult the isolated runtime's SettingsService: doing
 * so would force run-config resolution to happen after runtime assembly, and
 * a launch that fails during assembly would then dereference a runtime that
 * does not exist. The profile carries everything needed, and because the
 * derived budget is clamped to MAX_OUTPUT_TOKENS_TOTAL_CEILING anyway, a
 * catalog value would only matter for profiles whose ceiling is small enough
 * to keep the product under the clamp.
 */
function resolveModelMaxOutputTokens(profile: Profile): number | undefined {
  const candidates = [
    getNumberSetting(profile.ephemeralSettings, ['maxOutputTokens']),
    profile.modelParams.max_tokens,
  ];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return undefined;
}
