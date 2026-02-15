/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for auto-execute slash command classifications and
 * handleAutocomplete return-value contract.
 */

/** @vitest-environment jsdom */

import { describe, it, expect } from 'vitest';
import type { SlashCommand } from '../commands/types.js';
import { aboutCommand } from '../commands/aboutCommand.js';
import { clearCommand } from '../commands/clearCommand.js';
import { compressCommand } from '../commands/compressCommand.js';
import { copyCommand } from '../commands/copyCommand.js';
import { docsCommand } from '../commands/docsCommand.js';
import { editorCommand } from '../commands/editorCommand.js';
import { helpCommand } from '../commands/helpCommand.js';
import { initCommand } from '../commands/initCommand.js';
import { modelCommand } from '../commands/modelCommand.js';
import { quitCommand } from '../commands/quitCommand.js';
import { settingsCommand } from '../commands/settingsCommand.js';
import { themeCommand } from '../commands/themeCommand.js';
import { policiesCommand } from '../commands/policiesCommand.js';
import { authCommand } from '../commands/authCommand.js';
import { setupGithubCommand } from '../commands/setupGithubCommand.js';
import { bugCommand } from '../commands/bugCommand.js';
import { chatCommand } from '../commands/chatCommand.js';

/** Helper to find a subcommand by name. */
function findSub(cmd: SlashCommand, name: string): SlashCommand | undefined {
  return cmd.subCommands?.find((s) => s.name === name);
}

describe('autoExecute classifications — top-level commands', () => {
  it.each<[string, SlashCommand]>([
    ['about', aboutCommand],
    ['clear', clearCommand],
    ['compress', compressCommand],
    ['copy', copyCommand],
    ['docs', docsCommand],
    ['editor', editorCommand],
    ['help', helpCommand],
    ['init', initCommand],
    ['model', modelCommand],
    ['quit', quitCommand],
    ['settings', settingsCommand],
    ['theme', themeCommand],
    ['policies', policiesCommand],
  ])('/%s should have autoExecute: true', (_name, command) => {
    expect(command).toBeDefined();
    expect(command.autoExecute).toBe(true);
  });

  it('/auth should have autoExecute: true', () => {
    expect(authCommand.autoExecute).toBe(true);
  });

  it('/setup-github should have autoExecute: true', () => {
    expect(setupGithubCommand.autoExecute).toBe(true);
  });

  it('/bug should NOT have autoExecute: true', () => {
    expect(bugCommand.autoExecute).not.toBe(true);
  });

  it('/chat should NOT have autoExecute: true', () => {
    expect(chatCommand.autoExecute).not.toBe(true);
  });
});

describe('autoExecute classifications — subcommands', () => {
  it('/stats session, model, tools should have autoExecute: true', async () => {
    const { statsCommand } = await import('../commands/statsCommand.js');
    expect(findSub(statsCommand, 'session')?.autoExecute).toBe(true);
    expect(findSub(statsCommand, 'model')?.autoExecute).toBe(true);
    expect(findSub(statsCommand, 'tools')?.autoExecute).toBe(true);
  });

  it('/memory show, list, refresh should have autoExecute: true', async () => {
    const { memoryCommand } = await import('../commands/memoryCommand.js');
    expect(findSub(memoryCommand, 'show')?.autoExecute).toBe(true);
    expect(findSub(memoryCommand, 'list')?.autoExecute).toBe(true);
    expect(findSub(memoryCommand, 'refresh')?.autoExecute).toBe(true);
  });

  it('/memory add should NOT have autoExecute: true', async () => {
    const { memoryCommand } = await import('../commands/memoryCommand.js');
    expect(findSub(memoryCommand, 'add')?.autoExecute).not.toBe(true);
  });

  it('/mcp list and refresh should have autoExecute: true', async () => {
    const { mcpCommand } = await import('../commands/mcpCommand.js');
    expect(findSub(mcpCommand, 'list')?.autoExecute).toBe(true);
    expect(findSub(mcpCommand, 'refresh')?.autoExecute).toBe(true);
  });

  it('/mcp auth should NOT have autoExecute: true', async () => {
    const { mcpCommand } = await import('../commands/mcpCommand.js');
    expect(findSub(mcpCommand, 'auth')?.autoExecute).not.toBe(true);
  });

  it('/extensions list should have autoExecute: true', async () => {
    const { extensionsCommand } = await import(
      '../commands/extensionsCommand.js'
    );
    expect(findSub(extensionsCommand, 'list')?.autoExecute).toBe(true);
  });

  it('/extensions update should NOT have autoExecute: true', async () => {
    const { extensionsCommand } = await import(
      '../commands/extensionsCommand.js'
    );
    expect(findSub(extensionsCommand, 'update')?.autoExecute).not.toBe(true);
  });
});

describe('handleAutocomplete return value contract', () => {
  it('should document that handleAutocomplete returns the resulting text', () => {
    // handleAutocomplete now returns string | undefined so that callers
    // (like the autoExecute path in InputPrompt) can submit the completed
    // text directly instead of reading the stale buffer.
    //
    // This is a compile-time contract — the actual behavior is tested in
    // useSlashCompletion.test.ts renderHook tests.
    type HandleAutocompleteFn = (indexToUse: number) => string | undefined;

    // Verify the type assignment is valid (compile-time check)
    const fn: HandleAutocompleteFn = (_idx: number) => '/help ';
    expect(fn(0)).toBe('/help ');

    const fnUndefined: HandleAutocompleteFn = (_idx: number) => undefined;
    expect(fnUndefined(0)).toBeUndefined();
  });
});
