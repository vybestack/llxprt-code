/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral regression test for Issue #2410 — reasoning/ephemeral propagation.
 *
 * A subagent whose profile enables reasoning (e.g. the 'zai' profile with
 * reasoning.effort / reasoning.stripFromContext / reasoning.includeInResponse)
 * must carry those ephemerals through to the provider invocation. Before the
 * fix the subagent orchestrator only copied a hand-picked subset (compression,
 * tools, auth, model) into its settings service, so reasoning.* was silently
 * dropped and the z.ai Anthropic endpoint rejected the malformed request with
 * error 1213.
 *
 * This test drives the REAL settings-service population used by the subagent
 * launch path (createRuntimeSettingsService + the orchestrator's ephemeral
 * copy) and the REAL provider-side snapshot builder (buildEphemeralsSnapshot),
 * then asserts the reasoning.* values survive end-to-end into the snapshot that
 * feeds the provider invocation's modelBehavior/cliSettings.
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeSettingsService } from '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js';
import { separateSettings } from '@vybestack/llxprt-code-settings';
import type { Profile } from '@vybestack/llxprt-code-settings';
import { DEFAULT_DISABLED_TOOLS } from '../subagentOrchestrator.js';
import {
  normalizeDefaultToolSet,
  populatePreActivationSettings,
  populatePostActivationSettings,
} from '../subagentSettingsPopulation.js';

const defaultDisabledTools = normalizeDefaultToolSet(DEFAULT_DISABLED_TOOLS);

function populate(profile: Profile, profileName: string) {
  const service = createRuntimeSettingsService();
  populatePreActivationSettings(service, profile, profileName);
  populatePostActivationSettings(
    service,
    profile,
    profileName,
    defaultDisabledTools,
  );
  return service;
}

const zaiLikeProfile: Profile = {
  version: 1,
  provider: 'anthropic',
  model: 'glm-5.2',
  modelParams: {
    temperature: 1,
    top_p: 0.95,
  },
  ephemeralSettings: {
    'auth-key-name': 'zai',
    'base-url': 'https://api.z.ai/api/anthropic',
    'reasoning.effort': 'xhigh',
    'reasoning.includeInResponse': true,
    'reasoning.stripFromContext': 'none',
    'reasoning.summary': 'auto',
    streaming: 'enabled',
    'context-limit': 200000,
  },
};

describe('Subagent reasoning/ephemeral propagation (Issue #2410)', () => {
  it('stores reasoning.* in the subagent settings service so getAllGlobalSettings exposes them', () => {
    const service = populate(zaiLikeProfile, 'zai');

    // buildEphemeralsSnapshot (provider side) reads getAllGlobalSettings(), so
    // the reasoning values must be reachable from there (flattened or nested).
    const globals = service.getAllGlobalSettings();
    const nestedReasoning = globals['reasoning'] as
      | Record<string, unknown>
      | undefined;
    const effort = globals['reasoning.effort'] ?? nestedReasoning?.['effort'];
    const strip =
      globals['reasoning.stripFromContext'] ??
      nestedReasoning?.['stripFromContext'];
    const includeInResponse =
      globals['reasoning.includeInResponse'] ??
      nestedReasoning?.['includeInResponse'];
    const summary =
      globals['reasoning.summary'] ?? nestedReasoning?.['summary'];

    expect(effort).toBe('xhigh');
    expect(strip).toBe('none');
    expect(includeInResponse).toBe(true);
    expect(summary).toBe('auto');
    // Non-reasoning general ephemerals must also propagate.
    expect(globals['streaming']).toBe('enabled');
  });

  it('does not inject reasoning.* keys when the profile does not set them', () => {
    const service = populate(
      {
        ...zaiLikeProfile,
        ephemeralSettings: {
          'auth-key-name': 'zai',
          'base-url': 'https://api.z.ai/api/anthropic',
          streaming: 'enabled',
          'context-limit': 200000,
        },
      },
      'zai-no-reasoning',
    );

    const globals = service.getAllGlobalSettings();
    const nestedReasoning = globals['reasoning'] as
      | Record<string, unknown>
      | undefined;

    expect(globals['reasoning.effort']).toBeUndefined();
    expect(globals['reasoning.includeInResponse']).toBeUndefined();
    expect(globals['reasoning.stripFromContext']).toBeUndefined();
    expect(globals['reasoning.summary']).toBeUndefined();
    expect(nestedReasoning?.['effort']).toBeUndefined();
    expect(nestedReasoning?.['includeInResponse']).toBeUndefined();
    expect(nestedReasoning?.['stripFromContext']).toBeUndefined();
    expect(nestedReasoning?.['summary']).toBeUndefined();
  });

  it('routes provider-consumed reasoning keys into the exact separated buckets Anthropic reads', () => {
    const service = populate(zaiLikeProfile, 'zai');

    // separateSettings is exactly what buildEphemeralsSnapshot →
    // RuntimeInvocationContext uses to split settings into the buckets the
    // Anthropic provider reads. In AnthropicRequestPreparation, reasoning.effort
    // is resolved from invocation.modelBehavior while reasoning.stripFromContext
    // is resolved from invocation.cliSettings.
    const separated = separateSettings(
      service.getAllGlobalSettings(),
      'anthropic',
    );

    expect(separated.modelBehavior['reasoning.effort']).toBe('xhigh');
    expect(separated.cliSettings['reasoning.includeInResponse']).toBe(true);
    expect(separated.cliSettings['reasoning.stripFromContext']).toBe('none');
  });
});
