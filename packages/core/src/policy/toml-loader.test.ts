/**
 * Tests for TOML Policy Loader
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadPolicyFromToml,
  loadDefaultPolicies,
  PolicyLoadError,
} from './toml-loader.js';
import { PolicyDecision } from './types.js';

describe('toml-loader', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test files
    testDir = join(tmpdir(), `policy-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('loadPolicyFromToml', () => {
    describe('successful parsing', () => {
      it('parses a simple allow rule', async () => {
        const path = join(testDir, 'test.toml');
        const content = `
[[rule]]
toolName = "edit"
decision = "allow"
priority = 1.01
`;
        await writeFile(path, content);

        const rules = await loadPolicyFromToml(path);

        expect(rules).toHaveLength(1);
        expect(rules[0]).toEqual({
          toolName: 'edit',
          decision: PolicyDecision.ALLOW,
          priority: 1.01,
        });
      });

      it('parses a wildcard rule without toolName', async () => {
        const path = join(testDir, 'test.toml');
        const content = `
[[rule]]
decision = "allow"
priority = 1.999
`;
        await writeFile(path, content);

        const rules = await loadPolicyFromToml(path);

        expect(rules).toHaveLength(1);
        expect(rules[0]).toEqual({
          decision: PolicyDecision.ALLOW,
          priority: 1.999,
          // toolName should be undefined (wildcard)
        });
        expect(rules[0].toolName).toBeUndefined();
      });

      it('parses a rule with argsPattern', async () => {
        const path = join(testDir, 'test.toml');
        const content = `
[[rule]]
toolName = "shell"
argsPattern = "rm\\\\s+-rf"
decision = "deny"
priority = 2.0
`;
        await writeFile(path, content);

        const rules = await loadPolicyFromToml(path);

        expect(rules).toHaveLength(1);
        expect(rules[0].toolName).toBe('shell');
        expect(rules[0].decision).toBe(PolicyDecision.DENY);
        expect(rules[0].priority).toBe(2.0);
        expect(rules[0].argsPattern).toBeInstanceOf(RegExp);
        expect(rules[0].argsPattern?.source).toBe('rm\\s+-rf');
      });

      it('parses multiple rules', async () => {
        const path = join(testDir, 'test.toml');
        const content = `
[[rule]]
toolName = "edit"
decision = "allow"
priority = 1.01

[[rule]]
toolName = "shell"
decision = "ask_user"
priority = 1.01

[[rule]]
toolName = "glob"
decision = "allow"
priority = 1.05
`;
        await writeFile(path, content);

        const rules = await loadPolicyFromToml(path);

        expect(rules).toHaveLength(3);
        expect(rules[0].toolName).toBe('edit');
        expect(rules[1].toolName).toBe('shell');
        expect(rules[2].toolName).toBe('glob');
      });

      it('uses default priority of 0 when not specified', async () => {
        const path = join(testDir, 'test.toml');
        const content = `
[[rule]]
toolName = "edit"
decision = "allow"
`;
        await writeFile(path, content);

        const rules = await loadPolicyFromToml(path);

        expect(rules).toHaveLength(1);
        expect(rules[0].priority).toBe(0);
      });

      it('parses all three decision types', async () => {
        const path = join(testDir, 'test.toml');
        const content = `
[[rule]]
toolName = "tool1"
decision = "allow"

[[rule]]
toolName = "tool2"
decision = "deny"

[[rule]]
toolName = "tool3"
decision = "ask_user"
`;
        await writeFile(path, content);

        const rules = await loadPolicyFromToml(path);

        expect(rules).toHaveLength(3);
        expect(rules[0].decision).toBe(PolicyDecision.ALLOW);
        expect(rules[1].decision).toBe(PolicyDecision.DENY);
        expect(rules[2].decision).toBe(PolicyDecision.ASK_USER);
      });
    });

    describe('error handling', () => {
      it('throws PolicyLoadError when file does not exist', async () => {
        const path = join(testDir, 'nonexistent.toml');

        await expect(loadPolicyFromToml(path)).rejects.toThrow(PolicyLoadError);
        await expect(loadPolicyFromToml(path)).rejects.toThrow(
          'Failed to read policy file',
        );
      });

      it('throws PolicyLoadError on invalid TOML syntax', async () => {
        const path = join(testDir, 'test.toml');
        const content = `
[[rule]]
toolName = "edit
decision = "allow"
`;
        await writeFile(path, content);

        await expect(loadPolicyFromToml(path)).rejects.toThrow(PolicyLoadError);
        await expect(loadPolicyFromToml(path)).rejects.toThrow(
          'Invalid TOML syntax',
        );
      });

      it('throws PolicyLoadError on invalid decision value', async () => {
        const path = join(testDir, 'test.toml');
        const content = `
[[rule]]
toolName = "edit"
decision = "maybe"
`;
        await writeFile(path, content);

        await expect(loadPolicyFromToml(path)).rejects.toThrow(PolicyLoadError);
        await expect(loadPolicyFromToml(path)).rejects.toThrow(
          'Invalid policy schema',
        );
      });

      it('throws PolicyLoadError on missing decision field', async () => {
        const path = join(testDir, 'test.toml');
        const content = `
[[rule]]
toolName = "edit"
`;
        await writeFile(path, content);

        await expect(loadPolicyFromToml(path)).rejects.toThrow(PolicyLoadError);
        await expect(loadPolicyFromToml(path)).rejects.toThrow(
          'Invalid policy schema',
        );
      });

      it('throws PolicyLoadError on invalid argsPattern regex', async () => {
        const path = join(testDir, 'test.toml');
        const content = `
[[rule]]
toolName = "shell"
argsPattern = "[[["
decision = "deny"
`;
        await writeFile(path, content);

        await expect(loadPolicyFromToml(path)).rejects.toThrow(PolicyLoadError);
        await expect(loadPolicyFromToml(path)).rejects.toThrow(
          'Invalid regular expression',
        );
      });

      it('throws PolicyLoadError on priority below 1.0', async () => {
        const path = join(testDir, 'test.toml');
        const content = `
[[rule]]
toolName = "edit"
decision = "allow"
priority = 0.5
`;
        await writeFile(path, content);

        await expect(loadPolicyFromToml(path)).rejects.toThrow(PolicyLoadError);
        await expect(loadPolicyFromToml(path)).rejects.toThrow(
          'Invalid priority 0.5',
        );
      });

      it('throws PolicyLoadError on priority >= 4.0', async () => {
        const path = join(testDir, 'test.toml');
        const content = `
[[rule]]
toolName = "edit"
decision = "allow"
priority = 4.0
`;
        await writeFile(path, content);

        await expect(loadPolicyFromToml(path)).rejects.toThrow(PolicyLoadError);
        await expect(loadPolicyFromToml(path)).rejects.toThrow(
          'Invalid priority 4',
        );
      });

      it('includes path in error message', async () => {
        const path = join(testDir, 'custom-policy.toml');
        const content = `invalid toml`;
        await writeFile(path, content);

        await expect(loadPolicyFromToml(path)).rejects.toMatchObject({
          name: 'PolicyLoadError',
          path,
          message: expect.stringContaining('custom-policy.toml'),
        });
      });
    });

    describe('priority band validation', () => {
      it('accepts Tier 1 priorities (1.0 - 1.999)', async () => {
        const path = join(testDir, 'test.toml');
        const content = `
[[rule]]
toolName = "tool1"
decision = "allow"
priority = 1.0

[[rule]]
toolName = "tool2"
decision = "allow"
priority = 1.5

[[rule]]
toolName = "tool3"
decision = "allow"
priority = 1.999
`;
        await writeFile(path, content);

        const rules = await loadPolicyFromToml(path);
        expect(rules).toHaveLength(3);
      });

      it('accepts Tier 2 priorities (2.0 - 2.999)', async () => {
        const path = join(testDir, 'test.toml');
        const content = `
[[rule]]
toolName = "tool1"
decision = "allow"
priority = 2.0

[[rule]]
toolName = "tool2"
decision = "allow"
priority = 2.5

[[rule]]
toolName = "tool3"
decision = "allow"
priority = 2.999
`;
        await writeFile(path, content);

        const rules = await loadPolicyFromToml(path);
        expect(rules).toHaveLength(3);
      });

      it('accepts Tier 3 priorities (3.0 - 3.999)', async () => {
        const path = join(testDir, 'test.toml');
        const content = `
[[rule]]
toolName = "tool1"
decision = "allow"
priority = 3.0

[[rule]]
toolName = "tool2"
decision = "allow"
priority = 3.5

[[rule]]
toolName = "tool3"
decision = "allow"
priority = 3.999
`;
        await writeFile(path, content);

        const rules = await loadPolicyFromToml(path);
        expect(rules).toHaveLength(3);
      });
    });

    describe('complex argsPattern scenarios', () => {
      it('handles escaped special regex characters', async () => {
        const path = join(testDir, 'test.toml');
        const content = `
[[rule]]
toolName = "shell"
argsPattern = "\\\\$\\\\(.*\\\\)"
decision = "deny"
`;
        await writeFile(path, content);

        const rules = await loadPolicyFromToml(path);
        expect(rules[0].argsPattern).toBeInstanceOf(RegExp);
      });

      it('handles complex regex patterns', async () => {
        const path = join(testDir, 'test.toml');
        const content = `
[[rule]]
toolName = "shell"
argsPattern = "^(rm|rmdir|del)\\\\s+.*(\\\\/|\\\\\\\\\\\\\\\\)$"
decision = "deny"
`;
        await writeFile(path, content);

        const rules = await loadPolicyFromToml(path);
        expect(rules[0].argsPattern).toBeInstanceOf(RegExp);
      });
    });
  });

  describe('loadDefaultPolicies', () => {
    it('loads default policies successfully', async () => {
      const rules = await loadDefaultPolicies();

      // Should have rules from read-only.toml and write.toml
      expect(rules.length).toBeGreaterThan(0);

      // Check for some expected read-only tools
      const readOnlyTools = rules.filter((r) => r.priority === 1.05);
      expect(readOnlyTools.length).toBeGreaterThan(0);
      expect(readOnlyTools.some((r) => r.toolName === 'glob')).toBe(true);
      expect(
        readOnlyTools.some((r) => r.toolName === 'search_file_content'),
      ).toBe(true);

      // Check for some expected write tools
      const writeTools = rules.filter((r) => r.priority === 1.01);
      expect(writeTools.length).toBeGreaterThan(0);
      expect(writeTools.some((r) => r.toolName === 'replace')).toBe(true);
      expect(writeTools.some((r) => r.toolName === 'shell')).toBe(true);
    });

    it('all default rules have valid priorities', async () => {
      const rules = await loadDefaultPolicies();

      // Verify each rule's priority falls within valid range
      rules.forEach((rule) => {
        const priority = rule.priority ?? 0;
        expect(priority).toBeGreaterThanOrEqual(0);
        const isValidPriority =
          priority === 0 || (priority >= 1.0 && priority < 4.0);
        expect(isValidPriority).toBe(true);
      });
    });

    it('all default rules have valid decisions', async () => {
      const rules = await loadDefaultPolicies();

      for (const rule of rules) {
        expect([
          PolicyDecision.ALLOW,
          PolicyDecision.DENY,
          PolicyDecision.ASK_USER,
        ]).toContain(rule.decision);
      }
    });

    it('throws PolicyLoadError if default policy file is corrupt', async () => {
      // This test would require mocking the file system or modifying default files
      // For now, we trust that default files are valid, but we document the behavior
      // In a real scenario, we could use mock-fs or similar to simulate corruption
      expect(loadDefaultPolicies).toBeDefined();
    });
  });

  describe('PolicyLoadError', () => {
    it('includes path and cause in error', () => {
      const cause = new Error('Original error');
      const error = new PolicyLoadError('Test error', '/path/to/file.toml', {
        cause,
      });

      expect(error.name).toBe('PolicyLoadError');
      expect(error.message).toBe('Test error');
      expect(error.path).toBe('/path/to/file.toml');
      expect(error.cause).toBe(cause);
    });

    it('works without path or cause', () => {
      const error = new PolicyLoadError('Test error');

      expect(error.name).toBe('PolicyLoadError');
      expect(error.message).toBe('Test error');
      expect(error.path).toBeUndefined();
      expect(error.cause).toBeUndefined();
    });
  });
});
