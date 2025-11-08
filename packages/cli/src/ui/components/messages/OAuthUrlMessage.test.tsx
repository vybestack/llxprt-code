/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { OAuthUrlMessage } from './OAuthUrlMessage.js';

describe('<OAuthUrlMessage />', () => {
  it('renders the OAuth URL with provider name', () => {
    const props = {
      text: 'Please authorize with GitHub to continue',
      url: 'https://github.com/login/oauth/authorize?client_id=test123',
    };

    const { lastFrame } = render(<OAuthUrlMessage {...props} />);
    const output = lastFrame();

    expect(output).toContain('[OAUTH]');
    expect(output).toContain('Please authorize with GitHub to continue');
    expect(output).toContain('Click here to authorize with GitHub:');
    expect(output).toContain(
      'URL: https://github.com/login/oauth/authorize?client_id=test123',
    );
  });

  it('renders the OAuth URL without provider name', () => {
    const props = {
      text: 'Please authorize to continue',
      url: 'https://example.com/oauth/authorize',
    };

    const { lastFrame } = render(<OAuthUrlMessage {...props} />);
    const output = lastFrame();

    expect(output).toContain('[OAUTH]');
    expect(output).toContain('Please authorize to continue');
    expect(output).toContain('Click here to authorize with the service:');
    expect(output).toContain('URL: https://example.com/oauth/authorize');
  });

  it('handles complex OAuth URLs correctly', () => {
    const props = {
      text: 'Authorize with Google to access your account',
      url: 'https://accounts.google.com/oauth/authorize?client_id=test123&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&scope=openid%20profile',
    };

    const { lastFrame } = render(<OAuthUrlMessage {...props} />);
    const output = lastFrame();

    expect(output).toContain('[OAUTH]');
    expect(output).toContain('Authorize with Google to access your account');
    expect(output).toContain('Click here to authorize with Google:');
    expect(output).toContain(
      'URL: https://accounts.google.com/oauth/authorize?client_id=test123&redirect_uri=https%3A%2F%2Fexample.com%2Fcallback&scope=openid%20profile',
    );
  });

  it('handles empty text gracefully', () => {
    const props = {
      text: '',
      url: 'https://example.com/oauth/authorize',
    };

    const { lastFrame } = render(<OAuthUrlMessage {...props} />);
    const output = lastFrame();

    expect(output).toContain('[OAUTH]');
    expect(output).toContain('Click here to authorize with the service:');
    expect(output).toContain('URL: https://example.com/oauth/authorize');
  });
});
