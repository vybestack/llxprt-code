/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UserMessage } from './UserMessage.js';
import { themeManager } from '../../themes/theme-manager.js';
import { AtomOneDark } from '../../themes/atom-one-dark.js';
import { Text } from 'ink';

type TextNode = {
  color?: string;
  content: string;
};

const collectTextNodes = (
  node: React.ReactNode,
  acc: TextNode[] = [],
): TextNode[] => {
  if (!node) {
    return acc;
  }

  if (React.isValidElement(node)) {
    const { children, color } = node.props as {
      children?: React.ReactNode;
      color?: string;
    };

    const typeDisplayName = (node.type as { displayName?: string }).displayName;
    const textDisplayName = (Text as { displayName?: string }).displayName;
    const isTextElement =
      node.type === Text ||
      (textDisplayName !== undefined && typeDisplayName === textDisplayName);

    if (isTextElement) {
      const content = React.Children.toArray(children)
        .filter((child): child is string => typeof child === 'string')
        .join('');
      acc.push({ color, content });
    }

    React.Children.forEach(children, (child) => collectTextNodes(child, acc));
  }

  return acc;
};

const renderTextNodes = (text: string): TextNode[] => {
  const rendered = UserMessage({ text });
  if (rendered && typeof (rendered as Promise<unknown>).then === 'function') {
    throw new Error('UserMessage should not return a promise');
  }
  return collectTextNodes(rendered as React.ReactNode);
};

describe('<UserMessage /> colors', () => {
  const originalTheme = themeManager.getActiveTheme().name;

  beforeAll(() => {
    const set = themeManager.setActiveTheme(AtomOneDark.name);
    if (!set) {
      throw new Error('Failed to set Atom One theme for tests');
    }
  });

  afterAll(() => {
    themeManager.setActiveTheme(originalTheme);
  });

  it('uses primary text color for regular user messages', () => {
    const textNodes = renderTextNodes('hello world');

    const messageColor = textNodes.find((node) =>
      node.content.includes('hello world'),
    )?.color;
    const prefixColor = textNodes.find((node) =>
      node.content.includes('> '),
    )?.color;

    expect(messageColor).toBe(AtomOneDark.colors.Foreground);
    expect(prefixColor).toBe(AtomOneDark.colors.Foreground);
  });

  it('uses accent color for slash commands', () => {
    const textNodes = renderTextNodes('/about');

    const messageColor = textNodes.find((node) =>
      node.content.includes('/about'),
    )?.color;
    const prefixColor = textNodes.find((node) =>
      node.content.includes('> '),
    )?.color;

    expect(messageColor).toBe(AtomOneDark.colors.AccentPurple);
    expect(prefixColor).toBe(AtomOneDark.colors.AccentPurple);
  });
});
