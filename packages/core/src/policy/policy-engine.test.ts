import { describe, it, expect } from 'vitest';
import { PolicyEngine } from './policy-engine.js';
import { PolicyDecision, type PolicyEngineConfig } from './types.js';

describe('PolicyEngine', () => {
  describe('constructor', () => {
    it('initializes with default values when no config provided', () => {
      const engine = new PolicyEngine();

      expect(engine.getRules()).toEqual([]);
      expect(engine.getDefaultDecision()).toBe(PolicyDecision.ASK_USER);
      expect(engine.isNonInteractive()).toBe(false);
    });

    it('initializes with provided config', () => {
      const config: PolicyEngineConfig = {
        rules: [{ toolName: 'edit', decision: PolicyDecision.ALLOW }],
        defaultDecision: PolicyDecision.DENY,
        nonInteractive: true,
      };

      const engine = new PolicyEngine(config);

      expect(engine.getRules()).toHaveLength(1);
      expect(engine.getDefaultDecision()).toBe(PolicyDecision.DENY);
      expect(engine.isNonInteractive()).toBe(true);
    });

    it('sorts rules by priority (highest first)', () => {
      const config: PolicyEngineConfig = {
        rules: [
          { toolName: 'edit', decision: PolicyDecision.ALLOW, priority: 1 },
          { toolName: 'shell', decision: PolicyDecision.DENY, priority: 3 },
          { toolName: 'glob', decision: PolicyDecision.ASK_USER, priority: 2 },
        ],
      };

      const engine = new PolicyEngine(config);
      const rules = engine.getRules();

      expect(rules[0].toolName).toBe('shell'); // priority 3
      expect(rules[1].toolName).toBe('glob'); // priority 2
      expect(rules[2].toolName).toBe('edit'); // priority 1
    });

    it('treats missing priority as 0', () => {
      const config: PolicyEngineConfig = {
        rules: [
          { toolName: 'edit', decision: PolicyDecision.ALLOW }, // priority 0
          { toolName: 'shell', decision: PolicyDecision.DENY, priority: 1 },
        ],
      };

      const engine = new PolicyEngine(config);
      const rules = engine.getRules();

      expect(rules[0].toolName).toBe('shell'); // priority 1
      expect(rules[1].toolName).toBe('edit'); // priority 0
    });
  });

  describe('evaluate', () => {
    describe('rule matching', () => {
      it('matches by tool name exactly', () => {
        const engine = new PolicyEngine({
          rules: [{ toolName: 'edit', decision: PolicyDecision.ALLOW }],
        });

        expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ALLOW);
        expect(engine.evaluate('shell', {})).toBe(PolicyDecision.ASK_USER); // default
      });

      it('wildcard rule matches all tools', () => {
        const engine = new PolicyEngine({
          rules: [{ decision: PolicyDecision.ALLOW }], // no toolName = wildcard
        });

        expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ALLOW);
        expect(engine.evaluate('shell', {})).toBe(PolicyDecision.ALLOW);
        expect(engine.evaluate('glob', {})).toBe(PolicyDecision.ALLOW);
      });

      it('matches by args pattern using regex', () => {
        const engine = new PolicyEngine({
          rules: [
            {
              toolName: 'edit',
              argsPattern: /"file_path":".*\.md"/,
              decision: PolicyDecision.ALLOW,
            },
          ],
        });

        expect(engine.evaluate('edit', { file_path: 'README.md' })).toBe(
          PolicyDecision.ALLOW,
        );
        expect(engine.evaluate('edit', { file_path: 'script.ts' })).toBe(
          PolicyDecision.ASK_USER,
        ); // default
      });

      it('matches when both tool name and args pattern match', () => {
        const engine = new PolicyEngine({
          rules: [
            {
              toolName: 'shell',
              argsPattern: /"command":"npm test"/,
              decision: PolicyDecision.ALLOW,
            },
          ],
        });

        expect(engine.evaluate('shell', { command: 'npm test' })).toBe(
          PolicyDecision.ALLOW,
        );
        expect(engine.evaluate('shell', { command: 'rm -rf /' })).toBe(
          PolicyDecision.ASK_USER,
        );
        expect(engine.evaluate('edit', { command: 'npm test' })).toBe(
          PolicyDecision.ASK_USER,
        );
      });

      it('uses first matching rule by priority', () => {
        const engine = new PolicyEngine({
          rules: [
            { toolName: 'edit', decision: PolicyDecision.ALLOW, priority: 2 },
            { toolName: 'edit', decision: PolicyDecision.DENY, priority: 1 },
          ],
        });

        expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ALLOW); // priority 2 wins
      });

      it('wildcard rule with lower priority does not override specific rule', () => {
        const engine = new PolicyEngine({
          rules: [
            { toolName: 'edit', decision: PolicyDecision.DENY, priority: 2 },
            { decision: PolicyDecision.ALLOW, priority: 1 }, // wildcard
          ],
        });

        expect(engine.evaluate('edit', {})).toBe(PolicyDecision.DENY);
        expect(engine.evaluate('shell', {})).toBe(PolicyDecision.ALLOW); // wildcard matches
      });

      it('returns default decision when no rules match', () => {
        const engine = new PolicyEngine({
          rules: [{ toolName: 'edit', decision: PolicyDecision.ALLOW }],
          defaultDecision: PolicyDecision.DENY,
        });

        expect(engine.evaluate('shell', {})).toBe(PolicyDecision.DENY);
      });
    });

    describe('non-interactive mode', () => {
      it('converts ASK_USER to DENY in non-interactive mode', () => {
        const engine = new PolicyEngine({
          rules: [{ toolName: 'edit', decision: PolicyDecision.ASK_USER }],
          nonInteractive: true,
        });

        expect(engine.evaluate('edit', {})).toBe(PolicyDecision.DENY);
      });

      it('converts default ASK_USER to DENY in non-interactive mode', () => {
        const engine = new PolicyEngine({
          rules: [],
          defaultDecision: PolicyDecision.ASK_USER,
          nonInteractive: true,
        });

        expect(engine.evaluate('edit', {})).toBe(PolicyDecision.DENY);
      });

      it('does not affect ALLOW decisions in non-interactive mode', () => {
        const engine = new PolicyEngine({
          rules: [{ toolName: 'edit', decision: PolicyDecision.ALLOW }],
          nonInteractive: true,
        });

        expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ALLOW);
      });

      it('does not affect DENY decisions in non-interactive mode', () => {
        const engine = new PolicyEngine({
          rules: [{ toolName: 'edit', decision: PolicyDecision.DENY }],
          nonInteractive: true,
        });

        expect(engine.evaluate('edit', {})).toBe(PolicyDecision.DENY);
      });
    });

    describe('server name validation', () => {
      it('allows MCP tools with matching server prefix', () => {
        const engine = new PolicyEngine({
          rules: [{ decision: PolicyDecision.ALLOW }],
        });

        expect(engine.evaluate('my-server__tool-name', {}, 'my-server')).toBe(
          PolicyDecision.ALLOW,
        );
      });

      it('denies MCP tools with mismatched server prefix', () => {
        const engine = new PolicyEngine({
          rules: [{ decision: PolicyDecision.ALLOW }],
        });

        expect(
          engine.evaluate('other-server__tool-name', {}, 'my-server'),
        ).toBe(PolicyDecision.DENY);
      });

      it('denies built-in tools when serverName is provided', () => {
        const engine = new PolicyEngine({
          rules: [{ decision: PolicyDecision.ALLOW }],
        });

        // Built-in tools should not have a serverName
        expect(engine.evaluate('edit', {}, 'fake-server')).toBe(
          PolicyDecision.DENY,
        );
      });

      it('allows built-in tools when no serverName provided', () => {
        const engine = new PolicyEngine({
          rules: [{ decision: PolicyDecision.ALLOW }],
        });

        expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ALLOW);
      });

      it('prevents server name spoofing in tool names', () => {
        const engine = new PolicyEngine({
          rules: [
            {
              toolName: 'trusted-server__tool',
              decision: PolicyDecision.ALLOW,
            },
          ],
        });

        // Attempting to spoof a trusted server name
        expect(
          engine.evaluate('trusted-server__tool', {}, 'malicious-server'),
        ).toBe(PolicyDecision.DENY);
      });
    });

    describe('args pattern matching', () => {
      it('matches complex nested args structures', () => {
        const engine = new PolicyEngine({
          rules: [
            {
              toolName: 'mcp-tool',
              argsPattern: /"nested":\{"key":"value"\}/,
              decision: PolicyDecision.ALLOW,
            },
          ],
        });

        expect(engine.evaluate('mcp-tool', { nested: { key: 'value' } })).toBe(
          PolicyDecision.ALLOW,
        );
        expect(
          engine.evaluate('mcp-tool', { nested: { key: 'different' } }),
        ).toBe(PolicyDecision.ASK_USER);
      });

      it('matches arrays in args', () => {
        const engine = new PolicyEngine({
          rules: [
            {
              toolName: 'tool',
              argsPattern: /"items":\[1,2,3\]/,
              decision: PolicyDecision.ALLOW,
            },
          ],
        });

        expect(engine.evaluate('tool', { items: [1, 2, 3] })).toBe(
          PolicyDecision.ALLOW,
        );
        expect(engine.evaluate('tool', { items: [1, 2, 4] })).toBe(
          PolicyDecision.ASK_USER,
        );
      });

      it('handles empty args objects', () => {
        const engine = new PolicyEngine({
          rules: [
            {
              toolName: 'tool',
              argsPattern: /^\{\}$/,
              decision: PolicyDecision.ALLOW,
            },
          ],
        });

        expect(engine.evaluate('tool', {})).toBe(PolicyDecision.ALLOW);
        expect(engine.evaluate('tool', { key: 'value' })).toBe(
          PolicyDecision.ASK_USER,
        );
      });

      it('uses stable stringify for consistent matching', () => {
        const engine = new PolicyEngine({
          rules: [
            {
              toolName: 'tool',
              argsPattern: /"a":"1","b":"2"/,
              decision: PolicyDecision.ALLOW,
            },
          ],
        });

        // Keys are sorted, so order in input doesn't matter
        expect(engine.evaluate('tool', { b: '2', a: '1' })).toBe(
          PolicyDecision.ALLOW,
        );
        expect(engine.evaluate('tool', { a: '1', b: '2' })).toBe(
          PolicyDecision.ALLOW,
        );
      });
    });

    describe('priority precedence', () => {
      it('higher priority DENY overrides lower priority ALLOW', () => {
        const engine = new PolicyEngine({
          rules: [
            { toolName: 'edit', decision: PolicyDecision.ALLOW, priority: 1 },
            { toolName: 'edit', decision: PolicyDecision.DENY, priority: 2 },
          ],
        });

        expect(engine.evaluate('edit', {})).toBe(PolicyDecision.DENY);
      });

      it('higher priority ASK_USER overrides lower priority ALLOW', () => {
        const engine = new PolicyEngine({
          rules: [
            { toolName: 'edit', decision: PolicyDecision.ALLOW, priority: 1 },
            {
              toolName: 'edit',
              decision: PolicyDecision.ASK_USER,
              priority: 2,
            },
          ],
        });

        expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ASK_USER);
      });

      it('specific tool rule with higher priority overrides wildcard', () => {
        const engine = new PolicyEngine({
          rules: [
            { decision: PolicyDecision.DENY, priority: 1 }, // wildcard
            { toolName: 'edit', decision: PolicyDecision.ALLOW, priority: 2 },
          ],
        });

        expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ALLOW);
        expect(engine.evaluate('shell', {})).toBe(PolicyDecision.DENY);
      });

      it('pattern-specific rule overrides general tool rule when higher priority', () => {
        const engine = new PolicyEngine({
          rules: [
            { toolName: 'shell', decision: PolicyDecision.DENY, priority: 1 },
            {
              toolName: 'shell',
              argsPattern: /"command":"npm test"/,
              decision: PolicyDecision.ALLOW,
              priority: 2,
            },
          ],
        });

        expect(engine.evaluate('shell', { command: 'npm test' })).toBe(
          PolicyDecision.ALLOW,
        );
        expect(engine.evaluate('shell', { command: 'rm -rf /' })).toBe(
          PolicyDecision.DENY,
        );
      });
    });

    describe('edge cases', () => {
      it('handles undefined args gracefully', () => {
        const engine = new PolicyEngine({
          rules: [{ toolName: 'edit', decision: PolicyDecision.ALLOW }],
        });

        // Should not throw
        expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ALLOW);
      });

      it('handles null values in args', () => {
        const engine = new PolicyEngine({
          rules: [
            {
              toolName: 'tool',
              argsPattern: /"value":null/,
              decision: PolicyDecision.ALLOW,
            },
          ],
        });

        expect(engine.evaluate('tool', { value: null })).toBe(
          PolicyDecision.ALLOW,
        );
      });

      it('handles special characters in tool names', () => {
        const engine = new PolicyEngine({
          rules: [
            {
              toolName: 'my-server__special-tool_v2',
              decision: PolicyDecision.ALLOW,
            },
          ],
        });

        expect(engine.evaluate('my-server__special-tool_v2', {})).toBe(
          PolicyDecision.ALLOW,
        );
      });

      it('handles very long args patterns', () => {
        const longPattern = new RegExp(`"data":"${'x'.repeat(1000)}"`);
        const engine = new PolicyEngine({
          rules: [
            {
              toolName: 'tool',
              argsPattern: longPattern,
              decision: PolicyDecision.ALLOW,
            },
          ],
        });

        expect(engine.evaluate('tool', { data: 'x'.repeat(1000) })).toBe(
          PolicyDecision.ALLOW,
        );
      });

      it('handles multiple rules with same priority', () => {
        const engine = new PolicyEngine({
          rules: [
            { toolName: 'edit', decision: PolicyDecision.ALLOW, priority: 1 },
            { toolName: 'shell', decision: PolicyDecision.DENY, priority: 1 },
          ],
        });

        // First matching rule should win
        expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ALLOW);
        expect(engine.evaluate('shell', {})).toBe(PolicyDecision.DENY);
      });
    });
  });

  describe('getRules', () => {
    it('returns a copy of rules array', () => {
      const config: PolicyEngineConfig = {
        rules: [{ toolName: 'edit', decision: PolicyDecision.ALLOW }],
      };

      const engine = new PolicyEngine(config);
      const rules = engine.getRules();

      expect(rules).toHaveLength(1);
      expect(rules[0].toolName).toBe('edit');

      // Modifying returned array should not affect engine
      rules.push({ toolName: 'shell', decision: PolicyDecision.DENY });
      expect(engine.getRules()).toHaveLength(1);
    });
  });

  describe('integration scenarios', () => {
    it('YOLO mode - wildcard allow-all at priority 1.999', () => {
      const engine = new PolicyEngine({
        rules: [{ decision: PolicyDecision.ALLOW, priority: 1.999 }],
      });

      expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ALLOW);
      expect(engine.evaluate('shell', { command: 'rm -rf /' })).toBe(
        PolicyDecision.ALLOW,
      );
      expect(engine.evaluate('dangerous-tool', {})).toBe(PolicyDecision.ALLOW);
    });

    it('AUTO_EDIT mode - allow write tools at priority 1.015', () => {
      const engine = new PolicyEngine({
        rules: [
          { toolName: 'edit', decision: PolicyDecision.ALLOW, priority: 1.015 },
          {
            toolName: 'shell',
            decision: PolicyDecision.ALLOW,
            priority: 1.015,
          },
          {
            toolName: 'write_file',
            decision: PolicyDecision.ALLOW,
            priority: 1.015,
          },
        ],
      });

      expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ALLOW);
      expect(engine.evaluate('shell', {})).toBe(PolicyDecision.ALLOW);
      expect(engine.evaluate('write_file', {})).toBe(PolicyDecision.ALLOW);
      expect(engine.evaluate('glob', {})).toBe(PolicyDecision.ASK_USER); // read-only, not in AUTO_EDIT
    });

    it('--allowed-tools overrides defaults (priority 2.3 > 1.015)', () => {
      const engine = new PolicyEngine({
        rules: [
          { toolName: 'edit', decision: PolicyDecision.ALLOW, priority: 1.015 },
          { toolName: 'glob', decision: PolicyDecision.ALLOW, priority: 2.3 }, // --allowed-tools
        ],
      });

      expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ALLOW);
      expect(engine.evaluate('glob', {})).toBe(PolicyDecision.ALLOW); // allowed by flag
    });

    it('MCP server trust with priority 2.2', () => {
      const engine = new PolicyEngine({
        rules: [
          {
            toolName: 'trusted-server__tool',
            decision: PolicyDecision.ALLOW,
            priority: 2.2,
          },
        ],
      });

      expect(
        engine.evaluate('trusted-server__tool', {}, 'trusted-server'),
      ).toBe(PolicyDecision.ALLOW);
    });

    it('read-only tools allowed at priority 1.05', () => {
      const engine = new PolicyEngine({
        rules: [
          { toolName: 'glob', decision: PolicyDecision.ALLOW, priority: 1.05 },
          { toolName: 'grep', decision: PolicyDecision.ALLOW, priority: 1.05 },
          {
            toolName: 'read_file',
            decision: PolicyDecision.ALLOW,
            priority: 1.05,
          },
        ],
        defaultDecision: PolicyDecision.ASK_USER,
      });

      expect(engine.evaluate('glob', {})).toBe(PolicyDecision.ALLOW);
      expect(engine.evaluate('grep', {})).toBe(PolicyDecision.ALLOW);
      expect(engine.evaluate('read_file', {})).toBe(PolicyDecision.ALLOW);
      expect(engine.evaluate('edit', {})).toBe(PolicyDecision.ASK_USER); // write tool
    });
  });
});
