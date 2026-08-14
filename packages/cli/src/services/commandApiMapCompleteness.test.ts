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
 * command (top-level and sub-command) must appear in the combined
 * command→API map (the agents-canonical COMMAND_API_MAP plus CLI-owned
 * extensions for commands with no agents/core surface) or be excluded via
 * the CONFIG_GATED_COMMANDS set (commands not loaded with null config). This
 * prevents future drift between the command registry and the classification
 * map.
 *
 * The combined map classifies each command as runtime / subpath / cli-local
 * and is the canonical source of truth for the runtime-vs-app-service boundary.
 * CLI-local commands that have no agents/core dependency (e.g. `/perf` and its
 * subcommands) are owned in the CLI package via CLI_COMMAND_API_EXTENSIONS so
 * the agents package stays agent-neutral.
 */

import { describe, it, expect } from 'bun:test';
import { COMMAND_API_MAP } from '@vybestack/llxprt-code-agents/app-service.js';
import { CLI_COMMAND_API_EXTENSIONS } from './cliCommandApiMap.js';
import type { SlashCommand } from '../ui/commands/types.js';
import { BuiltinCommandLoader } from './BuiltinCommandLoader.js';

/**
 * The unified boundary map: the agents-canonical COMMAND_API_MAP augmented
 * with CLI-owned extensions for commands that have no agents/core surface.
 * Every completeness, orphan, and uniqueness check below validates this
 * combined map so there is a single source of truth at the test boundary.
 */
const COMBINED_COMMAND_API_MAP: ReadonlyArray<
  (typeof COMMAND_API_MAP)[number]
> = [...COMMAND_API_MAP, ...CLI_COMMAND_API_EXTENSIONS];

/**
 * Config-gated commands that are not loaded when config is null. These are
 * intentionally excluded from the registered-command completeness check
 * because their registration depends on feature flags that require a
 * fully initialized Config. Their map entries are verified separately.
 */
const CONFIG_GATED_COMMANDS: readonly string[] = [
  '/skills',
  '/hooks',
  '/restore',
  '/ide',
  '/uiprofile',
];

/**
 * Known subcommands of config-gated commands. These are not loaded by
 * BuiltinCommandLoader(null), so they are verified explicitly here to
 * ensure they have map entries.
 */
const GATED_SUBCOMMANDS: readonly string[] = [
  '/hooks list',
  '/hooks enable',
  '/hooks disable',
  '/hooks enable-all',
  '/hooks disable-all',
];

/**
 * Conceptual entries in the combined map that do not correspond to literal
 * slash commands but are required by the boundary test (app-service functions
 * invoked via dialogs or internal actions, not via /command). These are
 * intentionally excluded from the reverse orphan check.
 */
const CONCEPTUAL_COMMANDS: readonly string[] = [
  '/mcp add',
  '/mcp remove',
  '/memory edit',
  '/approval-mode',
  '/chat tag',
];

/**
 * Returns true when the given command path is covered by at least one entry in
 * the combined map. A command is covered if there is an entry whose command
 * field exactly matches the path.
 */
function isCommandMapped(commandPath: string): boolean {
  return COMBINED_COMMAND_API_MAP.some(
    (entry) => entry.command === commandPath,
  );
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

  it('every registered command has a combined-map entry', () => {
    const unmapped = checkablePaths.filter((p) => !isCommandMapped(p));
    expect(unmapped).toStrictEqual([]);
  });

  it('no orphaned slash-command entries exist in the combined map', () => {
    const slashEntries = COMBINED_COMMAND_API_MAP.map((e) => e.command).filter(
      (cmd) => cmd.startsWith('/'),
    );
    const knownPaths = new Set([
      ...checkablePaths,
      ...CONFIG_GATED_COMMANDS,
      ...GATED_SUBCOMMANDS,
      ...CONCEPTUAL_COMMANDS,
    ]);
    const orphans = slashEntries.filter((cmd) => !knownPaths.has(cmd));
    expect(orphans).toStrictEqual([]);
  });

  it('no two combined-map entries share the same command string', () => {
    const names = COMBINED_COMMAND_API_MAP.map((e) => e.command);
    const duplicates = names.filter((name, idx) => names.indexOf(name) !== idx);
    expect(duplicates).toHaveLength(0);
  });

  it('every subpath entry targets the pinned specifier with a named export', () => {
    const subpathEntries = COMBINED_COMMAND_API_MAP.filter(
      (e) => e.kind === 'subpath',
    );
    expect(subpathEntries.length).toBeGreaterThan(0);
    for (const entry of subpathEntries) {
      expect(entry.target).toBe('@vybestack/llxprt-code-agents/app-service.js');
      expect(typeof entry.exportName).toBe('string');
      expect((entry.exportName ?? '').length).toBeGreaterThan(0);
    }
  });

  it('config-gated commands and their subcommands are tracked in the combined map', () => {
    for (const gated of CONFIG_GATED_COMMANDS) {
      expect(isCommandMapped(gated)).toBe(true);
    }
    for (const sub of GATED_SUBCOMMANDS) {
      expect(isCommandMapped(sub)).toBe(true);
    }
  });

  it('CLI extensions do not duplicate agents-map command strings', () => {
    const agentsCommands = new Set(COMMAND_API_MAP.map((e) => e.command));
    for (const ext of CLI_COMMAND_API_EXTENSIONS) {
      expect(agentsCommands.has(ext.command)).toBe(false);
    }
  });

  it('every CLI extension is classified cli-local', () => {
    for (const ext of CLI_COMMAND_API_EXTENSIONS) {
      expect(ext.kind).toBe('cli-local');
    }
  });

  // ---- Semantic classification (#3230) ----
  // /perf memory reads the LIVE HistoryService through the agent client —
  // the same runtime accessor /dumpcontext uses — so it must be classified
  // runtime in the agents map, never cli-local. The other /perf subcommands
  // only read/write CLI-local telemetry files and stay cli-local.
  it('classifies /perf memory as runtime because it reads live agent history state', () => {
    const row = COMBINED_COMMAND_API_MAP.find(
      (e) => e.command === '/perf memory',
    );
    expect(row).toBeDefined();
    expect(row?.kind).toBe('runtime');
    expect(row?.target).toBe('agent.getHistory');
    const cliCommands: readonly string[] = CLI_COMMAND_API_EXTENSIONS.map(
      (e) => e.command,
    );
    expect(cliCommands).not.toContain('/perf memory');
  });

  it('keeps file-only /perf subcommands cli-local', () => {
    for (const commandPath of [
      '/perf',
      '/perf inspect',
      '/perf report',
      '/perf delete',
    ]) {
      const row = COMBINED_COMMAND_API_MAP.find(
        (e) => e.command === commandPath,
      );
      expect(row).toBeDefined();
      expect(row?.kind).toBe('cli-local');
    }
  });

  it('maps /perf memory to the same runtime target as /dumpcontext live history', () => {
    const memory = COMBINED_COMMAND_API_MAP.find(
      (e) => e.command === '/perf memory',
    );
    const dumpcontext = COMBINED_COMMAND_API_MAP.find(
      (e) => e.command === '/dumpcontext',
    );
    expect(memory?.kind).toBe(dumpcontext?.kind);
    expect(memory?.target).toBe(dumpcontext?.target);
  });
});
