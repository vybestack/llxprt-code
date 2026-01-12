/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text } from 'ink';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiMessage } from './GeminiMessage.js';
import { StreamingState } from '../../types.js';
import { renderWithProviders } from '../../../test-utils/render.js';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';
import { Colors } from '../../colors.js';

let mockGetEphemeralSetting = vi.fn().mockReturnValue(true);

vi.mock('../../contexts/RuntimeContext.js', () => ({
  useRuntimeApi: () => ({
    getEphemeralSetting: mockGetEphemeralSetting,
  }),
  useRuntimeBridge: () => ({
    runtimeId: 'test',
    metadata: {},
    api: { getEphemeralSetting: mockGetEphemeralSetting },
    runWithScope: <T,>(cb: () => T) => cb(),
    enterScope: () => {},
  }),
  RuntimeContextProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  getRuntimeBridge: () => ({
    runtimeId: 'test',
    metadata: {},
    api: { getEphemeralSetting: mockGetEphemeralSetting },
    runWithScope: <T,>(cb: () => T) => cb(),
    enterScope: () => {},
  }),
  getRuntimeApi: () => ({ getEphemeralSetting: mockGetEphemeralSetting }),
}));

vi.mock('../../utils/MarkdownDisplay.js', () => ({
  MarkdownDisplay: function MockMarkdownDisplay({
    text,
    isPending,
  }: {
    text: string;
    isPending: boolean;
  }) {
    return (
      <Text color={Colors.Foreground}>
        MockMarkdown:{text}
        {isPending ? ':pending' : ':complete'}
      </Text>
    );
  },
}));

vi.mock('./ThinkingBlockDisplay.js', () => ({
  ThinkingBlockDisplay: function MockThinkingBlockDisplay({
    block,
    visible,
  }: {
    block: ThinkingBlock;
    visible: boolean;
  }) {
    if (!visible) return null;
    return <Text color={Colors.Foreground}>MockThinking:{block.thought}</Text>;
  },
}));

describe('<GeminiMessage />', () => {
  const baseProps = {
    text: 'Hello, world!',
    isPending: false,
    terminalWidth: 80,
  };

  beforeEach(() => {
    mockGetEphemeralSetting = vi.fn().mockReturnValue(true);
  });

  describe('model name display', () => {
    it('should render model name when model prop is provided', () => {
      const { lastFrame } = renderWithProviders(
        <GeminiMessage {...baseProps} model="gemini-pro" />,
        {
          uiState: {
            renderMarkdown: true,
            streamingState: StreamingState.Idle,
          },
        },
      );

      expect(lastFrame()).toContain('gemini-pro');
    });

    it('should not render model name when model prop is undefined', () => {
      const { lastFrame } = renderWithProviders(
        <GeminiMessage {...baseProps} model={undefined} />,
        {
          uiState: {
            renderMarkdown: true,
            streamingState: StreamingState.Idle,
          },
        },
      );

      expect(lastFrame()).not.toContain('gemini-pro');
    });
  });

  describe('thinking blocks display', () => {
    const thinkingBlocks: ThinkingBlock[] = [
      {
        type: 'thinking',
        thought: 'First thought',
        sourceField: 'reasoning_content',
      },
    ];

    it('should not render thinking blocks when reasoning.includeInResponse is false', () => {
      mockGetEphemeralSetting.mockReturnValue(false);

      const { lastFrame } = renderWithProviders(
        <GeminiMessage {...baseProps} thinkingBlocks={thinkingBlocks} />,
        {
          uiState: {
            renderMarkdown: true,
            streamingState: StreamingState.Idle,
          },
        },
      );

      expect(lastFrame()).not.toContain('MockThinking:First thought');
    });

    it('should not render thinking blocks when thinkingBlocks is undefined', () => {
      mockGetEphemeralSetting.mockReturnValue(true);

      const { lastFrame } = renderWithProviders(
        <GeminiMessage {...baseProps} thinkingBlocks={undefined} />,
        {
          uiState: {
            renderMarkdown: true,
            streamingState: StreamingState.Idle,
          },
        },
      );

      expect(lastFrame()).not.toContain('MockThinking');
    });
  });
});
