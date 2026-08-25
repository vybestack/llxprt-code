/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { Profile } from '@vybestack/llxprt-code-settings';
import {
  createOrchestratorForTurns,
  extractRunConfig,
  makeForegroundConfig,
} from './__tests__/subagentOrchestrator-test-helpers.js';

const baseProfile: Profile = {
  version: 1,
  provider: 'gemini',
  model: 'gemini-2.0-pro',
  modelParams: {},
  ephemeralSettings: {},
};

function foregroundWithOutputBudget(value: number | undefined): Config {
  const foreground = makeForegroundConfig();
  return {
    ...foreground,
    getEphemeralSetting: (key: string) =>
      key === 'subagent-max-output-tokens-total' ? value : undefined,
  } as unknown as Config;
}

describe('SubagentOrchestrator aggregate output budget resolution', () => {
  it('applies explicit request, profile, parent, and default precedence in order', async () => {
    const profile: Profile = {
      ...baseProfile,
      modelParams: { max_tokens: 100 },
      ephemeralSettings: {
        maxTurnsPerPrompt: 4,
        'subagent-max-output-tokens-total': 22,
      },
    };
    const { orchestrator, factory } = createOrchestratorForTurns({
      subagentName: 'output-precedence-helper',
      profile,
      foregroundConfig: foregroundWithOutputBudget(33),
    });

    await orchestrator.launch({
      name: 'output-precedence-helper',
      runConfig: {
        max_time_minutes: 5,
        max_output_tokens_total: 11,
      },
    });
    await orchestrator.launch({ name: 'output-precedence-helper' });

    const explicit = extractRunConfig(factory, 0);
    const profileResolved = extractRunConfig(factory, 1);
    expect(explicit.max_output_tokens_total).toBe(11);
    expect(profileResolved.max_output_tokens_total).toBe(22);
  });

  it('uses the parent setting when the request and profile omit the budget', async () => {
    const profile: Profile = {
      ...baseProfile,
      modelParams: { max_tokens: 100 },
      ephemeralSettings: { maxTurnsPerPrompt: 4 },
    };
    const { orchestrator, factory } = createOrchestratorForTurns({
      subagentName: 'parent-output-budget-helper',
      profile,
      foregroundConfig: foregroundWithOutputBudget(33),
    });

    await orchestrator.launch({ name: 'parent-output-budget-helper' });

    expect(extractRunConfig(factory).max_output_tokens_total).toBe(33);
  });

  it('derives the default from max turns and the resolved model output cap', async () => {
    const profile: Profile = {
      ...baseProfile,
      modelParams: { max_tokens: 100 },
      ephemeralSettings: { maxTurnsPerPrompt: 4 },
    };
    const { orchestrator, factory } = createOrchestratorForTurns({
      subagentName: 'derived-output-budget-helper',
      profile,
      foregroundConfig: foregroundWithOutputBudget(undefined),
    });

    await orchestrator.launch({ name: 'derived-output-budget-helper' });

    expect(extractRunConfig(factory).max_output_tokens_total).toBe(400);
  });

  it('falls back to the ceiling when model output metadata is unavailable', async () => {
    const { orchestrator, factory } = createOrchestratorForTurns({
      subagentName: 'flat-output-budget-helper',
      profile: baseProfile,
      foregroundConfig: foregroundWithOutputBudget(undefined),
    });

    await orchestrator.launch({ name: 'flat-output-budget-helper' });

    expect(extractRunConfig(factory).max_output_tokens_total).toBe(2_000_000);
  });

  it('clamps the derived default so the turn budget times the model cap cannot exceed the ceiling', async () => {
    // Reproduces the #3335 incident shape: the 1000-turn fallback times a
    // 16,384-token model ceiling is 16.4M, and the runaway was still inside
    // that budget at turn 253. The clamp is what makes the budget real.
    const profile: Profile = {
      ...baseProfile,
      modelParams: { max_tokens: 16_384 },
      ephemeralSettings: { maxTurnsPerPrompt: 1000 },
    };
    const { orchestrator, factory } = createOrchestratorForTurns({
      subagentName: 'clamped-output-budget-helper',
      profile,
      foregroundConfig: foregroundWithOutputBudget(undefined),
    });

    await orchestrator.launch({ name: 'clamped-output-budget-helper' });

    const resolved = extractRunConfig(factory).max_output_tokens_total;
    expect(resolved).toBe(2_000_000);
    expect(resolved).toBeLessThan(1000 * 16_384);
  });

  it('omits the aggregate budget when -1 is selected at any higher-precedence source', async () => {
    const profile: Profile = {
      ...baseProfile,
      modelParams: { max_tokens: 100 },
      ephemeralSettings: {
        maxTurnsPerPrompt: 4,
        'subagent-max-output-tokens-total': 22,
      },
    };
    const { orchestrator, factory } = createOrchestratorForTurns({
      subagentName: 'unlimited-output-budget-helper',
      profile,
      foregroundConfig: foregroundWithOutputBudget(33),
    });

    await orchestrator.launch({
      name: 'unlimited-output-budget-helper',
      runConfig: {
        max_time_minutes: 5,
        max_output_tokens_total: -1,
      },
    });

    expect(extractRunConfig(factory).max_output_tokens_total).toBeUndefined();
  });
});
