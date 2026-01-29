/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders } from '../../test-utils/render.js';
import { act } from 'react';
import { MultiProviderPrivacyNotice } from './MultiProviderPrivacyNotice.js';

describe('MultiProviderPrivacyNotice', () => {
  const mockOnExit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = (providerName: string) =>
    renderWithProviders(
      <MultiProviderPrivacyNotice
        providerName={providerName}
        onExit={mockOnExit}
      />,
    );

  describe('display', () => {
    it('should display LLxprt Code privacy statement', () => {
      const { lastFrame } = renderComponent('openai');

      expect(lastFrame()).toContain('LLxprt Code Privacy Notice');
      expect(lastFrame()).toContain('does NOT collect any telemetry');
    });

    it('should display the active provider name', () => {
      const { lastFrame } = renderComponent('openai');

      expect(lastFrame()).toContain('OpenAI');
    });

    it('should show provider-specific links for OpenAI', () => {
      const { lastFrame } = renderComponent('openai');

      expect(lastFrame()).toContain('openai.com');
    });

    it('should show provider-specific links for Anthropic', () => {
      const { lastFrame } = renderComponent('anthropic');

      expect(lastFrame()).toContain('anthropic.com');
    });

    it('should show provider-specific links for Fireworks', () => {
      const { lastFrame } = renderComponent('fireworks');

      expect(lastFrame()).toContain('fireworks.ai');
    });

    it('should show provider-specific links for OpenRouter', () => {
      const { lastFrame } = renderComponent('openrouter');

      expect(lastFrame()).toContain('openrouter.ai');
    });

    it('should show local model message for local providers', () => {
      const { lastFrame } = renderComponent('local');

      expect(lastFrame()).toContain('No data leaves your machine');
    });

    it('should show generic message for unknown providers', () => {
      const { lastFrame } = renderComponent('unknown-provider');

      // Provider name is capitalized in display
      expect(lastFrame()).toContain('Unknown-provider');
      expect(lastFrame()).toContain('privacy policy');
    });

    it('should display escape instruction', () => {
      const { lastFrame } = renderComponent('openai');

      expect(lastFrame()).toContain('Press Esc to exit');
    });
  });

  describe('keyboard interaction', () => {
    it('should call onExit when Escape is pressed', () => {
      const { stdin } = renderComponent('openai');

      act(() => {
        // Kitty protocol escape key sequence
        stdin.write('\u001b[27u');
      });

      expect(mockOnExit).toHaveBeenCalledTimes(1);
    });

    it('should NOT call onExit on other keys', () => {
      const { stdin } = renderComponent('openai');

      act(() => {
        stdin.write('a');
      });
      act(() => {
        stdin.write(' ');
      });
      act(() => {
        stdin.write('\r');
      });

      expect(mockOnExit).not.toHaveBeenCalled();
    });
  });

  describe('provider name formatting', () => {
    it('should capitalize provider names properly', () => {
      const testCases = [
        { input: 'openai', expected: 'OpenAI' },
        { input: 'anthropic', expected: 'Anthropic' },
        { input: 'fireworks', expected: 'Fireworks' },
        { input: 'openrouter', expected: 'OpenRouter' },
      ];

      for (const { input, expected } of testCases) {
        const { lastFrame } = renderComponent(input);
        expect(lastFrame()).toContain(expected);
      }
    });
  });

  describe('local model aliases', () => {
    it('should recognize lm-studio as local', () => {
      const { lastFrame } = renderComponent('lm-studio');

      expect(lastFrame()).toContain('No data leaves your machine');
    });

    it('should recognize ollama as local', () => {
      const { lastFrame } = renderComponent('ollama');

      expect(lastFrame()).toContain('No data leaves your machine');
    });
  });
});
