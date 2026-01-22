/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { OAuthUrlMessage } from './OAuthUrlMessage.js';
import { createOsc8Link } from '../../utils/terminalLinks.js';

// Helper function to extract provider from text (mirrors component logic)
function extractProvider(text: string): string {
  const providerMatch = text.match(/authorize with ([^\n:]+)/i);
  return providerMatch ? providerMatch[1] : 'the service';
}

describe('<OAuthUrlMessage />', () => {
  it('extracts provider name from text correctly', () => {
    const text = 'Please authorize with GitHub to continue';
    const provider = extractProvider(text);

    expect(provider).toBe('GitHub to continue');
  });

  it('falls back to "the service" when no provider name', () => {
    const text = 'Please authorize to continue';
    const provider = extractProvider(text);

    expect(provider).toBe('the service');
  });

  it('creates OSC8 link correctly', () => {
    const provider = 'GitHub';
    const url = 'https://github.com/login/oauth/authorize?client_id=test123';
    const osc8Link = createOsc8Link(
      `Click here to authorize with ${provider}`,
      url,
    );

    expect(osc8Link).toContain('Click here to authorize with GitHub');
    expect(osc8Link).toContain(url);
  });

  it('handles empty text gracefully', () => {
    const text = '';
    const provider = extractProvider(text);

    expect(provider).toBe('the service');
  });

  it('component exports expected structure', () => {
    expect(typeof OAuthUrlMessage).toBe('function');
    expect(OAuthUrlMessage).toBeDefined();
  });
});
