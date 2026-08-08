/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Placement policy is a single owned decision (issue #3136).
 */

import { describe, it, expect } from 'bun:test';
import {
  CONTEXT_PREFIX_BOUNDARY,
  formatContextPrefix,
  resolveSystemPromptPlacement,
} from './systemPromptPlacement.js';
import { AnthropicProvider } from '../anthropic/AnthropicProvider.js';
import type { GenerateChatOptions } from '../IProvider.js';

describe('system prompt placement policy (issue #3136)', () => {
  describe('resolveSystemPromptPlacement', () => {
    it('honors a declared context-prefix capability', () => {
      expect(resolveSystemPromptPlacement('context-prefix')).toBe(
        'context-prefix',
      );
    });

    it('honors a declared system-field capability', () => {
      expect(resolveSystemPromptPlacement('system-field')).toBe('system-field');
    });

    it('defaults to system-field when a provider declares nothing', () => {
      expect(resolveSystemPromptPlacement(undefined)).toBe('system-field');
    });
  });

  describe('formatContextPrefix', () => {
    it('wraps the prompt in system tags followed by the conversation boundary', () => {
      expect(formatContextPrefix('PROMPT')).toBe(
        `<system>\nPROMPT\n</system>\n\n${CONTEXT_PREFIX_BOUNDARY}`,
      );
    });

    it('places the prompt above the boundary so it is never inside history', () => {
      const formatted = formatContextPrefix('PROMPT');
      expect(formatted.indexOf('PROMPT')).toBeLessThan(
        formatted.indexOf(CONTEXT_PREFIX_BOUNDARY),
      );
    });

    it('preserves internal ordering of the assembled prompt verbatim', () => {
      const assembled = [
        'You are LLxprt Code running on darwin with claude-opus-5 via claudecode.',
        '# Core Mandates',
        '--- Core System Memory from: ~/.LLXPRT_SYSTEM ---',
        '--- Context from: global/LLXPRT.md ---',
        '--- Context from: .llxprt/LLXPRT.md ---',
      ].join('\n');

      const formatted = formatContextPrefix(assembled);

      const corePos = formatted.indexOf('# Core Mandates');
      const coreMemoryPos = formatted.indexOf('Core System Memory');
      const globalPos = formatted.indexOf('global/LLXPRT.md');
      const projectPos = formatted.indexOf('.llxprt/LLXPRT.md');

      expect(corePos).toBeLessThan(coreMemoryPos);
      expect(coreMemoryPos).toBeLessThan(globalPos);
      expect(globalPos).toBeLessThan(projectPos);
    });

    it('injects the prompt exactly once', () => {
      const formatted = formatContextPrefix('UNIQUE_PREAMBLE_MARKER');
      expect(formatted.split('UNIQUE_PREAMBLE_MARKER').length - 1).toBe(1);
      expect(formatted.split('<system>').length - 1).toBe(1);
    });
  });

  describe('Anthropic declares its placement capability', () => {
    const provider = new AnthropicProvider(undefined, undefined, undefined);

    const optionsWithToken = (authToken: string): GenerateChatOptions =>
      ({
        resolved: { authToken },
      }) as unknown as GenerateChatOptions;

    it('declares context-prefix under OAuth so the system field stays reserved', () => {
      expect(
        provider.getSystemPromptPlacement(
          optionsWithToken('sk-ant-oat01-example-oauth-token'),
        ),
      ).toBe('context-prefix');
    });

    it('declares system-field for a plain API key', () => {
      expect(
        provider.getSystemPromptPlacement(
          optionsWithToken('sk-ant-api03-example-key'),
        ),
      ).toBe('system-field');
    });
  });
});
