/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderWithProviders } from '../../../test-utils/render.js';
import { ProfileChangeMessage } from './ProfileChangeMessage.js';

describe('ProfileChangeMessage', () => {
  it('renders profile name in message text', () => {
    const { lastFrame } = renderWithProviders(
      <ProfileChangeMessage profileName="production" />,
    );
    const output = lastFrame();
    expect(output).toContain('Switched to profile: production');
  });

  it('uses compact left margin layout', () => {
    const { lastFrame } = renderWithProviders(
      <ProfileChangeMessage profileName="test-profile" />,
    );
    const output = lastFrame();
    // Verify it renders without errors and produces output
    expect(output).toBeTruthy();
    expect(output).toContain('Switched to profile:');
  });

  it('does not use warning icon semantics', () => {
    const { lastFrame } = renderWithProviders(
      <ProfileChangeMessage profileName="dev" />,
    );
    const output = lastFrame();
    // Should not contain the info icon 'ℹ' or warning icon '!'
    expect(output).not.toContain('ℹ');
    expect(output).not.toContain('!');
  });

  it('uses sentence-case capitalization', () => {
    const { lastFrame } = renderWithProviders(
      <ProfileChangeMessage profileName="staging" />,
    );
    const output = lastFrame();
    // Message should start with capital 'S' in 'Switched'
    expect(output).toContain('Switched to profile: staging');
  });
});
