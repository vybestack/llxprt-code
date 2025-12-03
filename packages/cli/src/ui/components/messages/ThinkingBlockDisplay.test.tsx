/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ThinkingBlockDisplay TDD Tests
 *
 * @plan:PLAN-20251202-THINKING-UI.P04
 * @requirement:REQ-THINK-UI-002 - Visual styling
 * @requirement:REQ-THINK-UI-003 - Toggle via setting
 */

import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { ThinkingBlockDisplay } from './ThinkingBlockDisplay.js';
import type { ThinkingBlock } from '@vybestack/llxprt-code-core';

describe('ThinkingBlockDisplay', () => {
  const sampleThinkingBlock: ThinkingBlock = {
    type: 'thinking',
    thought: 'Let me analyze this step by step...',
    sourceField: 'reasoning_content',
  };

  describe('REQ-THINK-UI-002: Visual Styling', () => {
    /**
     * @requirement REQ-THINK-UI-002
     * @scenario Renders thought content
     * @given ThinkingBlock with thought text
     * @when Component renders
     * @then Thought text is visible
     */
    it('should render the thought content', () => {
      const { lastFrame } = render(
        <ThinkingBlockDisplay block={sampleThinkingBlock} />,
      );

      expect(lastFrame()).toContain('Let me analyze this step by step...');
    });

    /**
     * @requirement REQ-THINK-UI-002
     * @scenario Empty thought handling
     * @given ThinkingBlock with empty thought
     * @when Component renders
     * @then Component renders without error
     */
    it('should handle empty thought gracefully', () => {
      const emptyBlock: ThinkingBlock = {
        type: 'thinking',
        thought: '',
      };

      const { lastFrame } = render(<ThinkingBlockDisplay block={emptyBlock} />);

      // Should render without throwing
      expect(lastFrame()).toBeDefined();
    });

    /**
     * @requirement REQ-THINK-UI-002
     * @scenario Multi-line thought
     * @given ThinkingBlock with multi-line thought
     * @when Component renders
     * @then All lines are rendered
     */
    it('should render multi-line thoughts', () => {
      const multiLineBlock: ThinkingBlock = {
        type: 'thinking',
        thought:
          'First step: understand the problem.\nSecond step: break it down.\nThird step: solve each part.',
      };

      const { lastFrame } = render(
        <ThinkingBlockDisplay block={multiLineBlock} />,
      );

      expect(lastFrame()).toContain('First step');
      expect(lastFrame()).toContain('Second step');
      expect(lastFrame()).toContain('Third step');
    });
  });

  describe('REQ-THINK-UI-003: Visibility Toggle', () => {
    /**
     * @requirement REQ-THINK-UI-003
     * @scenario visible=true (default)
     * @given visible prop is true
     * @when Component renders
     * @then Thought content is displayed
     */
    it('should display content when visible=true', () => {
      const { lastFrame } = render(
        <ThinkingBlockDisplay block={sampleThinkingBlock} visible={true} />,
      );

      expect(lastFrame()).toContain('Let me analyze this step by step...');
    });

    /**
     * @requirement REQ-THINK-UI-003
     * @scenario visible=false
     * @given visible prop is false
     * @when Component renders
     * @then Nothing is displayed
     */
    it('should not display content when visible=false', () => {
      const { lastFrame } = render(
        <ThinkingBlockDisplay block={sampleThinkingBlock} visible={false} />,
      );

      expect(lastFrame()).not.toContain('Let me analyze this step by step...');
    });

    /**
     * @requirement REQ-THINK-UI-003
     * @scenario Default visibility
     * @given visible prop not provided
     * @when Component renders
     * @then Defaults to visible (true)
     */
    it('should default to visible when prop not provided', () => {
      const { lastFrame } = render(
        <ThinkingBlockDisplay block={sampleThinkingBlock} />,
      );

      expect(lastFrame()).toContain('Let me analyze this step by step...');
    });
  });

  describe('Edge Cases', () => {
    /**
     * @scenario Long thought content
     * @given Very long thought text
     * @when Component renders
     * @then Content is rendered (no truncation in component)
     */
    it('should handle long thought content', () => {
      const longBlock: ThinkingBlock = {
        type: 'thinking',
        thought: 'A'.repeat(1000),
      };

      const { lastFrame } = render(<ThinkingBlockDisplay block={longBlock} />);

      // Should render without error - checking for some content
      expect(lastFrame()).toBeDefined();
      expect(lastFrame()?.length).toBeGreaterThan(0);
    });

    /**
     * @scenario Special characters in thought
     * @given Thought with markdown/special chars
     * @when Component renders
     * @then Characters are preserved
     */
    it('should preserve special characters', () => {
      const specialBlock: ThinkingBlock = {
        type: 'thinking',
        thought: 'Analysis: **bold** _italic_ `code` <tag>',
      };

      const { lastFrame } = render(
        <ThinkingBlockDisplay block={specialBlock} />,
      );

      expect(lastFrame()).toContain('**bold**');
      expect(lastFrame()).toContain('`code`');
    });
  });
});
