/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PolicyEngine dynamic mode-evaluation tests.
 *
 * Mode-specific behavior is expressed declaratively via `modes` filters on
 * rules. The engine evaluates those rules dynamically at evaluate() time
 * against `currentMode`, which is updated atomically via setApprovalMode().
 * No rules are added or removed on transition.
 *
 * The config below mirrors the production TOML files (write.toml +
 * yolo.toml) so these tests exercise the same rule structure that
 * createPolicyEngineConfig produces.
 */

import { describe, it, expect } from 'vitest';
import {
  PolicyEngine,
  PolicyDecision,
  type PolicyRule,
  type PolicyEngineConfig,
} from './index.js';
import { ApprovalMode } from './types.js';
import { AUTO_EDIT_TOOLS } from './config.js';

// ── TOML-style config builders ─────────────────────────────────────────

/**
 * Builds a PolicyEngineConfig mirroring the production write.toml +
 * yolo.toml files. Rules with `modes` filters are active only when the
 * engine's currentMode matches.
 */
function buildTomlStyleConfig(): PolicyEngineConfig {
  const rules: PolicyRule[] = [];

  // write.toml: priority-10 tools default to ASK_USER
  for (const tool of [...AUTO_EDIT_TOOLS, 'save_memory', 'run_shell_command']) {
    rules.push({
      toolName: tool,
      decision: PolicyDecision.ASK_USER,
      priority: 1.01,
    });
  }

  // write.toml: AUTO_EDIT per-tool ALLOW (mode-filtered)
  for (const tool of AUTO_EDIT_TOOLS) {
    rules.push({
      toolName: tool,
      decision: PolicyDecision.ALLOW,
      priority: 1.015,
      modes: [ApprovalMode.AUTO_EDIT],
    });
  }

  // yolo.toml: YOLO wildcard ALLOW (mode-filtered)
  rules.push({
    decision: PolicyDecision.ALLOW,
    priority: 1.999,
    allowRedirection: true,
    modes: [ApprovalMode.YOLO],
  });

  // read-only.toml: read-only tools always ALLOW
  rules.push({
    toolName: 'glob',
    decision: PolicyDecision.ALLOW,
    priority: 1.05,
  });

  return {
    rules,
    defaultDecision: PolicyDecision.ASK_USER,
  };
}

// ── AUTO_EDIT_TOOLS inventory ─────────────────────────────────────────

describe('AUTO_EDIT_TOOLS inventory', () => {
  it('includes all six edit tools', () => {
    expect([...AUTO_EDIT_TOOLS]).toStrictEqual([
      'replace',
      'write_file',
      'insert_at_line',
      'delete_line_range',
      'apply_patch',
      'ast_edit',
    ]);
  });
});

// ── Mode transitions via setApprovalMode ──────────────────────────────

describe('PolicyEngine mode evaluation via setApprovalMode', () => {
  function makeEngine(mode?: ApprovalMode): PolicyEngine {
    return new PolicyEngine({
      ...buildTomlStyleConfig(),
      ...(mode !== undefined ? { approvalMode: mode } : {}),
    });
  }

  it('DEFAULT: edit tools are ASK_USER', () => {
    const engine = makeEngine(ApprovalMode.DEFAULT);
    for (const tool of AUTO_EDIT_TOOLS) {
      expect(engine.evaluate(tool, {})).toBe(PolicyDecision.ASK_USER);
    }
  });

  it('AUTO_EDIT: edit tools are ALLOW, shell is ASK_USER', () => {
    const engine = makeEngine(ApprovalMode.AUTO_EDIT);
    for (const tool of AUTO_EDIT_TOOLS) {
      expect(engine.evaluate(tool, {})).toBe(PolicyDecision.ALLOW);
    }
    expect(engine.evaluate('run_shell_command', { command: 'ls' })).toBe(
      PolicyDecision.ASK_USER,
    );
  });

  it('YOLO: all tools are ALLOW', () => {
    const engine = makeEngine(ApprovalMode.YOLO);
    expect(engine.evaluate('ast_edit', {})).toBe(PolicyDecision.ALLOW);
    expect(engine.evaluate('run_shell_command', { command: 'ls' })).toBe(
      PolicyDecision.ALLOW,
    );
    expect(engine.evaluate('replace', {})).toBe(PolicyDecision.ALLOW);
  });

  it('user TOML rule with modes = [YOLO] appears/disappears on transition', () => {
    const rule: PolicyRule = {
      toolName: 'custom_tool',
      decision: PolicyDecision.ALLOW,
      priority: 2.5,
      modes: [ApprovalMode.YOLO],
    };
    const engine = new PolicyEngine({
      rules: [rule],
      defaultDecision: PolicyDecision.ASK_USER,
    });

    engine.setApprovalMode(ApprovalMode.YOLO);
    expect(engine.evaluate('custom_tool', {})).toBe(PolicyDecision.ALLOW);

    engine.setApprovalMode(ApprovalMode.DEFAULT);
    expect(engine.evaluate('custom_tool', {})).toBe(PolicyDecision.ASK_USER);
  });
});

// ── Full mode transition synchronization ──────────────────────────────

describe('Full mode transition synchronization', () => {
  it('YOLO→DEFAULT: wildcard ALLOW removed, all tools revert to ASK', () => {
    const engine = new PolicyEngine(buildTomlStyleConfig());

    engine.setApprovalMode(ApprovalMode.YOLO);
    expect(engine.evaluate('replace', {})).toBe(PolicyDecision.ALLOW);
    expect(engine.evaluate('run_shell_command', { command: 'ls' })).toBe(
      PolicyDecision.ALLOW,
    );

    engine.setApprovalMode(ApprovalMode.DEFAULT);
    expect(engine.evaluate('replace', {})).toBe(PolicyDecision.ASK_USER);
    expect(engine.evaluate('run_shell_command', { command: 'ls' })).toBe(
      PolicyDecision.ASK_USER,
    );
  });

  it('AUTO_EDIT→DEFAULT: per-tool ALLOW removed, all edit tools revert to ASK', () => {
    const engine = new PolicyEngine(buildTomlStyleConfig());

    engine.setApprovalMode(ApprovalMode.AUTO_EDIT);
    for (const tool of AUTO_EDIT_TOOLS) {
      expect(engine.evaluate(tool, {})).toBe(PolicyDecision.ALLOW);
    }

    engine.setApprovalMode(ApprovalMode.DEFAULT);
    for (const tool of AUTO_EDIT_TOOLS) {
      expect(engine.evaluate(tool, {})).toBe(PolicyDecision.ASK_USER);
    }
  });

  it('YOLO→AUTO_EDIT: YOLO wildcard removed, only edit tools ALLOW', () => {
    const engine = new PolicyEngine(buildTomlStyleConfig());

    engine.setApprovalMode(ApprovalMode.YOLO);
    expect(engine.evaluate('replace', {})).toBe(PolicyDecision.ALLOW);
    expect(engine.evaluate('run_shell_command', { command: 'ls' })).toBe(
      PolicyDecision.ALLOW,
    );

    engine.setApprovalMode(ApprovalMode.AUTO_EDIT);
    expect(engine.evaluate('replace', {})).toBe(PolicyDecision.ALLOW);
    expect(engine.evaluate('ast_edit', {})).toBe(PolicyDecision.ALLOW);
    expect(engine.evaluate('run_shell_command', { command: 'ls' })).toBe(
      PolicyDecision.ASK_USER,
    );
  });

  it('multiple rapid transitions do not accumulate rules or lose base rules', () => {
    const baseRule: PolicyRule = {
      toolName: 'glob',
      decision: PolicyDecision.ALLOW,
      priority: 1.05,
      source: 'Default: read-only.toml',
    };
    const engine = new PolicyEngine({
      rules: [baseRule],
      defaultDecision: PolicyDecision.ASK_USER,
    });

    for (let i = 0; i < 5; i++) {
      engine.setApprovalMode(ApprovalMode.YOLO);
      engine.setApprovalMode(ApprovalMode.DEFAULT);
      engine.setApprovalMode(ApprovalMode.AUTO_EDIT);
      engine.setApprovalMode(ApprovalMode.DEFAULT);
    }

    const rules = engine.getRules();
    expect(rules).toHaveLength(1);
    expect(engine.evaluate('glob', {})).toBe(PolicyDecision.ALLOW);
  });
});

// ── Focused policy edge cases ─────────────────────────────────────────

describe('Mode-filtered DENY precedence', () => {
  it('non-mode DENY rule (priority 2.9) overrides YOLO wildcard ALLOW (priority 1.999)', () => {
    const denyRule: PolicyRule = {
      toolName: 'run_shell_command',
      argsPattern: /"command":"rm\s+-rf/,
      decision: PolicyDecision.DENY,
      priority: 2.9,
      source: 'User TOML',
    };
    const yoloRule: PolicyRule = {
      decision: PolicyDecision.ALLOW,
      priority: 1.999,
      allowRedirection: true,
      modes: [ApprovalMode.YOLO],
    };
    const engine = new PolicyEngine({
      rules: [denyRule, yoloRule],
      defaultDecision: PolicyDecision.ASK_USER,
    });

    engine.setApprovalMode(ApprovalMode.YOLO);
    expect(engine.evaluate('run_shell_command', { command: 'rm -rf /' })).toBe(
      PolicyDecision.DENY,
    );
    // Other tools still allowed by YOLO wildcard
    expect(engine.evaluate('replace', {})).toBe(PolicyDecision.ALLOW);
  });

  it('non-mode DENY rule overrides AUTO_EDIT ALLOW', () => {
    const denyRule: PolicyRule = {
      toolName: 'replace',
      decision: PolicyDecision.DENY,
      priority: 2.9,
      source: 'Admin TOML',
    };
    const autoEditRule: PolicyRule = {
      toolName: 'replace',
      decision: PolicyDecision.ALLOW,
      priority: 1.015,
      modes: [ApprovalMode.AUTO_EDIT],
    };
    const engine = new PolicyEngine({
      rules: [denyRule, autoEditRule],
      defaultDecision: PolicyDecision.ASK_USER,
    });

    engine.setApprovalMode(ApprovalMode.AUTO_EDIT);
    expect(engine.evaluate('replace', {})).toBe(PolicyDecision.DENY);

    // Other edit tools not denied
    const denyReplaceOnly: PolicyRule = {
      toolName: 'replace',
      decision: PolicyDecision.DENY,
      priority: 2.9,
    };
    const engine2 = new PolicyEngine({
      rules: [
        denyReplaceOnly,
        {
          toolName: 'ast_edit',
          decision: PolicyDecision.ALLOW,
          priority: 1.015,
          modes: [ApprovalMode.AUTO_EDIT],
        },
      ],
      defaultDecision: PolicyDecision.ASK_USER,
    });
    engine2.setApprovalMode(ApprovalMode.AUTO_EDIT);
    expect(engine2.evaluate('ast_edit', {})).toBe(PolicyDecision.ALLOW);
  });
});

describe('Multiple modes on a single rule', () => {
  it('rule active in both AUTO_EDIT and YOLO, inactive in DEFAULT', () => {
    const multiModeRule: PolicyRule = {
      toolName: 'custom_tool',
      decision: PolicyDecision.ALLOW,
      priority: 2.5,
      modes: [ApprovalMode.AUTO_EDIT, ApprovalMode.YOLO],
    };
    const engine = new PolicyEngine({
      rules: [multiModeRule],
      defaultDecision: PolicyDecision.ASK_USER,
    });

    engine.setApprovalMode(ApprovalMode.DEFAULT);
    expect(engine.evaluate('custom_tool', {})).toBe(PolicyDecision.ASK_USER);

    engine.setApprovalMode(ApprovalMode.AUTO_EDIT);
    expect(engine.evaluate('custom_tool', {})).toBe(PolicyDecision.ALLOW);

    engine.setApprovalMode(ApprovalMode.YOLO);
    expect(engine.evaluate('custom_tool', {})).toBe(PolicyDecision.ALLOW);

    engine.setApprovalMode(ApprovalMode.DEFAULT);
    expect(engine.evaluate('custom_tool', {})).toBe(PolicyDecision.ASK_USER);
  });
});

describe('modes combined with argsPattern', () => {
  it('mode-filtered argsPattern rule only matches in its mode and only when args match', () => {
    // This rule denies "dangerous-cmd" only in YOLO mode.
    // We use a priority ABOVE the YOLO wildcard (1.999) so that this
    // specific rule is the decisive one, proving the argsPattern truly
    // governs the match rather than being masked by the wildcard.
    const yoloWildcard: PolicyRule = {
      decision: PolicyDecision.ALLOW,
      priority: 1.999,
      allowRedirection: true,
      modes: [ApprovalMode.YOLO],
    };
    const yoloOnlyDenyPattern: PolicyRule = {
      toolName: 'run_shell_command',
      argsPattern: /"command":"dangerous-cmd"/,
      decision: PolicyDecision.DENY,
      priority: 2.5,
      modes: [ApprovalMode.YOLO],
    };
    const engine = new PolicyEngine({
      rules: [yoloWildcard, yoloOnlyDenyPattern],
      defaultDecision: PolicyDecision.ASK_USER,
    });

    // In YOLO: the argsPattern DENY (2.5) wins over wildcard ALLOW (1.999)
    engine.setApprovalMode(ApprovalMode.YOLO);
    expect(
      engine.evaluate('run_shell_command', { command: 'dangerous-cmd' }),
    ).toBe(PolicyDecision.DENY);
    // Other commands still allowed by wildcard
    expect(engine.evaluate('run_shell_command', { command: 'ls' })).toBe(
      PolicyDecision.ALLOW,
    );

    // In DEFAULT: the mode-filtered DENY rule is inactive; the argsPattern
    // command falls through to the default (ASK_USER), not DENY.
    engine.setApprovalMode(ApprovalMode.DEFAULT);
    expect(
      engine.evaluate('run_shell_command', { command: 'dangerous-cmd' }),
    ).toBe(PolicyDecision.ASK_USER);
  });

  it('mode-filtered ALLOW argsPattern rule is masked by YOLO wildcard but active in DEFAULT', () => {
    // An ALLOW rule for a specific command that is active only in DEFAULT.
    // In YOLO, the wildcard already allows everything (same decision),
    // so we verify it in DEFAULT where the wildcard is absent.
    const yoloWildcard: PolicyRule = {
      decision: PolicyDecision.ALLOW,
      priority: 1.999,
      allowRedirection: true,
      modes: [ApprovalMode.YOLO],
    };
    const defaultOnlyAllow: PolicyRule = {
      toolName: 'run_shell_command',
      argsPattern: /"command":"safe-cmd"/,
      decision: PolicyDecision.ALLOW,
      priority: 2.5,
      modes: [ApprovalMode.DEFAULT],
    };
    const engine = new PolicyEngine({
      rules: [yoloWildcard, defaultOnlyAllow],
      defaultDecision: PolicyDecision.ASK_USER,
    });

    // In DEFAULT: matching command is ALLOW by the mode-filtered rule
    engine.setApprovalMode(ApprovalMode.DEFAULT);
    expect(engine.evaluate('run_shell_command', { command: 'safe-cmd' })).toBe(
      PolicyDecision.ALLOW,
    );
    // Non-matching command falls to default
    expect(engine.evaluate('run_shell_command', { command: 'other-cmd' })).toBe(
      PolicyDecision.ASK_USER,
    );

    // In YOLO: the mode-filtered rule is inactive, but wildcard allows all
    engine.setApprovalMode(ApprovalMode.YOLO);
    expect(engine.evaluate('run_shell_command', { command: 'safe-cmd' })).toBe(
      PolicyDecision.ALLOW,
    );
    expect(engine.evaluate('run_shell_command', { command: 'other-cmd' })).toBe(
      PolicyDecision.ALLOW,
    );
  });
});

// ── Defensive copy behavior ───────────────────────────────────────────

describe('Defensive copies', () => {
  it('getRules returns a fresh copy each call', () => {
    const engine = new PolicyEngine({
      rules: [{ toolName: 'edit', decision: PolicyDecision.ALLOW }],
      defaultDecision: PolicyDecision.ASK_USER,
    });

    const rules1 = engine.getRules();
    const rules2 = engine.getRules();
    expect(rules1).not.toBe(rules2);
    expect(rules1).toStrictEqual(rules2);
  });

  it('constructor does not retain caller array reference', () => {
    const callerRules: PolicyRule[] = [
      { toolName: 'edit', decision: PolicyDecision.ALLOW },
    ];
    const engine = new PolicyEngine({
      rules: callerRules,
      defaultDecision: PolicyDecision.ASK_USER,
    });

    callerRules.push({ toolName: 'shell', decision: PolicyDecision.DENY });
    expect(engine.getRules()).toHaveLength(1);
  });

  it('constructor does not retain caller modes array reference', () => {
    const modes = [ApprovalMode.YOLO];
    const engine = new PolicyEngine({
      rules: [
        {
          toolName: 'edit',
          decision: PolicyDecision.ALLOW,
          modes,
        },
      ],
      defaultDecision: PolicyDecision.ASK_USER,
    });

    modes.splice(0, 1, ApprovalMode.DEFAULT);

    expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ASK_USER);
  });

  it('addRule does not retain caller modes array reference', () => {
    const modes = [ApprovalMode.YOLO];
    const engine = new PolicyEngine({
      defaultDecision: PolicyDecision.ASK_USER,
    });

    engine.addRule({
      toolName: 'edit',
      decision: PolicyDecision.ALLOW,
      modes,
    });
    modes.splice(0, 1, ApprovalMode.DEFAULT);

    expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ASK_USER);
  });

  it('getRules does not expose internal modes array references', () => {
    const engine = new PolicyEngine({
      rules: [
        {
          toolName: 'edit',
          decision: PolicyDecision.ALLOW,
          modes: [ApprovalMode.YOLO],
        },
      ],
      defaultDecision: PolicyDecision.ASK_USER,
    });
    const [rule] = engine.getRules();

    rule.modes?.splice(0, 1, ApprovalMode.DEFAULT);

    expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ASK_USER);
  });
});
