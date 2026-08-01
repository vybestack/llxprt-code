/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import React from 'react';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import {
  RenderInlineInternal,
  getPlainTextLength,
} from './InlineMarkdownRenderer.js';

type ElementProps = {
  readonly children?: React.ReactNode;
  readonly color?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strikethrough?: boolean;
  readonly wrap?: string;
};

type RenderInlineTestProps = Parameters<typeof RenderInlineInternal>[0];
// Invoke the pure internal component directly: the CLI test setup virtually
// mocks Ink components, so ink-testing-library would fail before exercising the
// renderer's tokenization behavior.

function renderInlineNode(
  props: RenderInlineTestProps,
): React.ReactElement<ElementProps> {
  const node = RenderInlineInternal(props);
  if (!React.isValidElement<ElementProps>(node)) {
    throw new Error('RenderInlineInternal did not return a React element');
  }
  return node;
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

function collectElementProps(node: React.ReactNode): ElementProps[] {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return [];
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return [];
  }
  if (Array.isArray(node)) {
    return node.flatMap(collectElementProps);
  }
  if (React.isValidElement<ElementProps>(node)) {
    return [node.props, ...collectElementProps(node.props.children)];
  }
  return [];
}

const OSC8_PREFIX = '\x1b]8;;';

describe('RenderInline', () => {
  it('forwards presentation props to its top-level Text node', () => {
    const node = renderInlineNode({
      text: 'styled',
      defaultColor: 'cyan',
      bold: true,
      italic: true,
      wrap: 'wrap',
    });

    expect(node.props.color).toBe('cyan');
    expect(node.props.bold).toBe(true);
    expect(node.props.italic).toBe(true);
    expect(node.props.wrap).toBe('wrap');
    expect(flattenText(node)).toBe('styled');
  });

  it('renders supported inline markdown tokens without marker text', () => {
    const node = renderInlineNode({
      text: 'plain **bold** *italic* _under_ ~~strike~~ `code` <u>line</u>',
    });

    expect(flattenText(node)).toBe('plain bold italic under strike code line');
    const props = collectElementProps(node);
    expect(props.some((prop) => prop.bold === true)).toBe(true);
    expect(props.some((prop) => prop.italic === true)).toBe(true);
    expect(props.some((prop) => prop.strikethrough === true)).toBe(true);
    expect(props.some((prop) => prop.underline === true)).toBe(true);
  });

  it('renders markdown links with visible targets and keeps bare URLs visible', () => {
    const node = renderInlineNode({
      text: 'See [docs](https://example.test/docs) and https://example.test/raw',
    });

    const flat = flattenText(node);
    // URLs are now OSC 8 linkified, so assert on the visible substrings rather
    // than an exact string match.
    expect(flat).toContain('docs');
    expect(flat).toContain('https://example.test/docs');
    expect(flat).toContain('https://example.test/raw');
    expect(flat).toContain(OSC8_PREFIX);
  });

  it('gives strong markers precedence over emphasis markers at the same position', () => {
    const node = renderInlineNode({ text: 'Use **strong** then *emphasis*' });

    expect(flattenText(node)).toBe('Use strong then emphasis');
    expect(collectElementProps(node).some((prop) => prop.bold === true)).toBe(
      true,
    );
  });

  it('leaves word-internal emphasis markers as literal text', () => {
    expect(
      flattenText(renderInlineNode({ text: 'keep compile_time unchanged' })),
    ).toBe('keep compile_time unchanged');
  });
});

/**
 * Extract the link target (URL) from the first OSC 8 sequence in `text`.
 * The format is: ESC ]8;;URL BEL ... ESC ]8;; BEL
 */
function extractFirstOsc8Target(text: string): string | null {
  const start = text.indexOf(OSC8_PREFIX);
  if (start === -1) {
    return null;
  }
  const urlStart = start + OSC8_PREFIX.length;
  const belIndex = text.indexOf('\x07', urlStart);
  if (belIndex === -1) {
    return null;
  }
  return text.slice(urlStart, belIndex);
}

/**
 * Extract the visible label of the first OSC 8 sequence in `text`
 * (between the opening BEL and the closing ESC ]8;;).
 */
function extractFirstOsc8Label(text: string): string | null {
  const start = text.indexOf(OSC8_PREFIX);
  if (start === -1) {
    return null;
  }
  const firstBel = text.indexOf('\x07', start + OSC8_PREFIX.length);
  if (firstBel === -1) {
    return null;
  }
  const closeStart = text.indexOf(OSC8_PREFIX, firstBel + 1);
  if (closeStart === -1) {
    return null;
  }
  return text.slice(firstBel + 1, closeStart);
}

describe('RenderInline URL linkification', () => {
  it('renders a bare http URL as an OSC 8 hyperlink whose target and label are the URL (AC-1)', () => {
    const url = 'https://example.com/docs';
    const node = renderInlineNode({ text: `See ${url} for details.` });

    const flat = flattenText(node);
    expect(flat).toContain(OSC8_PREFIX);
    expect(extractFirstOsc8Target(flat)).toBe(url);
    expect(extractFirstOsc8Label(flat)).toBe(url);
  });

  it('renders a bare http URL (non-https) as an OSC 8 hyperlink (AC-1)', () => {
    const url = 'http://example.com/page';
    const node = renderInlineNode({ text: `Visit ${url} now.` });

    const flat = flattenText(node);
    expect(flat).toContain(OSC8_PREFIX);
    expect(extractFirstOsc8Target(flat)).toBe(url);
    expect(extractFirstOsc8Label(flat)).toBe(url);
  });

  it('excludes trailing punctuation from a bare URL link target but keeps it visible (AC-4)', () => {
    const url = 'https://example.com/docs';
    const node = renderInlineNode({ text: `See ${url}.` });

    const flat = flattenText(node);
    expect(flat).toContain(OSC8_PREFIX);
    // The link target must NOT contain the trailing period
    expect(extractFirstOsc8Target(flat)).toBe(url);
    // The period must remain visible outside the closing OSC 8 sequence
    expect(flat.endsWith(`${OSC8_PREFIX}\x07.`)).toBe(true);
  });

  it('excludes trailing comma from a bare URL link target (AC-4)', () => {
    const url = 'https://example.com/docs';
    const node = renderInlineNode({ text: `See ${url}, then.` });

    const flat = flattenText(node);
    expect(extractFirstOsc8Target(flat)).toBe(url);
    // The comma must sit after the closing sequence, not inside the label
    expect(flat).toContain(`${OSC8_PREFIX}\x07,`);
  });

  it('excludes trailing semicolon, colon, exclamation, and question mark from a bare URL (AC-4)', () => {
    const url = 'https://example.com/docs';
    for (const punct of [';', ':', '!', '?'] as const) {
      const node = renderInlineNode({ text: `${url}${punct}` });
      const flat = flattenText(node);
      expect(extractFirstOsc8Target(flat)).toBe(url);
      // The punctuation must remain visible outside the closing sequence
      expect(flat.endsWith(`${OSC8_PREFIX}\x07${punct}`)).toBe(true);
    }
  });

  it('keeps a trailing ) when the URL contains a ( so disambiguation URLs stay intact (AC-4)', () => {
    const url = 'https://en.wikipedia.org/wiki/Foo_(disambiguation)';
    const node = renderInlineNode({ text: `See ${url}.` });

    const flat = flattenText(node);
    expect(extractFirstOsc8Target(flat)).toBe(url);
  });

  it('strips a trailing ) when the URL has no matching ( (AC-4)', () => {
    const url = 'https://example.com/docs';
    const node = renderInlineNode({ text: `(${url}).` });

    const flat = flattenText(node);
    expect(extractFirstOsc8Target(flat)).toBe(url);
    // The wrapping parentheses and the period stay visible, with the ')' and
    // '.' after the closing sequence rather than inside the link.
    expect(flat.startsWith('(')).toBe(true);
    expect(flat.endsWith(`${OSC8_PREFIX}\x07).`)).toBe(true);
  });

  it('renders a markdown [label](url) link with the label as an OSC 8 hyperlink and keeps the visible (url) fallback as a link (AC-2)', () => {
    const url = 'https://example.com/docs';
    const node = renderInlineNode({
      text: `See [documentation](${url}).`,
    });

    const flat = flattenText(node);
    expect(extractFirstOsc8Target(flat)).toBe(url);
    // Both the label and the visible (url) fallback sit inside the hyperlink,
    // so the target is reachable in terminals without OSC 8 support too.
    expect(extractFirstOsc8Label(flat)).toBe(`documentation (${url})`);
  });

  it('does not linkify a markdown link with a javascript: scheme (AC-3)', () => {
    const node = renderInlineNode({
      text: 'See [xss](javascript:alert(1)).',
    });

    const flat = flattenText(node);
    expect(flat).not.toContain(OSC8_PREFIX);
    // Refusing to linkify must not censor the text: label and target both stay
    expect(flat).toBe('See xss (javascript:alert(1)).');
  });

  it('keeps trailing punctuation out of the link colour when the URL cannot be linkified (AC-3)', () => {
    // A bare http token that the URL parser rejects: no OSC 8 escape is
    // emitted, but the URL and the trailing period stay distinctly coloured
    // exactly as they are for a URL that can be linkified.
    const node = renderInlineNode({ text: 'See http://[bad. now' });

    const flat = flattenText(node);
    expect(flat).not.toContain(OSC8_PREFIX);
    expect(flat).toContain('http://[bad. now');

    // The URL and its trailing period occupy separate nodes, exactly as they
    // do when the URL can be linkified, so they can be styled independently.
    const rendered = collectElementProps(node).map((props) =>
      flattenText(props.children),
    );
    expect(rendered).toContain('http://[bad');
    expect(rendered).toContain('.');
  });

  it('does not linkify a bare javascript: URL (AC-3)', () => {
    const node = renderInlineNode({
      text: 'javascript:alert(1)',
    });

    const flat = flattenText(node);
    expect(flat).not.toContain(OSC8_PREFIX);
    expect(flat).toBe('javascript:alert(1)');
  });

  it('strips both a trailing period and the parenthesis wrapping a bare URL (AC-4)', () => {
    const url = 'https://example.com/docs';
    const node = renderInlineNode({ text: `(${url}.)` });

    const flat = flattenText(node);
    expect(extractFirstOsc8Target(flat)).toBe(url);
    expect(flat.startsWith('(')).toBe(true);
    expect(flat.endsWith(`${OSC8_PREFIX}\x07.)`)).toBe(true);
  });

  it('does not linkify a markdown link whose URL has an unbalanced ( (AC-2)', () => {
    // A URL with more '(' than ')' cannot be the complete target the author
    // wrote, so linking it would navigate somewhere they did not write. The
    // markdown-link tokenizer produces this shape when the URL itself
    // contains parentheses.
    const node = renderInlineNode({
      text: 'See [wiki](https://en.wikipedia.org/wiki/Foo_(bar)) now.',
    });

    // Asserted exactly, so the test distinguishes the truncated target from
    // the complete one rather than matching a common prefix.
    expect(flattenText(node)).toBe(
      'See wiki (https://en.wikipedia.org/wiki/Foo_(bar)) now.',
    );
  });

  it('does not linkify a URL inside an inline code span (AC-3)', () => {
    const node = renderInlineNode({
      text: 'Run `curl https://example.com/api` to check.',
    });

    const flat = flattenText(node);
    expect(flat).not.toContain(OSC8_PREFIX);
    expect(flat).toContain('curl https://example.com/api');
  });

  it('never prints raw control characters from a URL it refused to linkify (AC-3)', () => {
    // The bare-URL pattern is \S+, which matches control bytes, so an escape
    // sequence can ride inside a URL token. It must not reach the terminal.
    const node = renderInlineNode({
      text: 'See https://evil.test/\u001b[2J\u0007x now',
    });

    const flat = flattenText(node);
    expect(flat).not.toContain(OSC8_PREFIX);
    expect(flat).not.toContain('\u001b');
    expect(flat).not.toContain('\u0007');
    expect(flat).toContain('https://evil.test/[2Jx');
  });

  it('rejects dangerous schemes regardless of letter case (AC-3)', () => {
    for (const scheme of [
      'JavaScript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'DaTa:text/html,<script>alert(1)</script>',
      'FILE:///etc/passwd',
    ]) {
      const node = renderInlineNode({ text: `See [x](${scheme}).` });
      const flat = flattenText(node);
      expect(flat).not.toContain(OSC8_PREFIX);
      // The label and the rejected target both remain visible
      expect(flat).toBe(`See x (${scheme}).`);
    }
  });
});

describe('RenderInline file path links', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inline-fp-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  function createTempFile(relativePath: string): string {
    const fullPath = path.join(tempDir, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, 'content');
    return fullPath;
  }

  it('renders a relative file path as an OSC 8 link when it exists in a workspace directory', () => {
    createTempFile('src/utils.ts');
    const node = renderInlineNode({
      text: 'Edit src/utils.ts to fix the bug.',
      workspaceDirectories: [tempDir],
    });

    const flat = flattenText(node);
    expect(flat).toContain(OSC8_PREFIX);
    expect(flat).toContain('src/utils.ts');
  });

  it('does not link path-like tokens when workspaceDirectories is not provided', () => {
    createTempFile('src/utils.ts');
    const node = renderInlineNode({
      text: 'Edit src/utils.ts to fix the bug.',
    });

    const flat = flattenText(node);
    expect(flat).not.toContain(OSC8_PREFIX);
    expect(flat).toContain('src/utils.ts');
  });

  it('does not link a file path inside inline code (backticks)', () => {
    createTempFile('src/utils.ts');
    const node = renderInlineNode({
      text: 'Edit `src/utils.ts` to fix the bug.',
      workspaceDirectories: [tempDir],
    });

    const flat = flattenText(node);
    expect(flat).not.toContain(OSC8_PREFIX);
    expect(flat).toContain('src/utils.ts');
  });

  it('renders an absolute path that exists as a link', () => {
    const abs = createTempFile('config.json');
    const node = renderInlineNode({
      text: `See ${abs} for settings.`,
      workspaceDirectories: [tempDir],
    });

    const flat = flattenText(node);
    expect(flat).toContain(OSC8_PREFIX);
    expect(flat).toContain(abs);
  });

  it('renders an absolute path that does not exist as plain text', () => {
    const node = renderInlineNode({
      text: 'See /nonexistent/absolute/12345-file.txt for nothing.',
      workspaceDirectories: [tempDir],
    });

    const flat = flattenText(node);
    expect(flat).not.toContain(OSC8_PREFIX);
    expect(flat).toContain('/nonexistent/absolute/12345-file.txt');
  });

  it('renders an absolute path that exists as a link even without workspaceDirectories', () => {
    const abs = createTempFile('config.json');
    const node = renderInlineNode({
      text: `See ${abs} for settings.`,
    });

    const flat = flattenText(node);
    expect(flat).toContain(OSC8_PREFIX);
    expect(flat).toContain(abs);
  });

  it('links a relative path with trailing punctuation when the file exists', () => {
    createTempFile('src/utils.ts');
    const node = renderInlineNode({
      text: 'Edit src/utils.ts. to fix the bug.',
      workspaceDirectories: [tempDir],
    });

    const flat = flattenText(node);
    expect(flat).toContain(OSC8_PREFIX);
    // The trailing period must be stripped from the resolved path used in the
    // OSC 8 link URI. Assert the link region ends with the file and NOT the
    // trailing period.
    const linkUri = flat.slice(flat.indexOf(OSC8_PREFIX));
    expect(linkUri).toContain('src/utils.ts');
    expect(linkUri).not.toContain('src/utils.ts.');
  });
});

describe('getPlainTextLength', () => {
  it.each([
    ['**Primary Go', 12],
    ['*Primary Go', 11],
    ['**Primary Go**', 10],
    ['*Primary Go*', 10],
    ['**', 2],
    ['*', 1],
    ['compile-time**', 14],
  ])(
    'should measure markdown text length correctly for "%s"',
    (input, expected) => {
      expect(getPlainTextLength(input)).toBe(expected);
    },
  );
});
