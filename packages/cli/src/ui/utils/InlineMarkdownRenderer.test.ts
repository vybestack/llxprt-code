/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect } from 'vitest';
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
