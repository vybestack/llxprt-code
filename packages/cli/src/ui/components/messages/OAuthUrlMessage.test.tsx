/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import React from 'react';
import { OAuthUrlMessage } from './OAuthUrlMessage.js';

type ElementProps = {
  readonly children?: React.ReactNode;
  readonly color?: string;
  readonly bold?: boolean;
  readonly wrap?: string;
  readonly width?: number;
  readonly flexGrow?: number;
  readonly marginBottom?: number;
  readonly paddingLeft?: number;
};

/**
 * Invoke the component function directly and narrow the result to a React
 * node. The CLI test setup virtually mocks Ink components, so
 * ink-testing-library would produce an Ink error box rather than exercising
 * the component's render logic. Calling the function component directly
 * (rather than React.createElement) executes the render synchronously and
 * returns the fully-resolved element tree.
 */
function renderOAuth(
  props: React.ComponentProps<typeof OAuthUrlMessage>,
): React.ReactNode {
  const result = OAuthUrlMessage(props);
  if (React.isValidElement(result)) {
    return result;
  }
  return null;
}

function flattenText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenText).join('');
  }
  if (React.isValidElement<ElementProps>(node)) {
    return flattenText(node.props.children);
  }
  return '';
}

const OSC8_PREFIX = '\x1b]8;;';

/**
 * Extract every OSC 8 link target from the flattened text. Splits on the
 * opening prefix, then takes the substring up to the BEL in each segment.
 */
function extractOsc8Targets(text: string): string[] {
  const segments = text.split(OSC8_PREFIX);
  // First segment is text before any link; skip it.
  const targets: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    const belIndex = segments[i].indexOf('\x07');
    if (belIndex !== -1) {
      targets.push(segments[i].slice(0, belIndex));
    }
  }
  return targets;
}

/**
 * Extract every visible label from OSC 8 sequences. Each link is:
 * `ESC]8;;URL BELLABEL ESC]8;;BELL`. After splitting on the opening prefix,
 * the segment is `URL BELLABEL ESC]8;;BELL`. The label is between the first
 * BEL and the next prefix occurrence.
 */
function extractOsc8Labels(text: string): string[] {
  const segments = text.split(OSC8_PREFIX);
  const labels: string[] = [];
  for (let i = 1; i < segments.length; i++) {
    const belIndex = segments[i].indexOf('\x07');
    if (belIndex === -1) {
      continue;
    }
    const afterFirstBel = segments[i].slice(belIndex + 1);
    // The label ends where the closing prefix starts (or end of segment)
    const closeStart = afterFirstBel.indexOf(OSC8_PREFIX);
    const label =
      closeStart !== -1 ? afterFirstBel.slice(0, closeStart) : afterFirstBel;
    labels.push(label);
  }
  return labels;
}

const LONG_OAUTH_URL =
  'https://claude.ai/oauth/authorize?' +
  'client_id=54d7a297-b7c2-4f57-9bcl-1234567890abcdef&' +
  'redirect_uri=https%3A%2F%2Flocalhost%3A3000%2Fcallback&' +
  'response_type=code&' +
  'scope=openid%20profile%20email%20offline_access&' +
  'state=abc123def456ghi789jkl012mno345pqr678stu901vwx234yz&' +
  'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&' +
  'code_challenge_method=S256';

describe('<OAuthUrlMessage />', () => {
  it('renders the full authorization URL as the primary OSC 8 link target (AC-5)', () => {
    const element = renderOAuth({
      text: 'Please authorize with Claude to continue',
      url: LONG_OAUTH_URL,
    });
    const flat = flattenText(element);

    expect(LONG_OAUTH_URL.length).toBeGreaterThan(300);
    expect(flat).toContain(OSC8_PREFIX);
    const targets = extractOsc8Targets(flat);
    expect(targets).toContain(LONG_OAUTH_URL);
  });

  it('renders the full authorization URL as the visible label of the primary link (AC-5)', () => {
    const element = renderOAuth({
      text: 'Please authorize with Claude to continue',
      url: LONG_OAUTH_URL,
    });
    const flat = flattenText(element);

    const labels = extractOsc8Labels(flat);
    expect(labels).toContain(LONG_OAUTH_URL);
  });

  it('keeps the [OAUTH] prefix and heading with the provider name (AC-6)', () => {
    const element = renderOAuth({
      text: 'Please authorize with Claude to continue',
      url: LONG_OAUTH_URL,
    });
    const flat = flattenText(element);

    expect(flat).toContain('[OAUTH]');
    expect(flat).toContain('OAuth Authentication Required for Claude');
  });

  it('keeps the supplemental "Click here to authorize" link (AC-6)', () => {
    const element = renderOAuth({
      text: 'Please authorize with GitHub to continue',
      url: 'https://github.com/login/oauth/authorize?client_id=test',
    });
    const flat = flattenText(element);

    expect(flat).toContain('Click here to authorize with GitHub');
    // The supplemental link targets the same URL
    const targets = extractOsc8Targets(flat);
    expect(targets).toContain(
      'https://github.com/login/oauth/authorize?client_id=test',
    );
  });

  it('keeps the mouse/selection tip verbatim (AC-6)', () => {
    const element = renderOAuth({
      text: 'Please authorize with Claude to continue',
      url: LONG_OAUTH_URL,
    });
    const flat = flattenText(element);

    expect(flat).toContain(
      'Tip: when mouse scrolling is enabled, drag to select and it will be',
    );
    expect(flat).toContain('copied to your clipboard');
    expect(flat).toContain('/mouse off');
  });

  it('extracts the provider name from the text using the existing regex (AC-6)', () => {
    const element = renderOAuth({
      text: 'Please authorize with Claude to continue',
      url: 'https://example.com/auth',
    });
    const flat = flattenText(element);

    expect(flat).toContain('OAuth Authentication Required for Claude');
    expect(flat).toContain('Click here to authorize with Claude');
  });

  it('falls back to "the service" when no provider is found (AC-6)', () => {
    const element = renderOAuth({
      text: 'Please authenticate now',
      url: 'https://example.com/auth',
    });
    const flat = flattenText(element);

    expect(flat).toContain('OAuth Authentication Required for the service');
    expect(flat).toContain('Click here to authorize with the service');
  });

  it('renders the URL as plain text when it is not a linkable http URL (AC-5)', () => {
    const element = renderOAuth({
      text: 'Please authorize with Claude to continue',
      url: 'javascript:alert(1)',
    });
    const flat = flattenText(element);

    // The malformed URL must still appear as visible text without crashing
    expect(flat).toContain('javascript:alert(1)');
    // No OSC 8 sequence may target a non-http(s) scheme, including the
    // supplemental "Click here" label.
    expect(flat).not.toContain(OSC8_PREFIX);
    expect(flat).toContain('Click here to authorize with Claude');
  });

  it('keeps the copy guidance above the URL (AC-6)', () => {
    const element = renderOAuth({
      text: 'Please authorize with Claude to continue',
      url: LONG_OAUTH_URL,
    });
    const flat = flattenText(element);

    expect(flat).toContain('Or copy this URL:');
  });

  it('produces BEL-terminated OSC 8 sequences (not ST)', () => {
    const element = renderOAuth({
      text: 'Please authorize with Claude to continue',
      url: LONG_OAUTH_URL,
    });
    const flat = flattenText(element);

    // Every OSC 8 open must be followed by a BEL, and the sequence must not
    // contain ST (ESC backslash) terminators.
    const ST = '\x1b' + '\\';
    expect(flat).not.toContain(ST);
    expect(flat).toContain('\x07');
  });
});
