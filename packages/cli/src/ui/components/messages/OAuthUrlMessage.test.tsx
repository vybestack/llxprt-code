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

const OSC8_CLOSE = `${OSC8_PREFIX}\x07`;
const BEL = '\x07';

interface Osc8Link {
  target: string;
  label: string;
}

/**
 * Parse the next complete OSC 8 hyperlink (`ESC]8;;URL BEL LABEL ESC]8;;BEL`)
 * at or after `cursor`, returning the link and the offset just past it.
 */
function parseOsc8LinkAt(
  text: string,
  cursor: number,
): { link: Osc8Link; nextCursor: number } | null {
  const openStart = text.indexOf(OSC8_PREFIX, cursor);
  if (openStart === -1) {
    return null;
  }
  const targetStart = openStart + OSC8_PREFIX.length;
  const targetEnd = text.indexOf(BEL, targetStart);
  if (targetEnd === -1) {
    return null;
  }
  const closeStart = text.indexOf(OSC8_CLOSE, targetEnd + 1);
  if (closeStart === -1) {
    return null;
  }
  return {
    link: {
      target: text.slice(targetStart, targetEnd),
      label: text.slice(targetEnd + 1, closeStart),
    },
    nextCursor: closeStart + OSC8_CLOSE.length,
  };
}

/**
 * Scan `text` for complete OSC 8 hyperlinks. The scan must skip past each
 * closing sequence explicitly: the closing sequence also begins with
 * `OSC8_PREFIX`, so splitting on the prefix would treat the text between two
 * links as a link body.
 */
function scanOsc8Links(text: string): Osc8Link[] {
  const links: Osc8Link[] = [];
  let parsed = parseOsc8LinkAt(text, 0);
  while (parsed !== null) {
    links.push(parsed.link);
    parsed = parseOsc8LinkAt(text, parsed.nextCursor);
  }
  return links;
}

/** Extract every OSC 8 link target from the flattened text. */
function extractOsc8Targets(text: string): string[] {
  return scanOsc8Links(text).map((link) => link.target);
}

/** Extract every visible OSC 8 link label from the flattened text. */
function extractOsc8Labels(text: string): string[] {
  return scanOsc8Links(text).map((link) => link.label);
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
