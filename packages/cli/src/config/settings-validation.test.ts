/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/// <reference types="vitest/globals" />

import { describe, it, expect } from 'vitest';
import {
  validateSettings,
  formatValidationError,
  settingsZodSchema,
} from './settings-validation.js';
import { z } from 'zod';

describe('settings-validation', () => {
  describe('validateSettings - valid settings', () => {
    it('should accept empty settings object', () => {
      const result = validateSettings({});
      expect(result.success).toBe(true);
    });

    it('should accept valid flat boolean setting', () => {
      const validSettings = { disableAutoUpdate: false };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should accept valid flat string setting', () => {
      const validSettings = { mcpServerCommand: '/path/to/command' };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should accept valid flat number setting', () => {
      const validSettings = { ptyScrollbackLimit: 1000 };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should accept valid string array', () => {
      const validSettings = {
        mcpServers: {
          server1: { args: ['git', 'npm', 'node'] },
        },
      };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should accept valid nested object', () => {
      const validSettings = {
        ui: { theme: 'DefaultDark', hideWindowTitle: true },
      };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should accept valid deeply nested object', () => {
      const validSettings = {
        ui: {
          footer: {
            hideCWD: false,
            hideSandboxStatus: true,
            hideModelInfo: false,
          },
        },
      };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should accept valid object with additionalProperties (mcpServers)', () => {
      const validSettings = {
        mcpServers: {
          'my-server': {
            command: 'node',
            args: ['server.js'],
            env: { NODE_ENV: 'production' },
          },
        },
      };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should accept unknown top-level keys (passthrough for migration)', () => {
      const validSettings = {
        unknownKey: 'some value',
        anotherUnknown: 123,
      };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should accept complex valid settings', () => {
      const validSettings = {
        disableAutoUpdate: false,
        ui: {
          theme: 'DefaultDark',
          hideWindowTitle: true,
          footer: { hideCWD: false },
        },
        mcpServers: {
          server1: { command: 'node', args: ['index.js'] },
        },
        accessibility: {
          disableLoadingPhrases: true,
          screenReader: false,
        },
      };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });
  });

  describe('validateSettings - invalid types', () => {
    it('should reject string instead of boolean', () => {
      const invalidSettings = { disableAutoUpdate: 'yes' };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      if (result.error != null) {
        expect(result.error.issues[0]?.path).toEqual(['disableAutoUpdate']);
        expect(result.error.issues[0]?.code).toBe('invalid_type');
      }
    });

    it('should reject number instead of string', () => {
      const invalidSettings = { mcpServerCommand: 123 };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      if (result.error != null) {
        expect(result.error.issues[0]?.path).toEqual(['mcpServerCommand']);
        expect(result.error.issues[0]?.code).toBe('invalid_type');
      }
    });

    it('should reject boolean instead of number', () => {
      const invalidSettings = { ptyScrollbackLimit: true };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);
    });

    it('should reject number in string array', () => {
      const invalidSettings = {
        mcpServers: {
          server1: { args: ['git', 123, 'npm'] },
        },
      };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);
      if (result.error != null) {
        expect(result.error.issues[0]?.path).toContain('args');
        expect(result.error.issues[0]?.path).toContain(1);
      }
    });

    it('should reject object in string array', () => {
      const invalidSettings = {
        mcpServers: {
          server1: { args: ['git', { tool: 'npm' }] },
        },
      };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);
    });

    it('should reject string instead of object', () => {
      const invalidSettings = { ui: 'invalid' };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);
      if (result.error != null) {
        expect(result.error.issues[0]?.path).toEqual(['ui']);
      }
    });

    it('should reject invalid nested property type', () => {
      const invalidSettings = { ui: { theme: 123 } };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);
      if (result.error != null) {
        expect(result.error.issues[0]?.path).toEqual(['ui', 'theme']);
      }
    });

    it('should reject invalid deeply nested type', () => {
      const invalidSettings = {
        ui: { footer: { hideCWD: 'yes' } },
      };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);
      if (result.error != null) {
        expect(result.error.issues[0]?.path).toEqual([
          'ui',
          'footer',
          'hideCWD',
        ]);
      }
    });

    it('should reject invalid mcpServers structure', () => {
      const invalidSettings = {
        mcpServers: {
          'my-server': {
            command: 123, // Should be string
            args: ['arg1'],
          },
        },
      };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);
      if (result.error != null) {
        const issue = result.error.issues.find((i) =>
          i.path.includes('command'),
        );
        expect(issue).toBeDefined();
        expect(issue?.code).toBe('invalid_type');
      }
    });

    it('should reject array instead of object', () => {
      const invalidSettings = { accessibility: ['option1', 'option2'] };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);
    });

    it('should reject null value for required type', () => {
      const invalidSettings = { disableAutoUpdate: null };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);
    });

    it('should allow undefined (all fields optional)', () => {
      // This test verifies that undefined is acceptable (not an error)
      const settingsWithUndefined = { disableAutoUpdate: undefined };
      const result = validateSettings(settingsWithUndefined);
      expect(result.success).toBe(true);
    });

    it('should reject multiple type errors in one settings object', () => {
      const invalidSettings = {
        disableAutoUpdate: 'yes',
        ptyScrollbackLimit: 'not-a-number',
        allowedTools: [123, 456],
      };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);
      if (result.error != null) {
        expect(result.error.issues.length).toBeGreaterThan(1);
      }
    });

    it('should validate mcpServers with type field for all transport types', () => {
      const validSettings = {
        mcpServers: {
          'sse-server': {
            url: 'https://example.com/sse',
            type: 'sse',
            headers: { 'X-API-Key': 'key' },
          },
          'http-server': {
            url: 'https://example.com/mcp',
            type: 'http',
          },
          'stdio-server': {
            command: '/usr/bin/mcp-server',
            type: 'stdio',
          },
        },
      };

      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should reject invalid type values in mcpServers', () => {
      const invalidSettings = {
        mcpServers: {
          'bad-server': {
            url: 'https://example.com/mcp',
            type: 'invalid-type',
          },
        },
      };

      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);
    });

    it('should validate mcpServers without type field', () => {
      const validSettings = {
        mcpServers: {
          'stdio-server': {
            command: '/usr/bin/mcp-server',
            args: ['--port', '8080'],
          },
          'url-server': {
            url: 'https://example.com/mcp',
          },
        },
      };

      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should reject invalid customThemes structure', () => {
      const invalidSettings = {
        ui: {
          customThemes: {
            'my-theme': {
              type: 'custom',
              // Missing required 'name' field
              text: { primary: '#ffffff' },
            },
          },
        },
      };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);
      if (result.error != null) {
        const issue = result.error.issues.find(
          (i) => i.code === 'invalid_type' && i.message.includes('Required'),
        );
        expect(issue).toBeDefined();
      }
    });

    it('should provide detailed error for complex nested validation failure', () => {
      const invalidSettings = {
        mcpServers: {
          server1: {
            command: 'valid-command',
            args: ['arg1'],
            env: { VAR1: 123 }, // Should be string
          },
        },
      };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);
      if (result.error != null) {
        const issue = result.error.issues.find((i) => i.path.includes('env'));
        expect(issue).toBeDefined();
      }
    });
  });

  describe('validateSettings - LLxprt-specific settings', () => {
    it('should accept lsp as boolean false', () => {
      const validSettings = { lsp: false };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should accept lsp as object', () => {
      const validSettings = {
        lsp: {
          servers: [{ id: 'ts-server', command: 'typescript-language-server' }],
          includeSeverities: ['error', 'warning'],
        },
      };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should accept lsp as boolean true (enables LSP with defaults)', () => {
      const validSettings = { lsp: true };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should reject lsp as string', () => {
      const invalidSettings = { lsp: 'enabled' };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);
    });

    it('should accept tools.sandbox as boolean', () => {
      const result1 = validateSettings({ tools: { sandbox: true } });
      const result2 = validateSettings({ tools: { sandbox: false } });
      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });

    it('should accept tools.sandbox as string path', () => {
      const validSettings = { tools: { sandbox: '/usr/bin/sandbox' } };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should accept fileFiltering nested object', () => {
      const validSettings = {
        fileFiltering: {
          respectGitIgnore: true,
          respectLlxprtIgnore: false,
          enableRecursiveFileSearch: true,
        },
      };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should accept subagents configuration', () => {
      const validSettings = {
        subagents: {
          asyncEnabled: true,
          maxAsync: 5,
        },
      };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should accept security settings', () => {
      const validSettings = {
        security: {
          disableYoloMode: true,
          blockGitExtensions: false,
        },
      };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should accept extensions with disabled array', () => {
      const validSettings = {
        extensions: {
          disabled: ['ext1', 'ext2'],
        },
      };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should accept hooks configuration', () => {
      const validSettings = {
        hooks: {
          'session-start': [
            {
              name: 'init-hook',
              command: 'echo "Starting session"',
            },
          ],
        },
      };
      const result = validateSettings(validSettings);
      expect(result.success).toBe(true);
    });

    it('should accept E2E test helper settings with sandbox=false', () => {
      const result = validateSettings({
        general: { disableAutoUpdate: true },
        ui: { theme: 'Green Screen', useAlternateBuffer: true },
        telemetry: {
          enabled: true,
          target: 'local',
          otlpEndpoint: '',
          outfile: '/tmp/test.log',
        },
        promptService: { baseDir: '/tmp/bundle' },
        sandbox: false,
        provider: 'openai',
        debug: true,
        ide: { enabled: false, hasSeenNudge: true },
      });
      expect(result.success).toBe(true);
    });

    it('should accept sandbox as boolean false', () => {
      const result = validateSettings({ sandbox: false });
      expect(result.success).toBe(true);
    });

    it('should accept sandbox as boolean true', () => {
      const result = validateSettings({ sandbox: true });
      expect(result.success).toBe(true);
    });

    it('should accept sandbox as string "docker"', () => {
      const result = validateSettings({ sandbox: 'docker' });
      expect(result.success).toBe(true);
    });

    it('should accept sandbox as string "none"', () => {
      const result = validateSettings({ sandbox: 'none' });
      expect(result.success).toBe(true);
    });

    it('should accept sandbox as string path', () => {
      const result = validateSettings({ sandbox: '/usr/bin/sandbox' });
      expect(result.success).toBe(true);
    });
  });

  describe('formatValidationError', () => {
    it('should format error with file path and helpful message', () => {
      const invalidSettings = { disableAutoUpdate: 'yes' };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);

      if (result.error != null) {
        const formatted = formatValidationError(
          result.error,
          '/path/to/settings.json',
        );

        expect(formatted).toContain('/path/to/settings.json');
        expect(formatted).toContain('disableAutoUpdate');
        expect(formatted).toContain('Expected:');
        expect(formatted).toContain('but received:');
        expect(formatted).toContain(
          'Please fix the configuration and try again.',
        );
      }
    });

    it('should format nested property path correctly', () => {
      const invalidSettings = { ui: { theme: 123 } };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);

      if (result.error != null) {
        const formatted = formatValidationError(result.error, 'settings.json');
        expect(formatted).toContain('ui.theme');
      }
    });

    it('should format array index path correctly', () => {
      const invalidSettings = {
        mcpServers: {
          server1: { args: ['git', 123, 'npm'] },
        },
      };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);

      if (result.error != null) {
        const formatted = formatValidationError(result.error, 'settings.json');
        expect(formatted).toContain('args');
        expect(formatted).toContain('[1]');
      }
    });

    it('should format deeply nested object path correctly', () => {
      const invalidSettings = {
        mcpServers: {
          'my-server': { command: 123 },
        },
      };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);

      if (result.error != null) {
        const formatted = formatValidationError(result.error, 'settings.json');
        expect(formatted).toContain('mcpServers');
        expect(formatted).toContain('command');
      }
    });

    it('should include expected vs received for invalid_type errors', () => {
      const invalidSettings = { disableAutoUpdate: 'yes' };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);

      if (result.error != null) {
        const formatted = formatValidationError(result.error, 'settings.json');
        expect(formatted).toContain('Expected: boolean');
        expect(formatted).toContain('but received: string');
      }
    });

    it('should list all validation errors when multiple exist', () => {
      const invalidSettings = {
        disableAutoUpdate: 'yes',
        ptyScrollbackLimit: 'not-a-number',
      };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);

      if (result.error != null) {
        const formatted = formatValidationError(result.error, 'settings.json');
        expect(formatted).toContain('disableAutoUpdate');
        expect(formatted).toContain('ptyScrollbackLimit');
      }
    });

    it('should limit displayed errors to 5', () => {
      const invalidSettings = {
        mcpServers: {
          server1: { args: [1, 2, 3, 4, 5, 6, 7] }, // 7 invalid items
        },
      };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);

      if (result.error != null) {
        const formatted = formatValidationError(result.error, 'settings.json');
        expect(formatted).toContain('args');
        expect(formatted).toContain('[0]');
        expect(formatted).toContain('[4]');
        expect(formatted).not.toContain('[5]');
        expect(formatted).not.toContain('[6]');
        expect(formatted).toContain('...and 2 more errors.');
      }
    });

    it('should include documentation link', () => {
      const invalidSettings = { disableAutoUpdate: 'yes' };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);

      if (result.error != null) {
        const formatted = formatValidationError(result.error, 'settings.json');
        expect(formatted).toContain('https://');
        expect(formatted).toContain('configuration');
      }
    });

    it('should handle root-level error path', () => {
      // Test with a setting that errors at root
      const invalidSettings = { ui: 'not-an-object' };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);

      if (result.error != null) {
        const formatted = formatValidationError(result.error, 'settings.json');
        expect(formatted).toContain('Error in: ui');
      }
    });

    it('should use proper formatting for settings file path', () => {
      const invalidSettings = { disableAutoUpdate: 'yes' };
      const result = validateSettings(invalidSettings);
      expect(result.success).toBe(false);

      if (result.error != null) {
        const formatted = formatValidationError(
          result.error,
          '~/.llxprt/settings.json',
        );
        expect(formatted).toContain('~/.llxprt/settings.json');
      }
    });
  });

  describe('settingsZodSchema', () => {
    it('should be a valid Zod object schema', () => {
      expect(settingsZodSchema).toBeInstanceOf(z.ZodObject);
    });

    it('should have all fields as optional', () => {
      // Empty object should be valid
      const result = settingsZodSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should allow passthrough for unknown keys', () => {
      const result = settingsZodSchema.safeParse({
        unknownKey1: 'value1',
        unknownKey2: 123,
        unknownKey3: true,
      });
      expect(result.success).toBe(true);
    });
  });
});
