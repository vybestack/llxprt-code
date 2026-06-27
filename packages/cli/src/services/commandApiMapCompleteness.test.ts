/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P09
 * @requirement:REQ-021
 *
 * Command-map completeness test (#2203 / REQ-021). Every registered CLI slash
 * command (top-level and sub-command) must appear in COMMAND_API_MAP or be
 * present in the explicit CLI_LOCAL_EXEMPTION set. This prevents future drift
 * between the command registry and the classification map.
 *
 * The COMMAND_API_MAP classifies each command as runtime / subpath / cli-local
 * and is the canonical source of truth for the runtime-vs-app-service boundary.
 */

import { describe, it, expect } from 'vitest';
import { COMMAND_API_MAP } from '@vybestack/llxprt-code-agents/app-service.js';
import type { SlashCommand } from '../ui/commands/types.js';
import { BuiltinCommandLoader } from './BuiltinCommandLoader.js';

/**
 * Config-gated commands that are not loaded when config is null. These are
 * intentionally excluded from the completeness check because their registration
 * depends on feature flags that require a fully initialized Config.
 */
const CONFIG_GATED_COMMANDS: readonly string[] = ['/skills', '/hooks'];

/**
 * Returns true when the given command path is covered by at least one entry in
 * COMMAND_API_MAP. A command is covered if there is an entry whose command
 * field exactly matches the path.
 */
function isCommandMapped(commandPath: string): boolean {
  return COMMAND_API_MAP.some((entry) => entry.command === commandPath);
}

/**
 * Recursively flattens a command tree into {path, name} tuples. Top-level
 * commands are prefixed with '/'; sub-commands are prefixed with the parent
 * path using a space separator, e.g. '/mcp list'.
 */
function flattenCommands(
  commands: readonly SlashCommand[],
  parentPath = '',
): Array<{ name: string; path: string }> {
  const result: Array<{ name: string; path: string }> = [];
  for (const cmd of commands) {
    const path = parentPath ? `${parentPath} ${cmd.name}` : `/${cmd.name}`;
    result.push({ name: cmd.name, path });
    if (cmd.subCommands && cmd.subCommands.length > 0) {
      result.push(...flattenCommands(cmd.subCommands, path));
    }
  }
  return result;
}

describe('Command-map completeness (#2203 / REQ-021)', () => {
  const loader = new BuiltinCommandLoader(null);
  const registeredCommands = loader.loadCommandsSync();
  const flattened = flattenCommands(registeredCommands);
  const commandPaths = flattened.map((c) => c.path);

  // Filter out config-gated commands (they aren't loaded with null config).
  const checkablePaths = commandPaths.filter(
    (p) =>
      !CONFIG_GATED_COMMANDS.some(
        (gated) => p === gated || p.startsWith(`${gated} `),
      ),
  );

  it('loads a non-empty command set from BuiltinCommandLoader', () => {
    expect(registeredCommands.length).toBeGreaterThan(0);
    expect(checkablePaths.length).toBeGreaterThan(0);
  });

  it('every registered command has a COMMAND_API_MAP entry', () => {
    const unmapped = checkablePaths.filter((p) => !isCommandMapped(p));
    expect(unmapped).toStrictEqual([]);
  });

  it('no two COMMAND_API_MAP entries share the same command string', () => {
    const names = COMMAND_API_MAP.map((e) => e.command);
    const duplicates = names.filter((name, idx) => names.indexOf(name) !== idx);
    expect(duplicates).toHaveLength(0);
  });

  it('every subpath entry targets the pinned specifier with a named export', () => {
    const subpathEntries = COMMAND_API_MAP.filter((e) => e.kind === 'subpath');
    expect(subpathEntries.length).toBeGreaterThan(0);
    for (const entry of subpathEntries) {
      expect(entry.target).toBe('@vybestack/llxprt-code-agents/app-service.js');
      expect(typeof entry.exportName).toBe('string');
      expect((entry.exportName ?? '').length).toBeGreaterThan(0);
    }
  });

  it('config-gated commands are tracked and map entries exist for them', () => {
    // Even though skills/hooks are not loaded with null config, their map
    // entries must exist so the boundary classification is complete.
    for (const gated of CONFIG_GATED_COMMANDS) {
      expect(isCommandMapped(gated)).toBe(true);
    }
  });
});
