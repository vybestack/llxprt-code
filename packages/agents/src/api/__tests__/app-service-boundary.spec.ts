/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P09
 * @requirement:REQ-021
 *
 * T23/T24 — Runtime-vs-app-service boundary + completions boundary.
 * Contract test over COMMAND_API_MAP:
 *   - No orphan: every command has a kind in {runtime, subpath, cli-local}.
 *   - The durable app-service set is present and classified as `subpath`.
 *   - T23 (NATURAL RED): every `subpath` entry is resolved via a dynamic
 *     `await import(entry.target)` and its `exportName` must be a defined
 *     function. Because @vybestack/llxprt-code-agents/app-service.js is
 *     implemented in P27 and does NOT exist yet, the dynamic import rejects and
 *     the assertion FAILS NATURALLY. The dynamic import is used (never a
 *     top-level static import) so the harness module itself still loads.
 *   - T24: every completion-related entry is classified (no orphan).
 */

import { describe, it, expect } from 'vitest';
import { COMMAND_API_MAP, type CommandApiMapping } from './command-api-map.js';

const VALID_KINDS: ReadonlySet<string> = new Set([
  'runtime',
  'subpath',
  'cli-local',
]);

const REQUIRED_DURABLE_COMMANDS: readonly string[] = [
  '/mcp add',
  '/mcp remove',
  '/extensions',
  '/skills',
  '/memory edit',
  'settings mutation',
  'diagnostics',
];

const COMPLETION_PREFIX = 'completions:';
const APP_SERVICE_SPECIFIER = '@vybestack/llxprt-code-agents/app-service.js';

const ORPHANS = COMMAND_API_MAP.filter((e) => !VALID_KINDS.has(e.kind));
const COMMAND_NAMES = COMMAND_API_MAP.map((e) => e.command);
const UNIQUE_COMMAND_COUNT = new Set(COMMAND_NAMES).size;
const BY_COMMAND: ReadonlyMap<string, CommandApiMapping> = new Map(
  COMMAND_API_MAP.map((e) => [e.command, e] as const),
);
const MISSING_DURABLE = REQUIRED_DURABLE_COMMANDS.filter(
  (cmd) => !BY_COMMAND.has(cmd),
);
const WRONG_KIND_DURABLE = REQUIRED_DURABLE_COMMANDS.filter((cmd) => {
  const entry = BY_COMMAND.get(cmd);
  return entry !== undefined && entry.kind !== 'subpath';
});
const SUBPATH_ENTRIES = COMMAND_API_MAP.filter((e) => e.kind === 'subpath');
const SUBPATH_MISSING_EXPORT_NAME = SUBPATH_ENTRIES.filter(
  (e) => typeof e.exportName !== 'string' || (e.exportName ?? '').length === 0,
);
const SUBPATH_WRONG_TARGET = SUBPATH_ENTRIES.filter(
  (e) => e.target !== APP_SERVICE_SPECIFIER,
);
const COMPLETION_ENTRIES = COMMAND_API_MAP.filter((e) =>
  e.command.startsWith(COMPLETION_PREFIX),
);
const COMPLETION_UNCLASSIFIED = COMPLETION_ENTRIES.filter(
  (e) => e.kind !== 'subpath' && e.kind !== 'cli-local',
);

describe('Runtime-vs-app-service boundary (T23/T24) @plan:PLAN-20260617-COREAPI.P09 @requirement:REQ-021', () => {
  it('every command has exactly one valid kind (no orphan) @plan:PLAN-20260617-COREAPI.P09 @requirement:REQ-021', () => {
    expect(COMMAND_API_MAP.length).toBeGreaterThan(0);
    expect(ORPHANS).toHaveLength(0);
    expect(UNIQUE_COMMAND_COUNT).toBe(COMMAND_NAMES.length);
  });

  it('the durable app-service set is present and classified as subpath @plan:PLAN-20260617-COREAPI.P09 @requirement:REQ-021', () => {
    expect(MISSING_DURABLE).toHaveLength(0);
    expect(WRONG_KIND_DURABLE).toHaveLength(0);
  });

  it('every subpath entry targets the pinned app-service specifier and names an export @plan:PLAN-20260617-COREAPI.P09 @requirement:REQ-021', () => {
    expect(SUBPATH_ENTRIES.length).toBeGreaterThan(0);
    expect(SUBPATH_WRONG_TARGET).toHaveLength(0);
    expect(SUBPATH_MISSING_EXPORT_NAME).toHaveLength(0);
  });

  it('durable app-service subpaths are importable with their named export (T23) @plan:PLAN-20260617-COREAPI.P09 @requirement:REQ-021', async () => {
    expect(SUBPATH_ENTRIES.length).toBeGreaterThan(0);
    for (const entry of SUBPATH_ENTRIES) {
      const mod: Record<string, unknown> = await import(entry.target);
      const exported = mod[entry.exportName ?? ''];
      expect(typeof exported).toBe('function');
    }
  });

  it('every completion entry is classified with no orphan (T24) @plan:PLAN-20260617-COREAPI.P09 @requirement:REQ-021', () => {
    expect(COMPLETION_ENTRIES.length).toBeGreaterThan(0);
    expect(COMPLETION_UNCLASSIFIED).toHaveLength(0);
  });
});
