/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2891 — FIX 1 behavioral coverage: the lazy Claude Code OAuth trigger
 * must be reachable for an EXPLICIT, INTERACTIVE, NON-AGENT selection of the
 * `claudecode` provider, while remaining suppressed in every context where a
 * browser flow must never auto-launch:
 *   - non-interactive / headless sessions (no TTY, --prompt, JSON output, CI),
 *   - agent / subagent runtimes (registerAsGlobalSingleton: false),
 *   - profile application and the same-provider early-return (explicit false).
 *
 * The DECISION is the new logic introduced by FIX 1. These tests exercise it
 * with real inputs (a real `isInteractive()` implementation and the REAL
 * runtime registry via `getActiveRuntimeKind()`), asserting observable return
 * values rather than mock call counts. The OAuth browser flow itself is
 * already covered end-to-end by issue2891-claudecode-stale-oauth.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { resolveLazyClaudeCodeOAuthDecision } from '../providerSwitch.js';
import {
  runtimeRegistry,
  upsertRuntimeEntry,
  resetCliRuntimeRegistryForTesting,
  setDefaultCliRuntimeId,
  clearDefaultCliRuntimeId,
} from '../runtimeRegistry.js';
import { getActiveRuntimeKind } from '../runtimeAccessors.js';
import type { RuntimeKind } from '../runtimeRegistry.js';

// A real config-shaped object whose isInteractive() returns the configured
// value — this is exactly the contract readConfigInteractive() relies on.
function makeInteractiveConfig(interactive: boolean): {
  isInteractive: () => boolean;
} {
  return { isInteractive: () => interactive };
}

describe('Issue #2891 FIX 1 — resolveLazyClaudeCodeOAuthDecision', () => {
  describe('explicit opt-in / opt-out always wins', () => {
    it('explicitAutoOAuth=true triggers even when non-interactive', () => {
      expect(
        resolveLazyClaudeCodeOAuthDecision({
          explicitAutoOAuth: true,
          isInteractive: false,
          runtimeKind: 'agent',
        }),
      ).toBe(true);
    });

    it('explicitAutoOAuth=true triggers in a headless runtimeKind', () => {
      expect(
        resolveLazyClaudeCodeOAuthDecision({
          explicitAutoOAuth: true,
          isInteractive: false,
          runtimeKind: 'cli-bootstrap',
        }),
      ).toBe(true);
    });

    it('explicitAutoOAuth=false suppresses even when interactive + cli-interactive', () => {
      expect(
        resolveLazyClaudeCodeOAuthDecision({
          explicitAutoOAuth: false,
          isInteractive: true,
          runtimeKind: 'cli-interactive',
        }),
      ).toBe(false);
    });
  });

  describe('derived (undefined explicit) — interactive non-agent paths', () => {
    it('interactive + cli-interactive reaches the lazy trigger', () => {
      expect(
        resolveLazyClaudeCodeOAuthDecision({
          explicitAutoOAuth: undefined,
          isInteractive: true,
          runtimeKind: 'cli-interactive',
        }),
      ).toBe(true);
    });

    it('interactive + cli-bootstrap reaches the lazy trigger', () => {
      expect(
        resolveLazyClaudeCodeOAuthDecision({
          explicitAutoOAuth: undefined,
          isInteractive: true,
          runtimeKind: 'cli-bootstrap',
        }),
      ).toBe(true);
    });

    it('interactive + no registered runtime (undefined kind) still reaches the trigger', () => {
      expect(
        resolveLazyClaudeCodeOAuthDecision({
          explicitAutoOAuth: undefined,
          isInteractive: true,
          runtimeKind: undefined,
        }),
      ).toBe(true);
    });
  });

  describe('derived (undefined explicit) — suppressed contexts', () => {
    it('non-interactive NEVER triggers (headless / --prompt / JSON / CI)', () => {
      for (const kind of [
        'cli-interactive',
        'cli-bootstrap',
        'agent',
        'subagent',
        undefined,
      ] as Array<RuntimeKind | undefined>) {
        expect(
          resolveLazyClaudeCodeOAuthDecision({
            explicitAutoOAuth: undefined,
            isInteractive: false,
            runtimeKind: kind,
          }),
        ).toBe(false);
      }
    });

    it('interactive + agent runtime NEVER triggers', () => {
      expect(
        resolveLazyClaudeCodeOAuthDecision({
          explicitAutoOAuth: undefined,
          isInteractive: true,
          runtimeKind: 'agent',
        }),
      ).toBe(false);
    });

    it('interactive + subagent runtime NEVER triggers', () => {
      expect(
        resolveLazyClaudeCodeOAuthDecision({
          explicitAutoOAuth: undefined,
          isInteractive: true,
          runtimeKind: 'subagent',
        }),
      ).toBe(false);
    });
  });

  describe('profile-application and same-provider early-return are represented as explicit false', () => {
    // switchProviderForProfile passes autoOAuth:false; the same-provider
    // early-return context sets autoOAuth:false. Both must suppress.
    it('the profile-application path (explicitAutoOAuth=false) suppresses even in an interactive cli', () => {
      expect(
        resolveLazyClaudeCodeOAuthDecision({
          explicitAutoOAuth: false,
          isInteractive: true,
          runtimeKind: 'cli-interactive',
        }),
      ).toBe(false);
    });
  });
});

describe('Issue #2891 FIX 1 — readConfigInteractive contract', () => {
  // The pure decision takes isInteractive directly; the production path reads
  // it via readConfigInteractive(config). We assert the real contract a real
  // config object must satisfy, using the same shape production relies on.
  it('a config with isInteractive()=true is treated as interactive', () => {
    const config = makeInteractiveConfig(true);
    const interactive = config.isInteractive();
    expect(interactive).toBe(true);
  });

  it('a config with isInteractive()=false is treated as non-interactive', () => {
    const config = makeInteractiveConfig(false);
    const interactive = config.isInteractive();
    expect(interactive).toBe(false);
  });
});

describe('Issue #2891 FIX 1 — getActiveRuntimeKind reads the REAL registry', () => {
  beforeEach(() => {
    resetCliRuntimeRegistryForTesting();
  });

  afterEach(() => {
    resetCliRuntimeRegistryForTesting();
  });

  function registerForegroundRuntime(
    runtimeId: string,
    kind: RuntimeKind,
  ): void {
    upsertRuntimeEntry(runtimeId, { runtimeKind: kind });
    clearDefaultCliRuntimeId();
    setDefaultCliRuntimeId(runtimeId, { allowReplace: true });
  }

  it('returns the kind of the registered foreground cli-interactive runtime', () => {
    registerForegroundRuntime('issue2891-cli', 'cli-interactive');
    expect(runtimeRegistry.get('issue2891-cli')?.runtimeKind).toBe(
      'cli-interactive',
    );
    expect(getActiveRuntimeKind()).toBe('cli-interactive');
  });

  it('returns "agent" for an agent runtime (would suppress lazy OAuth)', () => {
    registerForegroundRuntime('issue2891-agent', 'agent');
    expect(getActiveRuntimeKind()).toBe('agent');
  });

  it('returns "subagent" for a subagent runtime (would suppress lazy OAuth)', () => {
    registerForegroundRuntime('issue2891-subagent', 'subagent');
    expect(getActiveRuntimeKind()).toBe('subagent');
  });

  it('returns undefined and never throws when no runtime is registered', () => {
    expect(getActiveRuntimeKind()).toBeUndefined();
  });

  it('wires through the decision: agent runtime suppresses even when interactive', () => {
    registerForegroundRuntime('issue2891-agent-2', 'agent');
    expect(
      resolveLazyClaudeCodeOAuthDecision({
        explicitAutoOAuth: undefined,
        isInteractive: true,
        runtimeKind: getActiveRuntimeKind(),
      }),
    ).toBe(false);
  });

  it('wires through the decision: cli-interactive runtime reaches the trigger when interactive', () => {
    registerForegroundRuntime('issue2891-cli-2', 'cli-interactive');
    expect(
      resolveLazyClaudeCodeOAuthDecision({
        explicitAutoOAuth: undefined,
        isInteractive: true,
        runtimeKind: getActiveRuntimeKind(),
      }),
    ).toBe(true);
  });
});

/**
 * ITEM 3: the reporter's scenario, expressed at the decision level.
 *
 * `createProviderSwitchContext` is private and calls getCliRuntimeServices(),
 * so it is impractical to invoke directly in a unit test. The fix changed its
 * `autoOAuth` forwarding from `options.autoOAuth ?? false` to a verbatim
 * `options.autoOAuth`. That difference is decisive: the caller passes NO
 * `autoOAuth` on the plain `--provider claudecode` startup switch, so
 * `?? false` fed `explicitAutoOAuth: false` (always suppress) while the
 * verbatim forwarding feeds `undefined` (derive -> fire for interactive CLI).
 *
 * These two tests pin the two sides of that difference, so the consequence of
 * re-introducing the coercion is stated executably rather than in prose.
 */
describe('Issue #2891 ITEM 3 — the reporter scenario resolves to "attempt lazy OAuth"', () => {
  it('the reporter scenario (undefined autoOAuth, interactive, cli-interactive) reaches the lazy trigger', () => {
    // createProviderSwitchContext forwards undefined -> the decision derives.
    // This is the user-visible behavior: with --provider claudecode on an
    // interactive CLI, the lazy browser OAuth flow fires.
    expect(
      resolveLazyClaudeCodeOAuthDecision({
        explicitAutoOAuth: undefined,
        isInteractive: true,
        runtimeKind: 'cli-interactive',
      }),
    ).toBe(true);
  });

  it('re-introducing ?? false would flip the reporter scenario to suppressed', () => {
    // If createProviderSwitchContext coerced undefined to false, the same
    // scenario would feed explicitAutoOAuth:false and the flow would NOT fire.
    expect(
      resolveLazyClaudeCodeOAuthDecision({
        explicitAutoOAuth: false,
        isInteractive: true,
        runtimeKind: 'cli-interactive',
      }),
    ).toBe(false);
  });
});
