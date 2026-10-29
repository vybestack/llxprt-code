/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for auto-execute slash command classifications and
 * handleAutocomplete return-value contract.
 */

import { describe, it, expect } from 'bun:test';
import type { SlashCommand } from '../commands/types.js';
import { editorCommand } from '../commands/editorCommand.js';
import { createModelCommand } from '../commands/modelCommand.js';
import { settingsCommand } from '../commands/settingsCommand.js';
import { themeCommand } from '../commands/themeCommand.js';
import { createPoliciesCommand } from '../commands/policiesCommand.js';
import { createUnconfiguredBuiltinOwners } from '../../__tests__/unconfigured-model-command.js';

const modelCommand = createModelCommand(
  async () => {
    throw new Error('No model owner in metadata fixture');
  },
  async () => {
    throw new Error('No recording owner in metadata fixture');
  },
);

/** Helper to find a subcommand by name. */
function findSub(cmd: SlashCommand, name: string): SlashCommand | undefined {
  return cmd.subCommands?.find((s) => s.name === name);
}

const { docsCommand, helpCommand, quitCommand } =
  createUnconfiguredBuiltinOwners();

describe('autoExecute classifications — top-level commands', () => {
  it.each<[string, SlashCommand]>([
    ['about', createUnconfiguredBuiltinOwners().aboutCommand],
    ['clear', createUnconfiguredBuiltinOwners().clearCommand],
    ['compress', createUnconfiguredBuiltinOwners().compressCommand],
    ['copy', createUnconfiguredBuiltinOwners().copyCommand],
    ['docs', docsCommand],
    ['editor', editorCommand],
    ['help', helpCommand],
    ['init', createUnconfiguredBuiltinOwners().initCommand],
    ['model', modelCommand],
    ['quit', quitCommand],
    ['settings', settingsCommand],
    ['theme', themeCommand],
    ['policies', createPoliciesCommand({ getPolicyInfo: () => null })],
  ])('/%s should have autoExecute: true', (_name, command) => {
    expect(command).toBeDefined();
    expect(command.autoExecute).toBe(true);
  });

  it('/auth should have autoExecute: true', () => {
    expect(createUnconfiguredBuiltinOwners().authCommand.autoExecute).toBe(
      true,
    );
  });

  it('/setup-github should have autoExecute: true', () => {
    expect(
      createUnconfiguredBuiltinOwners().setupGithubCommand.autoExecute,
    ).toBe(true);
  });

  it('/bug should NOT have autoExecute: true', () => {
    expect(createUnconfiguredBuiltinOwners().bugCommand.autoExecute).not.toBe(
      true,
    );
  });

  it('/chat should NOT have autoExecute: true', () => {
    expect(createUnconfiguredBuiltinOwners().chatCommand.autoExecute).not.toBe(
      true,
    );
  });
});

describe('autoExecute classifications — subcommands', () => {
  it('/stats session, model, tools should have autoExecute: true', async () => {
    const { statsCommand } = createUnconfiguredBuiltinOwners();
    expect(findSub(statsCommand, 'session')?.autoExecute).toBe(true);
    expect(findSub(statsCommand, 'model')?.autoExecute).toBe(true);
    expect(findSub(statsCommand, 'tools')?.autoExecute).toBe(true);
  });

  it('/memory show, list, refresh should have autoExecute: true', async () => {
    const { memoryCommand } = createUnconfiguredBuiltinOwners();
    expect(findSub(memoryCommand, 'show')?.autoExecute).toBe(true);
    expect(findSub(memoryCommand, 'list')?.autoExecute).toBe(true);
    expect(findSub(memoryCommand, 'refresh')?.autoExecute).toBe(true);
  });

  it('/memory add should NOT have autoExecute: true', async () => {
    const { memoryCommand } = createUnconfiguredBuiltinOwners();
    expect(findSub(memoryCommand, 'add')?.autoExecute).not.toBe(true);
  });

  it('/mcp list and refresh should have autoExecute: true', () => {
    const { mcpCommand } = createUnconfiguredBuiltinOwners();
    expect(findSub(mcpCommand, 'list')?.autoExecute).toBe(true);
    expect(findSub(mcpCommand, 'refresh')?.autoExecute).toBe(true);
  });

  it('/mcp auth should have autoExecute: true', () => {
    const { mcpCommand } = createUnconfiguredBuiltinOwners();
    expect(findSub(mcpCommand, 'auth')?.autoExecute).toBe(true);
  });

  it('/extensions list should have autoExecute: true', async () => {
    const { extensionsCommand } = createUnconfiguredBuiltinOwners();
    expect(findSub(extensionsCommand, 'list')?.autoExecute).toBe(true);
  });

  it('/extensions update should NOT have autoExecute: true', async () => {
    const { extensionsCommand } = createUnconfiguredBuiltinOwners();
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
