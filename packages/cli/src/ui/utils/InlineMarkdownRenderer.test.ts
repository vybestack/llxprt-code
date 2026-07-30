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

    expect(flattenText(node)).toBe(
      'See docs (https://example.test/docs) and https://example.test/raw',
    );
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
