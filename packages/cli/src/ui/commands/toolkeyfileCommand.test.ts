/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260206-TOOLKEY.P07
 * Behavioral tests for the /toolkeyfile command.
 * Tests assert on MessageActionReturn content (the actual message strings).
 * File validation tests use real temp files for behavioral correctness.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toolkeyfileCommand } from './toolkeyfileCommand.js';
import { createCompletionHandler } from './schema/index.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { CommandContext, MessageActionReturn } from './types.js';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// ─── In-memory store for mock ToolKeyStorage ─────────────────────────────────

const mockKeyfileStore = new Map<string, string>();

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();
  return {
    ...original,
    ToolKeyStorage: class MockToolKeyStorage {
      async setKeyfilePath(toolName: string, filePath: string): Promise<void> {
        mockKeyfileStore.set(toolName, filePath);
      }
      async getKeyfilePath(toolName: string): Promise<string | null> {
        return mockKeyfileStore.get(toolName) ?? null;
      }
      async clearKeyfilePath(toolName: string): Promise<void> {
        mockKeyfileStore.delete(toolName);
      }
    },
  };
});

describe('toolkeyfileCommand', () => {
  let context: CommandContext;
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockKeyfileStore.clear();
    context = createMockCommandContext();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'toolkeyfile-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('command metadata', () => {
    /** @plan PLAN-20260206-TOOLKEY.P07 */
    it('has correct name, description, and kind', () => {
      expect(toolkeyfileCommand.name).toBe('toolkeyfile');
      expect(toolkeyfileCommand.description).toBe(
        'manage API key file for a built-in tool',
      );
      expect(toolkeyfileCommand.kind).toBe('built-in');
    });

    it('defines schema for autocomplete and argument hints', () => {
      expect(toolkeyfileCommand.schema).toBeDefined();
      expect(Array.isArray(toolkeyfileCommand.schema)).toBe(true);
    });
  });

  describe('schema completion', () => {
    it('suggests tool names for first argument with descriptions', async () => {
      const schema = toolkeyfileCommand.schema;
      if (!schema) {
        throw new Error('toolkeyfile schema missing');
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
        '/toolkeyfile ex',
      );

      expect(result.suggestions).toEqual(
        expect.arrayContaining([expect.objectContaining({ value: 'exa' })]),
      );
      expect(result.hint).toBe('Select built-in tool');
    });

    it('suggests none and shows filepath hint after selecting tool', async () => {
      const schema = toolkeyfileCommand.schema;
      if (!schema) {
        throw new Error('toolkeyfile schema missing');
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
        '/toolkeyfile exa ',
      );

      expect(result.suggestions).toEqual(
        expect.arrayContaining([expect.objectContaining({ value: 'none' })]),
      );
      expect(result.hint).toBe(
        'Provide key file path to use, or none to clear keyfile mapping',
      );
    });
  });

  describe('set keyfile', () => {
    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-003.1 */
    it('sets keyfile path and returns success message', async () => {
      const keyfilePath = path.join(tmpDir, 'exa-key.txt');
      await fs.writeFile(keyfilePath, 'sk-some-secret-key\n');

      const result = (await toolkeyfileCommand.action!(
        context,
        `exa ${keyfilePath}`,
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain("Keyfile set for 'Exa Search'");
      expect(result.content).toContain(keyfilePath);
    });

    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-003.1 */
    it('rejects when file does not exist', async () => {
      const missingPath = path.join(tmpDir, 'nonexistent-key.txt');

      const result = (await toolkeyfileCommand.action!(
        context,
        `exa ${missingPath}`,
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('error');
      expect(result.content).toContain('File not found');
      expect(result.content).toContain(missingPath);
    });

    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-003.1 */
    it('rejects when file is empty', async () => {
      const emptyPath = path.join(tmpDir, 'empty-key.txt');
      await fs.writeFile(emptyPath, '');

      const result = (await toolkeyfileCommand.action!(
        context,
        `exa ${emptyPath}`,
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('error');
      expect(result.content).toContain('empty');
      expect(result.content).toContain(emptyPath);
    });

    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-003.1 */
    it('rejects when file contains only whitespace', async () => {
      const wsPath = path.join(tmpDir, 'ws-key.txt');
      await fs.writeFile(wsPath, '   \n  \n  ');

      const result = (await toolkeyfileCommand.action!(
        context,
        `exa ${wsPath}`,
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('error');
      expect(result.content).toContain('empty');
    });
  });

  describe('path resolution', () => {
    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-003.2 */
    it('resolves ~ to home directory', async () => {
      // Create a temp file in home directory for the test
      const homeKeyDir = path.join(os.homedir(), '.toolkeyfile-test-tmp');
      const homeKeyPath = path.join(homeKeyDir, 'exa-key.txt');
      await fs.mkdir(homeKeyDir, { recursive: true });
      await fs.writeFile(homeKeyPath, 'my-secret-key\n');

      try {
        const tildeRelative = path.join(
          '~',
          '.toolkeyfile-test-tmp',
          'exa-key.txt',
        );

        const result = (await toolkeyfileCommand.action!(
          context,
          `exa ${tildeRelative}`,
        )) as MessageActionReturn;

        expect(result.type).toBe('message');
        expect(result.messageType).toBe('info');
        expect(result.content).toContain("Keyfile set for 'Exa Search'");
        // The result should contain the resolved absolute path, not the tilde
        expect(result.content).toContain(os.homedir());
        expect(result.content).not.toContain('~');
      } finally {
        await fs.rm(homeKeyDir, { recursive: true, force: true });
      }
    });
  });

  describe('show current keyfile', () => {
    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-003.3 */
    it('shows keyfile path when configured', async () => {
      mockKeyfileStore.set('exa', '/path/to/my/keyfile.txt');

      const result = (await toolkeyfileCommand.action!(
        context,
        'exa',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain('Exa Search keyfile:');
      expect(result.content).toContain('/path/to/my/keyfile.txt');
    });

    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-003.3 */
    it('shows "no keyfile configured" when not set', async () => {
      const result = (await toolkeyfileCommand.action!(
        context,
        'exa',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain(
        "No keyfile configured for 'Exa Search'",
      );
    });
  });

  describe('clear keyfile', () => {
    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-003.4 */
    it('clears keyfile and returns confirmation', async () => {
      mockKeyfileStore.set('exa', '/path/to/key.txt');

      const result = (await toolkeyfileCommand.action!(
        context,
        'exa none',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain("Cleared keyfile for 'Exa Search'");
    });

    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-003.4 */
    it('clears with case-insensitive "None"', async () => {
      mockKeyfileStore.set('exa', '/path/to/key.txt');

      const result = (await toolkeyfileCommand.action!(
        context,
        'exa None',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain("Cleared keyfile for 'Exa Search'");
    });
  });

  describe('unknown tool', () => {
    /** @plan PLAN-20260206-TOOLKEY.P07 @requirement REQ-002.4 */
    it('returns error for unknown tool name', async () => {
      const result = (await toolkeyfileCommand.action!(
        context,
        'unknown_tool /tmp/key.txt',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('error');
      expect(result.content).toContain("Unknown tool 'unknown_tool'");
      expect(result.content).toContain('Supported tools:');
      expect(result.content).toContain('exa');
    });
  });

  describe('no arguments', () => {
    /** @plan PLAN-20260206-TOOLKEY.P07 */
    it('shows usage when no args provided', async () => {
      const result = (await toolkeyfileCommand.action!(
        context,
        '',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain('Usage:');
      expect(result.content).toContain('/toolkeyfile');
      expect(result.content).toContain('Supported tools:');
    });

    /** @plan PLAN-20260206-TOOLKEY.P07 */
    it('shows usage when args is only whitespace', async () => {
      const result = (await toolkeyfileCommand.action!(
        context,
        '   ',
      )) as MessageActionReturn;

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain('Usage:');
    });
  });
});
