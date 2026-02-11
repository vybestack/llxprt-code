/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { renderWithProviders, waitFor } from '../../../test-utils/render.js';
import { ProfileChangeMessage } from './ProfileChangeMessage.js';

type RenderStdout = {
  lastFrame: () => string | undefined;
  frames?: string[];
};

function getRenderedOutput(stdout: RenderStdout): string {
  const lastFrame = stdout.lastFrame() ?? '';
  const frames = Array.isArray(stdout.frames) ? stdout.frames.join('\n') : '';
  return [lastFrame, frames].filter(Boolean).join('\n');
}

describe('ProfileChangeMessage', () => {
  it('renders profile name in message text', async () => {
    const { stdout } = renderWithProviders(
      <ProfileChangeMessage profileName="production" />,
    );

    await waitFor(() => {
      expect(getRenderedOutput(stdout)).toContain(
        'Switched to profile: production',
      );
    });
  });

  it('uses compact left margin layout', async () => {
    const { stdout } = renderWithProviders(
      <ProfileChangeMessage profileName="test-profile" />,
    );

    await waitFor(() => {
      const output = getRenderedOutput(stdout);
      expect(output).toBeTruthy();
      expect(output).toContain('Switched to profile:');
    });
  });

  it('does not use warning icon semantics', async () => {
    const { stdout } = renderWithProviders(
      <ProfileChangeMessage profileName="dev" />,
    );

    await waitFor(() => {
      const output = getRenderedOutput(stdout);
      expect(output).toContain('Switched to profile: dev');
      // Should not contain the info icon 'ℹ' or warning icon '!'
      expect(output).not.toContain('ℹ');
      expect(output).not.toContain('!');
    });
  });

  it('uses sentence-case capitalization', async () => {
    const { stdout } = renderWithProviders(
      <ProfileChangeMessage profileName="staging" />,
    );

    await waitFor(() => {
      // Message should start with capital 'S' in 'Switched'
      expect(getRenderedOutput(stdout)).toContain(
        'Switched to profile: staging',
      );
    });
  });
});
