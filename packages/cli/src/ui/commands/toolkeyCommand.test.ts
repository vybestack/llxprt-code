/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260206-TOOLKEY.P07
 * Behavioral tests for the /toolkey command.
 * Tests assert on MessageActionReturn content (the actual message strings),
 * not on internal mock call patterns.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toolkeyCommand } from './toolkeyCommand.js';
import { createCompletionHandler } from './schema/index.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { CommandContext, MessageActionReturn } from './types.js';

// ─── In-memory store for mock ToolKeyStorage ─────────────────────────────────

const mockKeyStore = new Map<string, string>();

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...original,
    ToolKeyStorage: class MockToolKeyStorage {
      async saveKey(toolName: string, key: string): Promise<void> {
        mockKeyStore.set(toolName, key);
      }
      async getKey(toolName: string): Promise<string | null> {
        return mockKeyStore.get(toolName) ?? null;
      }
      async deleteKey(toolName: string): Promise<void> {
        mockKeyStore.delete(toolName);
      }
      async hasKey(toolName: string): Promise<boolean> {
        return mockKeyStore.has(toolName);
      }
    },
  };
});

describe('toolkeyCommand', () => {
  let context: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockKeyStore.clear();
    context = createMockCommandContext();
  });

  describe('command metadata', () => {
    /** @plan PLAN-20260206-TOOLKEY.P07 */
    it('has correct name, description, and kind', () => {
      expect(toolkeyCommand.name).toBe('toolkey');
      expect(toolkeyCommand.description).toBe(
        'set, show, or clear API key for a built-in tool',
      );
      expect(toolkeyCommand.kind).toBe('built-in');
    });

    it('defines schema for autocomplete and argument hints', () => {
      expect(toolkeyCommand.schema).toBeDefined();
      expect(Array.isArray(toolkeyCommand.schema)).toBe(true);
    });
  });

  describe('schema completion', () => {
    it('suggests tool names for first argument with descriptions', async () => {
      const schema = toolkeyCommand.schema;
      if (!schema) {
        throw new Error('toolkey schema missing');
      }

      const handler = createCompletionHandler(schema);
      const result = await handler(
        context,
        {
          args: 'ex',
          completedArgs: [],
          partialArg: 'ex',
          commandPathLength: 1,
        },
        '/toolkey ex',
      );

      expect(result.suggestions).toEqual(
        expect.arrayContaining([expect.objectContaining({ value: 'exa' })]),
      );
      expect(result.hint).toBe('Select built-in tool');
    });

    it('suggests none and shows key hint after selecting tool', async () => {
      const schema = toolkeyCommand.schema;
      if (!schema) {
        throw new Error('toolkey schema missing');
      }

      const handler = createCompletionHandler(schema);
      const result = await handler(
        context,
        {
          args: 'exa ',
          completedArgs: ['exa'],
          partialArg: '',
          commandPathLength: 1,
        },
        '/toolkey exa ',
      );

      expect(result.suggestions).toEqual(
        expect.arrayContaining([expect.objectContaining({ value: 'none' })]),
      );
      expect(result.hint).toBe(
        'Paste API key for the tool, or use none to clear stored key',
      );
    });
  });

  describe('set key', () => {
    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-002.1 */
    it('stores key and returns success message with masked key', async () => {
      const result = (await toolkeyCommand.action!(
        context,
        'exa sk-test-key-12345678',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain("API key set for 'Exa Search'");
      expect(result.content).toContain('sk');
      expect(result.content).toContain('78');
      expect(result.content).not.toContain('test-key-12345678');
    });

    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-002.1, REQ-006.4 */
    it('returns success message showing masked short key', async () => {
      const result = (await toolkeyCommand.action!(
        context,
        'exa abcd1234',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain("API key set for 'Exa Search'");
      // 8 chars => fully masked per REQ-006.4
      expect(result.content).toContain('********');
    });
  });

  describe('show status', () => {
    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-002.2 */
    it('shows masked key when key is configured', async () => {
      // Pre-populate the store so the command finds an existing key
      mockKeyStore.set('exa', 'sk-test-key-12345678');

      const result = (await toolkeyCommand.action!(
        context,
        'exa',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain('Exa Search API key:');
      expect(result.content).toContain('sk');
      expect(result.content).toContain('78');
      expect(result.content).not.toContain('test-key-12345678');
    });

    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-002.2 */
    it('shows "not configured" when no key stored', async () => {
      const result = (await toolkeyCommand.action!(
        context,
        'exa',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain(
        "No API key configured for 'Exa Search'",
      );
    });
  });

  describe('clear key', () => {
    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-002.3 */
    it('clears key and returns confirmation', async () => {
      mockKeyStore.set('exa', 'some-key');

      const result = (await toolkeyCommand.action!(
        context,
        'exa none',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain("Cleared API key for 'Exa Search'");
    });

    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-002.3 */
    it('clears with case-insensitive "None"', async () => {
      mockKeyStore.set('exa', 'some-key');

      const result = (await toolkeyCommand.action!(
        context,
        'exa None',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain("Cleared API key for 'Exa Search'");
    });

    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-002.3 */
    it('clears with uppercase "NONE"', async () => {
      mockKeyStore.set('exa', 'some-key');

      const result = (await toolkeyCommand.action!(
        context,
        'exa NONE',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain("Cleared API key for 'Exa Search'");
    });
  });

  describe('unknown tool', () => {
    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-002.4 */
    it('returns error for unknown tool name', async () => {
      const result = (await toolkeyCommand.action!(
        context,
        'unknown_tool',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('error');
      expect(result.content).toContain("Unknown tool 'unknown_tool'");
    });

    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-002.4 */
    it('error message lists supported tools', async () => {
      const result = (await toolkeyCommand.action!(
        context,
        'foobar',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('error');
      expect(result.content).toContain('Supported tools:');
      expect(result.content).toContain('exa');
    });
  });

  describe('no arguments', () => {
    /** @plan PLAN-20260206-TOOLKEY.P07 */
    it('shows usage when no args provided', async () => {
      const result = (await toolkeyCommand.action!(
        context,
        '',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain('Usage:');
      expect(result.content).toContain('/toolkey');
      expect(result.content).toContain('Supported tools:');
    });

    /** @plan PLAN-20260206-TOOLKEY.P07 */
    it('shows usage when args is only whitespace', async () => {
      const result = (await toolkeyCommand.action!(
        context,
        '   ',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain('Usage:');
    });
  });
});
