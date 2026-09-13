/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Enable React's act() environment so component state updates driven through
// the act-wrapped stdin are flushed without warnings.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'bun:test';
import { act } from 'react';
import { KeypressProvider } from '../contexts/KeypressContext.js';
import { ProfileDetailDialog } from './ProfileDetailDialog.js';
import type { Profile } from '@vybestack/llxprt-code-settings';
import { render as renderActWrapped } from '../../test-utils/render.js';

// A lone ESC byte only decodes to an 'escape' keypress after the
// KeypressProvider's escape timeout, so tests drive the synchronous kitty/CSI-u
// keycode instead (same convention as ModelDialog.test.tsx).
const ESCAPE_KEY = '\u001B[27u';

void vi.mock('../hooks/useTerminalSize.js', () => ({
  useTerminalSize: () => ({ columns: 100, rows: 30 }),
}));

function profileDetailFrameOrEmpty(frame: string | undefined): string {
  return frame ?? '';
}

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
    const frame = profileDetailFrameOrEmpty(lastFrame());

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

interface DetailDialogSpies {
  lastFrame: () => string | undefined;
  stdin: { write: (data: string) => void };
  onClose: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
  onLoad: ReturnType<typeof vi.fn>;
  onSetDefault: ReturnType<typeof vi.fn>;
  onEdit: ReturnType<typeof vi.fn>;
}

function standardProfile(): Profile {
  return {
    version: 1,
    provider: 'zai',
    model: 'glm-4.7',
    modelParams: {},
    ephemeralSettings: {},
  };
}

function renderDetailDialogWithSpies(profileName: string): DetailDialogSpies {
  const onClose = vi.fn();
  const onDelete = vi.fn();
  const onLoad = vi.fn();
  const onSetDefault = vi.fn();
  const onEdit = vi.fn();
  const { lastFrame, stdin } = renderActWrapped(
    <KeypressProvider>
      <ProfileDetailDialog
        profileName={profileName}
        profile={standardProfile()}
        onClose={onClose}
        onLoad={onLoad}
        onDelete={onDelete}
        onSetDefault={onSetDefault}
        onEdit={onEdit}
      />
    </KeypressProvider>,
  );
  return { lastFrame, stdin, onClose, onDelete, onLoad, onSetDefault, onEdit };
}

describe('ProfileDetailDialog delete confirmation', () => {
  const PROFILE_NAME = 'glm';

  it("'d' enters the confirm view and 'n' returns to the detail view without deleting", () => {
    const spies = renderDetailDialogWithSpies(PROFILE_NAME);
    expect(spies.lastFrame() ?? '').toContain('Provider:');

    act(() => {
      spies.stdin.write('d');
    });
    const confirmFrame = spies.lastFrame() ?? '';
    expect(confirmFrame).toContain('Delete Profile?');
    expect(confirmFrame).toContain(`"${PROFILE_NAME}"`);

    act(() => {
      spies.stdin.write('n');
    });
    const detailFrame = spies.lastFrame() ?? '';
    // Back on the detail view with all of its content intact.
    expect(detailFrame).not.toContain('Delete Profile?');
    expect(detailFrame).toContain('Provider:');
    expect(detailFrame).toContain('Actions:');
    expect(spies.onDelete).not.toHaveBeenCalled();
    expect(spies.onClose).not.toHaveBeenCalled();
  });

  it("'d' then 'y' deletes the profile exactly once by name", () => {
    const spies = renderDetailDialogWithSpies(PROFILE_NAME);

    act(() => {
      spies.stdin.write('d');
    });
    expect(spies.lastFrame() ?? '').toContain('Delete Profile?');

    act(() => {
      spies.stdin.write('y');
    });

    expect(spies.onDelete).toHaveBeenCalledTimes(1);
    expect(spies.onDelete.mock.calls[0]?.[0]).toBe(PROFILE_NAME);
    expect(spies.onClose).not.toHaveBeenCalled();
  });

  it("'d' then Escape returns to the detail view without deleting", () => {
    const spies = renderDetailDialogWithSpies(PROFILE_NAME);

    act(() => {
      spies.stdin.write('d');
    });
    expect(spies.lastFrame() ?? '').toContain('Delete Profile?');

    act(() => {
      spies.stdin.write(ESCAPE_KEY);
    });

    const detailFrame = spies.lastFrame() ?? '';
    expect(detailFrame).not.toContain('Delete Profile?');
    expect(detailFrame).toContain('Provider:');
    expect(spies.onDelete).not.toHaveBeenCalled();
    expect(spies.onClose).not.toHaveBeenCalled();
  });

  it('Escape from the plain detail view closes without deleting', () => {
    const spies = renderDetailDialogWithSpies(PROFILE_NAME);
    expect(spies.lastFrame() ?? '').toContain('Provider:');

    act(() => {
      spies.stdin.write(ESCAPE_KEY);
    });

    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(spies.onDelete).not.toHaveBeenCalled();
  });
});
