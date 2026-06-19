/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { KeypressProvider } from '../contexts/KeypressContext.js';
import { ProfileDetailDialog } from './ProfileDetailDialog.js';
import type { Profile } from '@vybestack/llxprt-code-settings';

vi.mock('../hooks/useTerminalSize.js', () => ({
  useTerminalSize: () => ({ columns: 100, rows: 30 }),
}));

function renderDialog(profile: Profile) {
  return render(
    <KeypressProvider>
      <ProfileDetailDialog
        profileName="glm"
        profile={profile}
        onClose={vi.fn()}
        onLoad={vi.fn()}
        onDelete={vi.fn()}
        onSetDefault={vi.fn()}
        onEdit={vi.fn()}
      />
    </KeypressProvider>,
  );
}

describe('ProfileDetailDialog load balancer details', () => {
  it('surfaces aggregate and per-sub-profile context and reasoning settings', () => {
    const profile = {
      version: 1,
      type: 'loadbalancer',
      policy: 'failover',
      profiles: ['zai', 'ollama'],
      provider: '',
      model: '',
      contextLimit: 190000,
      modelParams: {
        topP: 0.8,
      },
      ephemeralSettings: {
        'reasoning.enabled': true,
      },
      loadBalancerProfileDetails: [
        {
          name: 'zai',
          provider: 'openai',
          model: 'glm-4.5',
          contextLimit: 200000,
          reasoningEnabled: true,
          temperature: 0.4,
          maxTokens: 4096,
        },
        {
          name: 'ollama',
          provider: 'ollama',
          model: 'glm-4.5-air',
          contextLimit: 190000,
          reasoningEnabled: false,
        },
      ],
    } as Profile;

    const { lastFrame } = renderDialog(profile);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Context Limit: 190000');
    expect(frame).toContain('Effective Minimum Context: 190000');
    expect(frame).toContain('Reasoning: enabled');
    expect(frame).toContain('- zai');
    expect(frame).toContain('Provider: openai');
    expect(frame).toContain('Model: glm-4.5');
    expect(frame).toContain('Context Limit: 200000');
    expect(frame).toContain('temperature: 0.4');
    expect(frame).toContain('maxTokens: 4096');
    expect(frame).toContain('- ollama');
    expect(frame).toContain('Provider: ollama');
    expect(frame).toContain('Reasoning: disabled');
  });
});
