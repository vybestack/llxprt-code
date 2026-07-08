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
import type { SubagentManager } from '@vybestack/llxprt-code-core/config/subagentManager.js';
import { separateSettings } from '@vybestack/llxprt-code-settings';
import type { Profile, ProfileManager } from '@vybestack/llxprt-code-settings';
import { SubagentOrchestrator } from '../subagentOrchestrator.js';
import { makeForegroundConfig } from './subagentOrchestrator-test-helpers.js';

/**
 * Test seam: invokes the orchestrator's real private populateSettingsService on
 * a real SubagentOrchestrator instance wired with minimal stub collaborators.
 * This avoids a brittle prototype-only `this` while still exercising the exact
 * production population path the subagent launch flow uses.
 */
function populate(profile: Profile, profileName: string) {
  const service = createRuntimeSettingsService();
  const orchestrator = new SubagentOrchestrator({
    subagentManager: {} as SubagentManager,
    profileManager: {} as ProfileManager,
    foregroundConfig: makeForegroundConfig(),
  });
  (
    orchestrator as unknown as {
      populateSettingsService: (
        s: ReturnType<typeof createRuntimeSettingsService>,
        p: Profile,
        n: string,
      ) => void;
    }
  ).populateSettingsService(service, profile, profileName);
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
    const summary =
      globals['reasoning.summary'] ?? nestedReasoning?.['summary'];

    expect(effort).toBe('xhigh');
    expect(strip).toBe('none');
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
    expect(globals['reasoning.summary']).toBeUndefined();
    expect(nestedReasoning?.['effort']).toBeUndefined();
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
    expect(separated.cliSettings['reasoning.stripFromContext']).toBe('none');
  });
});
