/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #4036: the refusal policy settings save into profiles and never reach
 * the provider as model parameters.
 */

import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { runScriptedPrompt, stopReply } from './helpers/refusal-endpoint.js';

// Each case runs a whole agent against a local endpoint; a loaded machine
// needs more than Bun's 5 s default.
setDefaultTimeout(90_000);

const POLICY = {
  'refusal.retries': 4,
  'refusal.backoff-ms': 2000,
  'refusal.rewrite': false,
  'refusal.review-profile': 'sonnet-reviewer',
  'refusal.max-rewrites': 2,
} as const;

type Profile = ReturnType<Agent['captureProfile']>;

describe('refusal settings in profiles (issue #4036)', () => {
  const capture = async (): Promise<{
    profile: Profile | undefined;
    wire: string;
  }> => {
    let profile: Profile | undefined;
    const run = await runScriptedPrompt([stopReply('fine')], ['hello'], {
      settings: POLICY,
      inspect: (agent) => {
        profile = agent.captureProfile();
        return Promise.resolve();
      },
    });
    return { profile, wire: JSON.stringify(run.requests) };
  };

  it('saves all five values into the profile ephemeral settings', async () => {
    const { profile } = await capture();

    expect(profile?.ephemeralSettings).toMatchObject(POLICY);
  });

  it('keeps the values out of the profile model parameters', async () => {
    const { profile } = await capture();

    expect(Object.keys(profile?.modelParams ?? {})).not.toContain(
      'refusal.retries',
    );
    expect(JSON.stringify(profile?.modelParams ?? {})).not.toContain('refusal');
  });

  it('never sends the values to the provider', async () => {
    const { wire } = await capture();

    expect(wire).not.toContain('refusal.');
    expect(wire).not.toContain('sonnet-reviewer');
  });
});
