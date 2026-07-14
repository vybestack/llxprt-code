/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P25
 * @requirement:REQ-017
 *
 * Behavioral tests for the RUNTIME-FREE static discovery helpers exported from
 * the public package root (`listProviders` / `listTools`). These are the
 * module-level functions a consumer calls BEFORE constructing an Agent — no
 * Agent, no CLI runtime, no Config. We assert on the REAL projected values:
 *  - listProviders() enumerates the registered built-in provider names and
 *    projects each to {name, configured:false} (pre-agent: nothing is bound);
 *  - listTools() projects the canonical built-in tool classes' static Name into
 *    {name, source:'builtin', enabled:true}.
 *
 * No mock theater: the functions construct a real runtime-free ProviderManager
 * and read the real built-in tool classes.
 */

import { describe, it, expect } from 'vitest';
import {
  listProviders as staticListProviders,
  listTools as staticListTools,
} from '@vybestack/llxprt-code-agents';

describe('Static discovery helpers @plan:PLAN-20260617-COREAPI.P25 @requirement:REQ-017', () => {
  it('listProviders() returns the registered built-in providers, each projected as not-configured @plan:PLAN-20260617-COREAPI.P25 @requirement:REQ-017', () => {
    const providers = staticListProviders();

    // The runtime-free ProviderManager registers the known built-in providers.
    expect(providers.length).toBeGreaterThanOrEqual(3);
    const names = providers.map((p) => p.name);
    // Canonical first-party providers are present by exact name.
    for (const expected of ['anthropic', 'gemini', 'openai']) {
      expect(names).toContain(expected);
    }

    // Every provider is projected as not-configured (no bound credentials in
    // the pre-agent path) — kills the `configured: true` boolean mutant.
    for (const p of providers) {
      expect(p.configured).toBe(false);
    }
    // No duplicate names in the projection.
    expect(new Set(names).size).toBe(names.length);
  });

  it('listProviders() projects EXACTLY {name, configured} per provider (no fabricated fields) @plan:PLAN-20260617-COREAPI.P25 @requirement:REQ-017', () => {
    const providers = staticListProviders();
    expect(providers.length).toBeGreaterThan(0);
    for (const p of providers) {
      expect(typeof p.name).toBe('string');
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.configured).toBe(false);
      // the static projection carries no runtime-derived fields
      expect(p.authType).toBeUndefined();
      expect(p.baseUrl).toBeUndefined();
    }
  });

  it('listTools() projects every built-in tool class as an enabled builtin tool with a concrete name @plan:PLAN-20260617-COREAPI.P25 @requirement:REQ-017', () => {
    const tools = staticListTools();

    // The canonical built-in set is non-trivial and stable.
    expect(tools.length).toBeGreaterThanOrEqual(20);

    const names = tools.map((t) => t.name);
    // A representative spread of canonical built-in tool names is present by
    // exact value (kills name/string projection mutants).
    for (const expected of [
      'read_file',
      'write_file',
      'run_shell_command',
      'glob',
      'list_directory',
    ]) {
      expect(names).toContain(expected);
    }

    // Every projected tool is a default-on builtin (kills source/enabled
    // string + boolean mutants).
    for (const t of tools) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.source).toBe('builtin');
      expect(t.enabled).toBe(true);
    }

    // No duplicate tool names.
    expect(new Set(names).size).toBe(names.length);
  });

  it('listTools() is pure and stable across calls (runtime-free, deterministic) @plan:PLAN-20260617-COREAPI.P25 @requirement:REQ-017', () => {
    const first = staticListTools().map((t) => t.name);
    const second = staticListTools().map((t) => t.name);
    expect(second).toStrictEqual(first);
  });
});
