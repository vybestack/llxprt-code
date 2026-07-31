/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import toml from '@iarna/toml';
import { Storage } from '@vybestack/llxprt-code-settings';
import {
  PolicyEngine,
  PolicyDecision,
  type ApprovalMode,
} from '@vybestack/llxprt-code-policy';
import {
  listEditableRules,
  addEditableRule,
  updateEditableRule,
  deleteEditableRule,
  duplicateEditableRule,
  reloadUserPolicyRules,
  MANAGED_POLICY_FILE,
  type EditablePolicyRule,
} from './userPolicyStore.js';

describe('userPolicyStore', () => {
  let tmpDir = '';

  beforeEach(() => {
    tmpDir = fsSync.mkdtempSync(
      path.join(os.tmpdir(), 'llxprt-policy-store-test-'),
    );
    vi.spyOn(Storage, 'getUserPoliciesDir').mockReturnValue(tmpDir);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  function managedPath(): string {
    return path.join(tmpDir, MANAGED_POLICY_FILE);
  }

  async function writeFile(content: string): Promise<void> {
    await fs.writeFile(managedPath(), content, 'utf-8');
  }

  async function readFile(): Promise<string> {
    return fs.readFile(managedPath(), 'utf-8');
  }

  describe('listEditableRules', () => {
    it('returns an empty array when the file does not exist', async () => {
      const rules = await listEditableRules();
      expect(rules).toStrictEqual([]);
    });

    it('reads rules from the managed file', async () => {
      await writeFile(`
[[rule]]
toolName = "edit"
decision = "allow"
priority = 100

[[rule]]
decision = "deny"
priority = 50
`);
      const rules = await listEditableRules();
      expect(rules).toHaveLength(2);
      expect(rules[0]).toStrictEqual({
        toolName: 'edit',
        decision: PolicyDecision.ALLOW,
        priority: 100,
      });
      expect(rules[1]).toStrictEqual({
        toolName: '',
        decision: PolicyDecision.DENY,
        priority: 50,
      });
    });

    it('reads argsPattern when present', async () => {
      await writeFile(`
[[rule]]
toolName = "run_shell_command"
decision = "allow"
priority = 100
argsPattern = "git status"
`);
      const rules = await listEditableRules();
      expect(rules[0].argsPattern).toBe('git status');
    });
  });

  describe('addEditableRule', () => {
    it('creates the file when it does not exist', async () => {
      const rule: EditablePolicyRule = {
        toolName: 'edit',
        decision: PolicyDecision.ALLOW,
        priority: 100,
      };

      await addEditableRule(rule);

      const content = await readFile();
      const parsed = toml.parse(content) as { rule: unknown[] };
      expect(parsed.rule).toHaveLength(1);
    });

    it('appends to existing rules', async () => {
      await writeFile(`
[[rule]]
toolName = "edit"
decision = "allow"
priority = 100
`);
      await addEditableRule({
        toolName: 'glob',
        decision: PolicyDecision.DENY,
        priority: 50,
      });

      const rules = await listEditableRules();
      expect(rules).toHaveLength(2);
      expect(rules[1].toolName).toBe('glob');
    });

    it('writes argsPattern to the file', async () => {
      await addEditableRule({
        toolName: 'run_shell_command',
        decision: PolicyDecision.ALLOW,
        priority: 100,
        argsPattern: 'git status',
      });

      const content = await readFile();
      expect(content).toContain('argsPattern = "git status"');
    });

    it('uses an atomic write (no leftover tmp file)', async () => {
      await addEditableRule({
        toolName: 'edit',
        decision: PolicyDecision.ALLOW,
        priority: 100,
      });

      // The .tmp file should not remain after the atomic rename completes.
      const tmpExists = await fs
        .access(`${managedPath()}.tmp`)
        .then(() => true)
        .catch(() => false);
      expect(tmpExists).toBe(false);

      // And the managed file should contain the rule.
      const content = await readFile();
      expect(content).toContain('toolName = "edit"');
    });
  });

  describe('updateEditableRule', () => {
    it('replaces the rule at the given index', async () => {
      await writeFile(`
[[rule]]
toolName = "edit"
decision = "allow"
priority = 100

[[rule]]
toolName = "glob"
decision = "deny"
priority = 50
`);
      await updateEditableRule(0, {
        toolName: 'edit',
        decision: PolicyDecision.DENY,
        priority: 200,
      });

      const rules = await listEditableRules();
      expect(rules[0].decision).toBe(PolicyDecision.DENY);
      expect(rules[0].priority).toBe(200);
      expect(rules[1].toolName).toBe('glob');
    });

    it('throws on an out-of-bounds index', async () => {
      await expect(
        updateEditableRule(99, {
          toolName: 'edit',
          decision: PolicyDecision.ALLOW,
          priority: 100,
        }),
      ).rejects.toThrow('Cannot update rule at index 99');
    });
  });

  describe('deleteEditableRule', () => {
    it('removes the rule at the given index', async () => {
      await writeFile(`
[[rule]]
toolName = "edit"
decision = "allow"
priority = 100

[[rule]]
toolName = "glob"
decision = "deny"
priority = 50
`);
      await deleteEditableRule(0);

      const rules = await listEditableRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].toolName).toBe('glob');
    });

    it('throws on an out-of-bounds index', async () => {
      await expect(deleteEditableRule(99)).rejects.toThrow(
        'Cannot delete rule at index 99',
      );
    });
  });

  describe('duplicateEditableRule', () => {
    it('copies the rule to the end of the file', async () => {
      await writeFile(`
[[rule]]
toolName = "edit"
decision = "allow"
priority = 100
`);
      await duplicateEditableRule(0);

      const rules = await listEditableRules();
      expect(rules).toHaveLength(2);
      expect(rules[1]).toStrictEqual(rules[0]);
    });

    it('throws on an out-of-bounds index', async () => {
      await expect(duplicateEditableRule(99)).rejects.toThrow(
        'Cannot duplicate rule at index 99',
      );
    });
  });

  describe('reloadUserPolicyRules', () => {
    it('replaces user-tier rules while preserving other rules', async () => {
      const engine = new PolicyEngine({
        rules: [
          {
            toolName: 'edit',
            decision: PolicyDecision.ALLOW,
            priority: 1.05,
            source: 'Default: defaults.toml',
          },
          {
            toolName: 'old-user-rule',
            decision: PolicyDecision.DENY,
            priority: 2.1,
            source: `User: ${MANAGED_POLICY_FILE}`,
          },
        ],
      });

      // Write a fresh user rule to disk
      await writeFile(`
[[rule]]
toolName = "new-user-rule"
decision = "allow"
priority = 100
`);

      await reloadUserPolicyRules(engine, 'default' as ApprovalMode);

      const rules = engine.getRules();
      const toolNames = rules.map((r) => r.toolName);
      // Default rule preserved
      expect(toolNames).toContain('edit');
      // Old user rule removed
      expect(toolNames).not.toContain('old-user-rule');
      // New user rule loaded
      expect(toolNames).toContain('new-user-rule');
    });

    it('reflects the reloaded rules in evaluate()', async () => {
      const engine = new PolicyEngine({
        rules: [],
        defaultDecision: PolicyDecision.ASK_USER,
      });

      await writeFile(`
[[rule]]
toolName = "edit"
decision = "allow"
priority = 100
`);

      expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ASK_USER);

      await reloadUserPolicyRules(engine, 'default' as ApprovalMode);

      expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ALLOW);
    });

    it('handles an empty user directory gracefully', async () => {
      const engine = new PolicyEngine({
        rules: [
          {
            toolName: 'edit',
            decision: PolicyDecision.ALLOW,
            priority: 1.05,
            source: 'Default: defaults.toml',
          },
        ],
      });

      await reloadUserPolicyRules(engine, 'default' as ApprovalMode);

      // Default rule preserved, no user rules added
      expect(engine.getRules()).toHaveLength(1);
    });

    it('throws when the user TOML is malformed', async () => {
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, 'broken.toml'),
        'this is not valid toml {{{',
      );

      const engine = new PolicyEngine({
        rules: [
          {
            toolName: 'edit',
            decision: PolicyDecision.ALLOW,
            priority: 2.1,
            source: 'User: auto-saved.toml',
          },
        ],
      });

      await expect(
        reloadUserPolicyRules(engine, 'default' as ApprovalMode),
      ).rejects.toThrow('Failed to reload user policy rules');
    });
  });

  describe('priority validation', () => {
    it('rejects a priority above 999', async () => {
      await expect(
        addEditableRule({
          toolName: 'edit',
          decision: PolicyDecision.ALLOW,
          priority: 1000,
        }),
      ).rejects.toThrow('priority must be an integer');
    });

    it('rejects a negative priority', async () => {
      await expect(
        addEditableRule({
          toolName: 'edit',
          decision: PolicyDecision.ALLOW,
          priority: -1,
        }),
      ).rejects.toThrow('priority must be an integer');
    });

    it('rejects a non-integer priority', async () => {
      await expect(
        addEditableRule({
          toolName: 'edit',
          decision: PolicyDecision.ALLOW,
          priority: 50.5,
        }),
      ).rejects.toThrow('priority must be an integer');
    });
  });

  describe('field preservation', () => {
    it('preserves commandPrefix when updating other fields', async () => {
      await fs.writeFile(
        managedPath(),
        toml.stringify({
          rule: [
            {
              toolName: 'run_shell_command',
              decision: 'allow',
              priority: 100,
              commandPrefix: 'git status',
            },
          ],
        } as toml.JsonMap),
      );

      await updateEditableRule(0, {
        toolName: 'run_shell_command',
        decision: PolicyDecision.DENY,
        priority: 50,
      });

      const content = toml.parse(await fs.readFile(managedPath(), 'utf-8')) as {
        rule: Array<Record<string, unknown>>;
      };
      expect(content.rule[0]?.commandPrefix).toBe('git status');
      expect(content.rule[0]?.decision).toBe('deny');
    });

    it('preserves mcpName when duplicating a rule', async () => {
      await fs.writeFile(
        managedPath(),
        toml.stringify({
          rule: [
            {
              toolName: 'search',
              mcpName: 'jira',
              decision: 'allow',
              priority: 200,
            },
          ],
        } as toml.JsonMap),
      );

      await duplicateEditableRule(0);

      const content = toml.parse(await fs.readFile(managedPath(), 'utf-8')) as {
        rule: Array<Record<string, unknown>>;
      };
      expect(content.rule).toHaveLength(2);
      expect(content.rule[1]?.mcpName).toBe('jira');
      expect(content.rule[1]?.toolName).toBe('search');
    });
  });
});
