/**
 * Tests for Policy Configuration
 */

import { describe, it, expect } from 'vitest';
import {
  migrateLegacyApprovalMode,
  createPolicyEngineConfig,
  type PolicyConfigSource,
} from './config.js';
import { PolicyDecision } from './types.js';
import { ApprovalMode } from '../config/config.js';
import { PolicyEngine } from './policy-engine.js';

/**
 * Creates a mock config for testing
 */
function createMockConfig(options: {
  approvalMode?: ApprovalMode;
  allowedTools?: string[];
  nonInteractive?: boolean;
  userPolicyPath?: string;
}): PolicyConfigSource {
  return {
    getApprovalMode: () => options.approvalMode ?? ApprovalMode.DEFAULT,
    getAllowedTools: () => options.allowedTools,
    getNonInteractive: () => options.nonInteractive ?? false,
    getUserPolicyPath: () => options.userPolicyPath,
  };
}

describe('policy config', () => {
  describe('migrateLegacyApprovalMode', () => {
    describe('ApprovalMode.YOLO', () => {
      it('converts YOLO to wildcard allow-all at priority 1.999', () => {
        const config = createMockConfig({ approvalMode: ApprovalMode.YOLO });
        const rules = migrateLegacyApprovalMode(config);

        expect(rules).toHaveLength(1);
        expect(rules[0]).toEqual({
          // toolName undefined = wildcard
          decision: PolicyDecision.ALLOW,
          priority: 1.999,
        });
        expect(rules[0].toolName).toBeUndefined();
      });

      it('wildcard rule matches all tools', () => {
        const config = createMockConfig({ approvalMode: ApprovalMode.YOLO });
        const rules = migrateLegacyApprovalMode(config);

        // Verify the rule has no toolName (wildcard)
        expect(rules[0].toolName).toBeUndefined();
      });
    });

    describe('ApprovalMode.AUTO_EDIT', () => {
      it('converts AUTO_EDIT to write tool rules at priority 1.015', () => {
        const config = createMockConfig({
          approvalMode: ApprovalMode.AUTO_EDIT,
        });
        const rules = migrateLegacyApprovalMode(config);

        // Should have rules for edit tools
        expect(rules.length).toBeGreaterThanOrEqual(4);

        const replaceRule = rules.find((r) => r.toolName === 'replace');
        expect(replaceRule).toEqual({
          toolName: 'replace',
          decision: PolicyDecision.ALLOW,
          priority: 1.015,
        });
      });

      it('includes all expected write tools', () => {
        const config = createMockConfig({
          approvalMode: ApprovalMode.AUTO_EDIT,
        });
        const rules = migrateLegacyApprovalMode(config);

        const toolNames = rules.map((r) => r.toolName);
        expect(toolNames).toContain('replace');
        expect(toolNames).toContain('write_file');
        expect(toolNames).toContain('insert_at_line');
        expect(toolNames).toContain('delete_line_range');
      });
    });

    describe('ApprovalMode.DEFAULT', () => {
      it('returns empty array for DEFAULT mode', () => {
        const config = createMockConfig({ approvalMode: ApprovalMode.DEFAULT });
        const rules = migrateLegacyApprovalMode(config);

        // DEFAULT mode doesn't add any legacy rules
        expect(rules).toHaveLength(0);
      });
    });

    describe('--allowed-tools migration', () => {
      it('converts --allowed-tools to rules at priority 2.3', () => {
        const config = createMockConfig({
          allowedTools: ['edit', 'shell'],
        });
        const rules = migrateLegacyApprovalMode(config);

        expect(rules).toHaveLength(2);
        expect(rules[0]).toEqual({
          toolName: 'edit',
          decision: PolicyDecision.ALLOW,
          priority: 2.3,
        });
        expect(rules[1]).toEqual({
          toolName: 'shell',
          decision: PolicyDecision.ALLOW,
          priority: 2.3,
        });
      });

      it('handles empty allowed tools list', () => {
        const config = createMockConfig({
          allowedTools: [],
        });
        const rules = migrateLegacyApprovalMode(config);

        expect(rules).toHaveLength(0);
      });

      it('handles undefined allowed tools', () => {
        const config = createMockConfig({
          allowedTools: undefined,
        });
        const rules = migrateLegacyApprovalMode(config);

        expect(rules).toHaveLength(0);
      });

      it('creates rules for each tool in allowed list', () => {
        const config = createMockConfig({
          allowedTools: ['glob', 'grep', 'ls', 'read_file'],
        });
        const rules = migrateLegacyApprovalMode(config);

        expect(rules).toHaveLength(4);
        const toolNames = rules.map((r) => r.toolName);
        expect(toolNames).toEqual(['glob', 'grep', 'ls', 'read_file']);
      });

      it('normalizes ShellTool alias to run_shell_command', () => {
        const config = createMockConfig({
          allowedTools: ['ShellTool'],
        });
        const rules = migrateLegacyApprovalMode(config);

        expect(rules).toHaveLength(1);
        expect(rules[0]?.toolName).toBe('run_shell_command');
      });

      it('normalizes ShellTool subcommand syntax to run_shell_command', () => {
        const config = createMockConfig({
          allowedTools: ['ShellTool(wc)'],
        });
        const rules = migrateLegacyApprovalMode(config);

        expect(rules).toHaveLength(1);
        expect(rules[0]?.toolName).toBe('run_shell_command');
      });

      it('normalizes run_shell_command subcommand syntax to run_shell_command', () => {
        const config = createMockConfig({
          allowedTools: ['run_shell_command(wc)'],
        });
        const rules = migrateLegacyApprovalMode(config);

        expect(rules).toHaveLength(1);
        expect(rules[0]?.toolName).toBe('run_shell_command');
      });
    });

    describe('combined scenarios', () => {
      it('combines YOLO mode with allowed tools', () => {
        const config = createMockConfig({
          approvalMode: ApprovalMode.YOLO,
          allowedTools: ['edit'],
        });
        const rules = migrateLegacyApprovalMode(config);

        // YOLO wildcard + 1 allowed tool
        expect(rules).toHaveLength(2);

        const yoloRule = rules.find((r) => r.priority === 1.999);
        expect(yoloRule?.toolName).toBeUndefined();

        const allowedRule = rules.find((r) => r.priority === 2.3);
        expect(allowedRule?.toolName).toBe('edit');
      });

      it('combines AUTO_EDIT with allowed tools', () => {
        const config = createMockConfig({
          approvalMode: ApprovalMode.AUTO_EDIT,
          allowedTools: ['glob', 'grep'],
        });
        const rules = migrateLegacyApprovalMode(config);

        // 4 AUTO_EDIT tools + 2 allowed tools
        expect(rules.length).toBe(6);

        const autoEditRules = rules.filter((r) => r.priority === 1.015);
        expect(autoEditRules.length).toBe(4);

        const allowedRules = rules.filter((r) => r.priority === 2.3);
        expect(allowedRules.length).toBe(2);
      });
    });
  });

  describe('createPolicyEngineConfig', () => {
    it('loads default policies', async () => {
      const config = createMockConfig({});
      const engineConfig = await createPolicyEngineConfig(config);

      // Should have rules from read-only.toml and write.toml
      expect(engineConfig.rules.length).toBeGreaterThan(0);

      // Check for some expected defaults
      const hasReadOnlyTools = engineConfig.rules.some(
        (r) => r.toolName === 'glob' && r.priority === 1.05,
      );
      const hasWriteTools = engineConfig.rules.some(
        (r) => r.toolName === 'replace' && r.priority === 1.01,
      );

      expect(hasReadOnlyTools).toBe(true);
      expect(hasWriteTools).toBe(true);
    });

    it('includes legacy migration rules', async () => {
      const config = createMockConfig({
        approvalMode: ApprovalMode.YOLO,
      });
      const engineConfig = await createPolicyEngineConfig(config);

      // Should have default rules + YOLO wildcard rule
      const yoloRule = engineConfig.rules.find((r) => r.priority === 1.999);
      expect(yoloRule).toBeDefined();
      expect(yoloRule?.decision).toBe(PolicyDecision.ALLOW);
      expect(yoloRule?.toolName).toBeUndefined();
    });

    it('sets default decision to ASK_USER', async () => {
      const config = createMockConfig({});
      const engineConfig = await createPolicyEngineConfig(config);

      expect(engineConfig.defaultDecision).toBe(PolicyDecision.ASK_USER);
    });

    it('sets nonInteractive from config', async () => {
      const config = createMockConfig({ nonInteractive: true });
      const engineConfig = await createPolicyEngineConfig(config);

      expect(engineConfig.nonInteractive).toBe(true);
    });

    it('handles missing getUserPolicyPath method', async () => {
      const config = createMockConfig({});
      // Remove the optional method
      delete (config as Partial<PolicyConfigSource>).getUserPolicyPath;

      // Should not throw
      const engineConfig = await createPolicyEngineConfig(config);
      expect(engineConfig).toBeDefined();
    });

    it('gracefully handles invalid user policy path', async () => {
      const config = createMockConfig({
        userPolicyPath: '/nonexistent/path/to/policy.toml',
      });

      // Should log warning but not throw
      const engineConfig = await createPolicyEngineConfig(config);
      expect(engineConfig).toBeDefined();
      // Default rules should still be loaded
      expect(engineConfig.rules.length).toBeGreaterThan(0);
    });
  });

  describe('priority precedence with PolicyEngine integration', () => {
    it('--allowed-tools overrides AUTO_EDIT (priority 2.3 > 1.015)', async () => {
      const config = createMockConfig({
        approvalMode: ApprovalMode.AUTO_EDIT,
        allowedTools: ['glob'], // read-only tool, not in AUTO_EDIT set
      });

      const engineConfig = await createPolicyEngineConfig(config);
      const engine = new PolicyEngine(engineConfig);

      // glob should be allowed due to --allowed-tools at priority 2.3
      // (which overrides default read-only.toml at priority 1.05)
      expect(engine.evaluate('glob', {})).toBe(PolicyDecision.ALLOW);
    });

    it('YOLO mode allows all tools (priority 1.999)', async () => {
      const config = createMockConfig({
        approvalMode: ApprovalMode.YOLO,
      });

      const engineConfig = await createPolicyEngineConfig(config);
      const engine = new PolicyEngine(engineConfig);

      // All tools should be allowed due to wildcard rule
      expect(engine.evaluate('replace', {})).toBe(PolicyDecision.ALLOW);
      expect(engine.evaluate('shell', {})).toBe(PolicyDecision.ALLOW);
      expect(engine.evaluate('unknown_tool', {})).toBe(PolicyDecision.ALLOW);
    });

    it('AUTO_EDIT allows write tools but asks for read tools', async () => {
      const config = createMockConfig({
        approvalMode: ApprovalMode.AUTO_EDIT,
      });

      const engineConfig = await createPolicyEngineConfig(config);
      const engine = new PolicyEngine(engineConfig);

      // Edit tools should be allowed
      expect(engine.evaluate('replace', {})).toBe(PolicyDecision.ALLOW);

      // Non-edit tools follow default policy stack
      expect(engine.evaluate('shell', {})).toBe(PolicyDecision.ASK_USER);

      // Read-only tools allowed by default
      expect(engine.evaluate('glob', {})).toBe(PolicyDecision.ALLOW);
      expect(engine.evaluate('search_file_content', {})).toBe(
        PolicyDecision.ALLOW,
      );
    });

    it('DEFAULT mode uses standard policy stack', async () => {
      const config = createMockConfig({
        approvalMode: ApprovalMode.DEFAULT,
      });

      const engineConfig = await createPolicyEngineConfig(config);
      const engine = new PolicyEngine(engineConfig);

      // Read-only tools allowed by default policies
      expect(engine.evaluate('glob', {})).toBe(PolicyDecision.ALLOW);
      expect(engine.evaluate('search_file_content', {})).toBe(
        PolicyDecision.ALLOW,
      );

      // Write tools ask user by default policies
      expect(engine.evaluate('replace', {})).toBe(PolicyDecision.ASK_USER);
      expect(engine.evaluate('shell', {})).toBe(PolicyDecision.ASK_USER);
    });

    it('higher priority wins when rules conflict', async () => {
      const config = createMockConfig({
        approvalMode: ApprovalMode.DEFAULT,
        allowedTools: ['replace'], // priority 2.3 ALLOW
      });

      const engineConfig = await createPolicyEngineConfig(config);
      const engine = new PolicyEngine(engineConfig);

      // replace should be ALLOW (priority 2.3) not ASK_USER (priority 1.01)
      expect(engine.evaluate('replace', {})).toBe(PolicyDecision.ALLOW);

      // shell should still be ASK_USER (only default policy applies)
      expect(engine.evaluate('shell', {})).toBe(PolicyDecision.ASK_USER);
    });

    it('nonInteractive converts ASK_USER to DENY', async () => {
      const config = createMockConfig({
        approvalMode: ApprovalMode.DEFAULT,
        nonInteractive: true,
      });

      const engineConfig = await createPolicyEngineConfig(config);
      const engine = new PolicyEngine(engineConfig);

      // Write tools should be DENY in non-interactive mode
      expect(engine.evaluate('replace', {})).toBe(PolicyDecision.DENY);
      expect(engine.evaluate('shell', {})).toBe(PolicyDecision.DENY);

      // Read-only tools still allowed
      expect(engine.evaluate('glob', {})).toBe(PolicyDecision.ALLOW);
    });
  });

  describe('rule merging scenarios', () => {
    it('merges all rule sources in correct priority order', async () => {
      const config = createMockConfig({
        approvalMode: ApprovalMode.AUTO_EDIT,
        allowedTools: ['custom_tool'],
      });

      const engineConfig = await createPolicyEngineConfig(config);

      // Should have:
      // - Default rules from read-only.toml (priority 1.05)
      // - Default rules from write.toml (priority 1.01)
      // - AUTO_EDIT rules (priority 1.015)
      // - allowed-tools rules (priority 2.3)
      expect(engineConfig.rules.length).toBeGreaterThan(10);

      const priorities = engineConfig.rules.map((r) => r.priority ?? 0);
      expect(priorities).toContain(1.01); // write.toml
      expect(priorities).toContain(1.015); // AUTO_EDIT
      expect(priorities).toContain(1.05); // read-only.toml
      expect(priorities).toContain(2.3); // allowed-tools
    });

    it('maintains all rules even when they conflict', async () => {
      // The engine will use highest priority, but all rules are preserved
      const config = createMockConfig({
        approvalMode: ApprovalMode.AUTO_EDIT,
        allowedTools: ['replace'], // Same tool, different priority
      });

      const engineConfig = await createPolicyEngineConfig(config);

      // Should have both:
      // - replace from write.toml (priority 1.01, ASK_USER)
      // - replace from AUTO_EDIT (priority 1.015, ALLOW)
      // - replace from allowed-tools (priority 2.3, ALLOW)
      const replaceRules = engineConfig.rules.filter(
        (r) => r.toolName === 'replace',
      );
      expect(replaceRules.length).toBeGreaterThanOrEqual(3);
    });
  });
});
