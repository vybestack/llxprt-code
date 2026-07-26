/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  PolicyEngine,
  PolicyDecision,
  stableStringify,
  type PolicyEngineConfig,
} from '@vybestack/llxprt-code-policy';

/**
 * Builds a PolicyEngine configured in YOLO mode: a single wildcard ALLOW rule
 * at priority 1.999 that would normally permit any tool, including destructive
 * shell commands. The destructive-command disabled-list must override it.
 */
function yoloEngine(): PolicyEngine {
  const config: PolicyEngineConfig = {
    rules: [{ decision: PolicyDecision.ALLOW, priority: 1.999 }],
  };
  return new PolicyEngine(config);
}

describe('Destructive-command disabled-list (PolicyEngine integration)', () => {
  describe('YOLO mode is overridden by the disabled-list', () => {
    it('denies rm -rf / under YOLO wildcard', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', { command: 'rm -rf /' }),
      ).toBe(PolicyDecision.DENY);
    });

    it('denies mkfs.ext4 under YOLO wildcard', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', {
          command: 'mkfs.ext4 /dev/sda',
        }),
      ).toBe(PolicyDecision.DENY);
    });

    it('denies chmod +s under YOLO wildcard', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', { command: 'chmod +s /bin/bash' }),
      ).toBe(PolicyDecision.DENY);
    });

    it('still ALLOWS benign rm under YOLO wildcard (passes through)', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', { command: 'rm -rf ./build' }),
      ).toBe(PolicyDecision.ALLOW);
    });
  });

  describe('absolute-path and interpreter-wrapped destructive commands under YOLO', () => {
    it('denies /bin/rm -rf / under YOLO wildcard', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', { command: '/bin/rm -rf /' }),
      ).toBe(PolicyDecision.DENY);
    });

    it('denies bash -c "rm -rf /" under YOLO wildcard', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', { command: 'bash -c "rm -rf /"' }),
      ).toBe(PolicyDecision.DENY);
    });

    it('denies sh -c "rm -rf /" under YOLO wildcard', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', { command: 'sh -c "rm -rf /"' }),
      ).toBe(PolicyDecision.DENY);
    });

    it('denies zsh -c "rm -rf /" under YOLO wildcard', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', { command: 'zsh -c "rm -rf /"' }),
      ).toBe(PolicyDecision.DENY);
    });

    it('denies dash -c "rm -rf /" under YOLO wildcard', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', { command: 'dash -c "rm -rf /"' }),
      ).toBe(PolicyDecision.DENY);
    });

    it('denies ksh -c "rm -rf /" under YOLO wildcard', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', { command: 'ksh -c "rm -rf /"' }),
      ).toBe(PolicyDecision.DENY);
    });
  });

  describe('disabled-list beats explicit allowlist rules', () => {
    function rmAllowEngine(): PolicyEngine {
      return new PolicyEngine({
        rules: [
          {
            toolName: 'run_shell_command',
            argsPattern: /"command":"rm(?:[\s"]|$)/,
            decision: PolicyDecision.ALLOW,
            priority: 2.3,
          },
        ],
        defaultDecision: PolicyDecision.ASK_USER,
      });
    }

    it('denies rm -rf / even when an ALLOW rule matches rm', () => {
      const engine = rmAllowEngine();
      expect(
        engine.evaluate('run_shell_command', { command: 'rm -rf /' }),
      ).toBe(PolicyDecision.DENY);
    });

    it('still allows a benign command that matches the allowlist', () => {
      const engine = rmAllowEngine();
      expect(
        engine.evaluate('run_shell_command', { command: 'rm ./build/file' }),
      ).toBe(PolicyDecision.ALLOW);
    });

    it('denies IFS-obfuscated rm even when a MATCHED ALLOW rule targets it', () => {
      // The destructive-command guard is a pre-check that returns DENY BEFORE
      // rule matching occurs, so it beats ANY rule regardless of priority.
      // To prove this is a genuine allow that the guard overrides (not merely a
      // non-matching rule), the SAME argsPattern used on the engine's ALLOW rule
      // is asserted below to actually match the serialized args.
      const rmIfsAllowPattern = /"command":"rm\$IFS/;
      const serializedArgs = stableStringify({
        command: 'rm$IFS-rf$IFS/',
      });
      // Positive control: the ALLOW rule WOULD match if the guard did not fire.
      expect(rmIfsAllowPattern.test(serializedArgs)).toBe(true);
      const engine = new PolicyEngine({
        rules: [
          {
            toolName: 'run_shell_command',
            argsPattern: rmIfsAllowPattern,
            decision: PolicyDecision.ALLOW,
            priority: 2.3,
          },
        ],
        defaultDecision: PolicyDecision.ASK_USER,
      });
      // The guard short-circuits to DENY before findMatchingRule is reached.
      expect(
        engine.evaluate('run_shell_command', {
          command: 'rm$IFS-rf$IFS/',
        }),
      ).toBe(PolicyDecision.DENY);
    });
  });

  describe('bypass classes A-D through evaluate() under YOLO', () => {
    it("denies r''m -rf / (quote obfuscation)", () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', { command: "r''m -rf /" }),
      ).toBe(PolicyDecision.DENY);
    });

    it('denies rm$IFS-rf$IFS/ (IFS splitting)', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', {
          command: 'rm$IFS-rf$IFS/',
        }),
      ).toBe(PolicyDecision.DENY);
    });

    it('denies echo "$(rm -rf /)" (command substitution)', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', { command: 'echo "$(rm -rf /)"' }),
      ).toBe(PolicyDecision.DENY);
    });

    it('denies echo `rm -rf /` (backtick substitution)', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', { command: 'echo `rm -rf /`' }),
      ).toBe(PolicyDecision.DENY);
    });
  });

  describe('benign commands are unaffected', () => {
    it('returns ASK_USER for benign rm under default engine', () => {
      const engine = new PolicyEngine();
      expect(
        engine.evaluate('run_shell_command', { command: 'rm -rf ./build' }),
      ).toBe(PolicyDecision.ASK_USER);
    });

    it('returns ASK_USER for find under default engine', () => {
      const engine = new PolicyEngine();
      expect(
        engine.evaluate('run_shell_command', { command: 'find . -name x' }),
      ).toBe(PolicyDecision.ASK_USER);
    });
  });

  describe('destructive DENY fires under DEFAULT engine (no rules)', () => {
    it('denies rm -rf / under default engine', () => {
      const engine = new PolicyEngine();
      expect(
        engine.evaluate('run_shell_command', { command: 'rm -rf /' }),
      ).toBe(PolicyDecision.DENY);
    });

    it('denies mkfs.ext4 /dev/sda under default engine', () => {
      const engine = new PolicyEngine();
      expect(
        engine.evaluate('run_shell_command', {
          command: 'mkfs.ext4 /dev/sda',
        }),
      ).toBe(PolicyDecision.DENY);
    });
  });

  describe('tool-name scoping', () => {
    it('is SCOPED to SHELL_TOOL_NAMES and does NOT apply to other tool names', () => {
      // 'some_other_tool' is not in SHELL_TOOL_NAMES, so the disabled-list
      // guard must not fire. Under a default engine it follows normal rules.
      const engine = new PolicyEngine();
      expect(engine.evaluate('some_other_tool', { command: 'rm -rf /' })).toBe(
        PolicyDecision.ASK_USER,
      );
    });

    it('forces DENY for "ShellTool" (which IS in SHELL_TOOL_NAMES)', () => {
      const engine = yoloEngine();
      expect(engine.evaluate('ShellTool', { command: 'rm -rf /' })).toBe(
        PolicyDecision.DENY,
      );
    });

    it('does NOT force DENY for the "shell" tool name because it is not in SHELL_TOOL_NAMES (run_shell_command/ShellTool)', () => {
      // 'shell' is an exported constant but is NOT the production shell tool
      // invocation name (which is 'run_shell_command'), so it is not in
      // SHELL_TOOL_NAMES and the guard intentionally does not fire.
      const engine = new PolicyEngine();
      expect(engine.evaluate('shell', { command: 'rm -rf /' })).toBe(
        PolicyDecision.ASK_USER,
      );
    });

    it('does NOT force DENY for "shell" even under an ALLOW rule', () => {
      const engine = new PolicyEngine({
        rules: [
          { toolName: 'shell', decision: PolicyDecision.ALLOW, priority: 2 },
        ],
      });
      // 'shell' is not in SHELL_TOOL_NAMES, so the disabled-list does not
      // apply and the ALLOW rule wins.
      expect(engine.evaluate('shell', { command: 'rm -rf /' })).toBe(
        PolicyDecision.ALLOW,
      );
    });
  });

  describe('precedence over explicit ALLOW matching destructive command', () => {
    it('denies mkfs even when an explicit ALLOW rule would match', () => {
      const engine = new PolicyEngine({
        rules: [
          {
            toolName: 'run_shell_command',
            argsPattern: /"command":"mkfs(?:[\s"]|$)/,
            decision: PolicyDecision.ALLOW,
            priority: 3,
          },
        ],
      });
      expect(
        engine.evaluate('run_shell_command', { command: 'mkfs /dev/sdb' }),
      ).toBe(PolicyDecision.DENY);
    });
  });

  describe('non-string command args do not crash', () => {
    it('returns a normal decision (not a throw) when command is a number', () => {
      const engine = yoloEngine();
      expect(engine.evaluate('run_shell_command', { command: 123 })).toBe(
        PolicyDecision.ALLOW,
      );
    });

    it('returns a normal decision (not a throw) when command is absent', () => {
      const engine = yoloEngine();
      expect(engine.evaluate('run_shell_command', {})).toBe(
        PolicyDecision.ALLOW,
      );
    });

    it('ALLOWS an empty string command under YOLO (not destructive)', () => {
      const engine = yoloEngine();
      expect(engine.evaluate('run_shell_command', { command: '' })).toBe(
        PolicyDecision.ALLOW,
      );
    });

    it('ALLOWS a whitespace-only command under YOLO (not destructive)', () => {
      const engine = yoloEngine();
      expect(engine.evaluate('run_shell_command', { command: '   ' })).toBe(
        PolicyDecision.ALLOW,
      );
    });
  });

  describe('dd / credential / fork-bomb patterns are denied under YOLO', () => {
    it('denies dd if=/dev/zero of=/dev/sda under YOLO wildcard', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', {
          command: 'dd if=/dev/zero of=/dev/sda',
        }),
      ).toBe(PolicyDecision.DENY);
    });

    it('denies tee ~/.ssh/authorized_keys (credential write) under YOLO wildcard', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', {
          command: 'tee ~/.ssh/authorized_keys',
        }),
      ).toBe(PolicyDecision.DENY);
    });

    it('denies echo x > ~/.aws/credentials (credential redirect) under YOLO wildcard', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', {
          command: 'echo x > ~/.aws/credentials',
        }),
      ).toBe(PolicyDecision.DENY);
    });

    it('denies fork bomb :(){ :|:& };: under YOLO wildcard', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', {
          command: ':(){ :|:& };:',
        }),
      ).toBe(PolicyDecision.DENY);
    });

    it('denies mkfs.vfat /dev/sdc under YOLO wildcard', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', {
          command: 'mkfs.vfat /dev/sdc',
        }),
      ).toBe(PolicyDecision.DENY);
    });

    it('does NOT deny dd to a safe pseudo-device under YOLO wildcard', () => {
      const engine = yoloEngine();
      expect(
        engine.evaluate('run_shell_command', {
          command: 'dd if=/dev/zero of=/dev/null',
        }),
      ).toBe(PolicyDecision.ALLOW);
    });
  });
});
