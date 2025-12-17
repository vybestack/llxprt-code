/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { OAuthUrlMessage } from './components/messages/OAuthUrlMessage.js';

describe('OAuthUrlMessage', () => {
  it('renders a copyable URL without OSC-8 artifacts', () => {
    render(
      <OAuthUrlMessage
        text="Please authorize with GitHub to continue"
        url="https://example.com/oauth/authorize?client_id=test123"
      />,
    );

    const output = document.body.textContent ?? '';
    expect(output).toContain(
      'https://example.com/oauth/authorize?client_id=test123',
    );
    expect(output).not.toContain(']8;;');
    expect(output).toContain('/mouse off');
  });
});
