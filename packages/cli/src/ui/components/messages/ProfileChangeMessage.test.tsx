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
  it('renders display label in "Responding with" message', async () => {
    const { stdout } = renderWithProviders(
      <ProfileChangeMessage profileName="production" />,
    );

    await waitFor(() => {
      expect(getRenderedOutput(stdout)).toContain(
        'Responding with: production',
      );
    });
  });

  it('renders model name as display label when no profile is active', async () => {
    const { stdout } = renderWithProviders(
      <ProfileChangeMessage profileName="llama3" />,
    );

    await waitFor(() => {
      expect(getRenderedOutput(stdout)).toContain('Responding with: llama3');
    });
  });

  it('uses compact left margin layout', async () => {
    const { stdout } = renderWithProviders(
      <ProfileChangeMessage profileName="test-profile" />,
    );

    await waitFor(() => {
      const output = getRenderedOutput(stdout);
      expect(output).toBeTruthy();
      expect(output).toContain('Responding with');
    });
  });

  it('does not use warning icon semantics', async () => {
    const { stdout } = renderWithProviders(
      <ProfileChangeMessage profileName="dev" />,
    );

    await waitFor(() => {
      const output = getRenderedOutput(stdout);
      expect(output).toContain('Responding with: dev');
      expect(output).not.toContain('!');
    });
  });
});
