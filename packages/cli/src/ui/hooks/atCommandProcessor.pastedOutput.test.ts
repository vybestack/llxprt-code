/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  handleAtCommand,
  applyPowerShellAtAlias,
} from './atCommandProcessor.js';
import type { AgentToolHandle } from '@vybestack/llxprt-code-agents';
import * as path from 'path';
import {
  createTestFile,
  setupAtCommandTest,
  teardownAtCommandTest,
  type AtCommandTestSetup,
} from './atCommandProcessor-test-helpers.js';

/**
 * Regression coverage for the paste-induced memory exhaustion: copying an
 * LLxprt pane back into the prompt turned ordinary decoration ("Ctrl+Q",
 * "+------", the "@path/to/file" placeholder hint) into @-path commands. Every
 * unresolved one fell back to a full recursive workspace crawl, and a crawl
 * for a candidate as broad as a single "Q" matches essentially every file in
 * the tree, retaining a stat record for each.
 */
describe('handleAtCommand (pasted terminal output)', () => {
  let setup: AtCommandTestSetup;
  let testRootDir: string;
  let globPatterns: string[];
  let getToolHandle: (name: string) => AgentToolHandle | undefined;

  beforeEach(async () => {
    setup = await setupAtCommandTest();
    testRootDir = setup.testRootDir;
    globPatterns = [];

    // Observe the real glob tool rather than replacing it: the tool still
    // runs, we just record which recursive searches were actually launched.
    getToolHandle = (name: string): AgentToolHandle | undefined => {
      const handle = setup.getToolHandle(name);
      if (handle === undefined || name !== 'glob') return handle;
      return {
        ...handle,
        buildAndExecute: async (params, signal) => {
          const pattern = (params as { pattern?: unknown }).pattern;
          globPatterns.push(String(pattern));
          return handle.buildAndExecute(params, signal);
        },
      };
    };
  });

  afterEach(async () => {
    await teardownAtCommandTest(setup);
  });

  describe('PowerShell "+" alias token rules', () => {
    it.each([
      ['Press Ctrl+Q to quit', 'Press Ctrl+Q to quit'],
      ['+------------------+', '+------------------+'],
      ['1108 +     anisotropy_clamp: 16,', '1108 +     anisotropy_clamp: 16,'],
      ['a+b+c', 'a+b+c'],
      ['2+2 equals 4', '2+2 equals 4'],
    ])('leaves %p unchanged', (input, expected) => {
      expect(applyPowerShellAtAlias(input)).toBe(expected);
    });

    it.each([
      ['+notes.txt', '@notes.txt'],
      ['see +src/main.ts here', 'see @src/main.ts here'],
      ['+./relative.ts', '@./relative.ts'],
      ['+~/home.ts', '@~/home.ts'],
      ['+a.txt and +b.txt', '@a.txt and @b.txt'],
    ])('still aliases %p at a token start', (input, expected) => {
      expect(applyPowerShellAtAlias(input)).toBe(expected);
    });
  });

  it('does not launch a recursive search for unspecific @ tokens', async () => {
    await createTestFile(path.join(testRootDir, 'quickstart.md'), 'hello');

    await handleAtCommand({
      query: 'Look at @Q and @-- and @.. for details',
      config: setup.mockConfig,
      addItem: setup.mockAddItem,
      onDebugMessage: setup.mockOnDebugMessage,
      messageId: 900,
      signal: setup.abortController.signal,
      getToolHandle,
    });

    expect(globPatterns).toStrictEqual([]);
  });

  it('caps how many recursive searches a single query can launch', async () => {
    await createTestFile(path.join(testRootDir, 'present.txt'), 'hello');

    await handleAtCommand({
      query: 'Check @alpha1 @bravo2 @charlie3 @delta4 @echo5 please',
      config: setup.mockConfig,
      addItem: setup.mockAddItem,
      onDebugMessage: setup.mockOnDebugMessage,
      messageId: 901,
      signal: setup.abortController.signal,
      getToolHandle,
    });

    expect(globPatterns.length).toBeLessThanOrEqual(3);
  });

  it('stays bounded when an LLxprt pane is pasted back into the prompt', async () => {
    await createTestFile(path.join(testRootDir, 'quickstart.md'), 'hello');

    const pastedPane = [
      '+----------------------------------------------------------+',
      '| >   Type your message, @path/to/file or +path/to/file     |',
      '+----------------------------------------------------------+',
      '  Ctrl+Q to minimize   Ctrl+T to toggle   ~/projects/demo',
    ].join('\n');

    await handleAtCommand({
      query: pastedPane,
      config: setup.mockConfig,
      addItem: setup.mockAddItem,
      onDebugMessage: setup.mockOnDebugMessage,
      messageId: 902,
      signal: setup.abortController.signal,
      getToolHandle,
    });

    expect(globPatterns.length).toBeLessThanOrEqual(3);
    // A single-character search matches nearly every file in a workspace.
    expect(globPatterns).not.toContain('**/*Q*');
    for (const pattern of globPatterns) {
      expect(pattern).not.toMatch(/\*\*\/\*-+\*/);
    }
  });
});
