/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { OAuthUrlMessage } from './components/messages/OAuthUrlMessage.js';

describe('OAuthUrlMessage', () => {
  it('renders a clickable label and the URL', () => {
    render(
      <OAuthUrlMessage
        text="Please authorize with GitHub to continue"
        url="https://example.com/oauth/authorize?client_id=test123"
      />,
    );

    const output = document.body.textContent ?? '';
    expect(output).toContain('Click here to authorize with GitHub');
    expect(output).toContain(
      'https://example.com/oauth/authorize?client_id=test123',
    );
    expect(output).toContain('/mouse off');
  });
});
