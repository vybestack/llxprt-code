/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { createRuntimeSettingsService } from '@vybestack/llxprt-code-core/runtime/settingsRuntimeAdapter.js';
import {
  separateSettings,
  type Profile,
} from '@vybestack/llxprt-code-settings';
import { DEFAULT_DISABLED_TOOLS } from '../subagentOrchestrator.js';
import {
  normalizeDefaultToolSet,
  populatePostActivationSettings,
  populatePreActivationSettings,
} from '../subagentSettingsPopulation.js';

const defaultDisabledTools = normalizeDefaultToolSet(DEFAULT_DISABLED_TOOLS);

function classifySubagentProfile(profile: Profile) {
  const service = createRuntimeSettingsService();
  populatePreActivationSettings(service, profile, 'anthropic-subagent');
  populatePostActivationSettings(
    service,
    profile,
    'anthropic-subagent',
    defaultDisabledTools,
  );

  return separateSettings(service.getAllGlobalSettings(), 'anthropic');
}

describe('Anthropic subagent text settings (Issue #1738)', () => {
  it.each([
    {
      name: 'nested',
      ephemeralSettings: { text: { verbosity: 'medium' } },
    },
    {
      name: 'flat',
      ephemeralSettings: { 'text.verbosity': 'medium' },
    },
  ])(
    'classifies $name text verbosity as behavior rather than a request parameter',
    ({ ephemeralSettings }) => {
      const separated = classifySubagentProfile({
        version: 1,
        provider: 'anthropic',
        model: 'claude-fable-5',
        modelParams: {},
        ephemeralSettings,
      });

      expect(separated.modelBehavior['text.verbosity']).toBe('medium');
      expect(separated.modelParams).not.toHaveProperty('text');
      expect(separated.modelParams).not.toHaveProperty('text.verbosity');
    },
  );
});
