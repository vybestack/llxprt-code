/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * API surface compatibility canary for subagent.ts.
 *
 * Backward-compatible surface tests are BLOCKING — they must pass at all
 * times during refactoring. Failure here means a regression in public API.
 *
 * Additive surface tests are NON-BLOCKING — they verify new exports introduced
 * by the decomposition (expected in Phase 1+). They are skipped until the
 * relevant phase lands, then unskipped to become blocking.
 */

import { describe, it, expect } from 'vitest';

describe('subagent.ts backward-compatible API surface', () => {
  it('should export SubagentTerminateMode as a value', async () => {
    const mod = await import('./subagent.js');
    expect(mod.SubagentTerminateMode).toBeDefined();
    expect(mod.SubagentTerminateMode.GOAL).toBe('GOAL');
    expect(mod.SubagentTerminateMode.ERROR).toBe('ERROR');
    expect(mod.SubagentTerminateMode.TIMEOUT).toBe('TIMEOUT');
    expect(mod.SubagentTerminateMode.MAX_TURNS).toBe('MAX_TURNS');
  });

  it('should export ContextState as a constructable class', async () => {
    const mod = await import('./subagent.js');
    expect(mod.ContextState).toBeDefined();
    const ctx = new mod.ContextState();
    ctx.set('k', 'v');
    expect(ctx.get('k')).toBe('v');
    expect(ctx.get_keys()).toStrictEqual(['k']);
  });

  it('should export SubAgentScope as a class with a static create() method', async () => {
    const mod = await import('./subagent.js');
    expect(mod.SubAgentScope).toBeDefined();
    expect(typeof mod.SubAgentScope.create).toBe('function');
  });
});

/**
 * Additive API surface — new exports introduced by the decomposition.
 * These are expected to land in Phase 1. The tests are skipped here in Phase 0
 * and will be unskipped in Phase 1 once the symbols are available.
 * Move the passing tests into the backward-compat block above after Phase 5.
 */
describe('subagent.ts additive API surface (unskip in Phase 1)', () => {
  it('should export templateString as a function', async () => {
    const mod = await import('./subagent.js');
    expect(typeof mod.templateString).toBe('function');
  });

  it('should export defaultEnvironmentContextLoader as a function', async () => {
    const mod = await import('./subagent.js');
    expect(typeof mod.defaultEnvironmentContextLoader).toBe('function');
  });
});
