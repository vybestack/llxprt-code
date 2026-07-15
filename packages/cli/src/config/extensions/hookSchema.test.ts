/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for extension hook schema validation.
 *
 * Proves the CLI extension hook validator matches the actual core HookRegistry
 * schema and docs: HookEventName keys -> HookDefinition[] where each definition
 * contains a `hooks` array of HookConfig objects (command hooks with a command
 * string). Invalid event names and malformed definitions are rejected.
 */

import { describe, it, expect } from 'vitest';
import { validateHooks, HOOKS_SCHEMA } from './hookSchema.js';
import type { Hooks } from './hookSchema.js';

describe('extension hookSchema validation', () => {
  describe('valid hook configurations', () => {
    it('accepts a minimal valid command hook under BeforeTool', () => {
      const hooks: Record<string, unknown> = {
        BeforeTool: [
          {
            hooks: [{ type: 'command', command: 'echo hello' }],
          },
        ],
      };
      const result: Hooks = validateHooks(hooks);
      expect(result).toBeDefined();
      expect(result?.BeforeTool).toHaveLength(1);
    });

    it('accepts a hook definition with matcher and sequential', () => {
      const hooks: Record<string, unknown> = {
        BeforeTool: [
          {
            matcher: 'edit_file',
            sequential: true,
            hooks: [{ type: 'command', command: 'lint' }],
          },
        ],
      };
      const result: Hooks = validateHooks(hooks);
      expect(result?.BeforeTool?.[0]?.matcher).toBe('edit_file');
      expect(result?.BeforeTool?.[0]?.sequential).toBe(true);
    });

    it('accepts multiple event names', () => {
      const hooks: Record<string, unknown> = {
        BeforeTool: [{ hooks: [{ type: 'command', command: 'a' }] }],
        AfterTool: [{ hooks: [{ type: 'command', command: 'b' }] }],
      };
      const result: Hooks = validateHooks(hooks);
      expect(result?.BeforeTool).toBeDefined();
      expect(result?.AfterTool).toBeDefined();
    });

    it('accepts all valid HookEventName keys', () => {
      const hooks: Record<string, unknown> = {
        BeforeTool: [{ hooks: [{ type: 'command', command: 'a' }] }],
        AfterTool: [{ hooks: [{ type: 'command', command: 'a' }] }],
        BeforeAgent: [{ hooks: [{ type: 'command', command: 'a' }] }],
        Notification: [{ hooks: [{ type: 'command', command: 'a' }] }],
        AfterAgent: [{ hooks: [{ type: 'command', command: 'a' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: 'a' }] }],
        SessionEnd: [{ hooks: [{ type: 'command', command: 'a' }] }],
        PreCompress: [{ hooks: [{ type: 'command', command: 'a' }] }],
        BeforeModel: [{ hooks: [{ type: 'command', command: 'a' }] }],
        AfterModel: [{ hooks: [{ type: 'command', command: 'a' }] }],
        BeforeToolSelection: [{ hooks: [{ type: 'command', command: 'a' }] }],
      };
      const result: Hooks = validateHooks(hooks);
      expect(result).toBeDefined();
      expect(Object.keys(result ?? {})).toHaveLength(11);
    });

    it('accepts undefined hooks (optional)', () => {
      const result = validateHooks(undefined);
      expect(result).toBeUndefined();
    });

    it('accepts empty hooks object', () => {
      const result = validateHooks({});
      expect(result).toStrictEqual({});
    });

    it('accepts hooks with optional name field', () => {
      const hooks: Record<string, unknown> = {
        BeforeTool: [
          {
            hooks: [{ type: 'command', command: 'echo', name: 'my-hook' }],
          },
        ],
      };
      const result: Hooks = validateHooks(hooks);
      expect(result?.BeforeTool).toBeDefined();
    });

    it('accepts hooks with optional timeout field', () => {
      const hooks: Record<string, unknown> = {
        BeforeTool: [
          {
            hooks: [{ type: 'command', command: 'echo', timeout: 5000 }],
          },
        ],
      };
      const result: Hooks = validateHooks(hooks);
      expect(result?.BeforeTool).toBeDefined();
    });
  });

  describe('invalid event names are rejected', () => {
    it('rejects an invalid event name key', () => {
      const hooks: Record<string, unknown> = {
        InvalidEvent: [{ hooks: [{ type: 'command', command: 'echo' }] }],
      };
      expect(() => validateHooks(hooks)).toThrow('Invalid');
    });

    it('rejects pre-commit style key (not a valid HookEventName)', () => {
      const hooks: Record<string, unknown> = {
        'pre-commit': [{ hooks: [{ type: 'command', command: 'lint' }] }],
      };
      expect(() => validateHooks(hooks)).toThrow('Invalid');
    });
  });

  describe('malformed definitions are rejected', () => {
    it('rejects a definition missing the hooks array', () => {
      const hooks: Record<string, unknown> = {
        BeforeTool: [{ matcher: 'test' }],
      };
      expect(() => validateHooks(hooks)).toThrow('hooks');
    });

    it('rejects a definition with hooks that is not an array', () => {
      const hooks: Record<string, unknown> = {
        BeforeTool: [{ hooks: { command: 'echo' } }],
      };
      expect(() => validateHooks(hooks)).toThrow('array');
    });

    it('rejects a hook config missing command', () => {
      const hooks: Record<string, unknown> = {
        BeforeTool: [{ hooks: [{ type: 'command' }] }],
      };
      expect(() => validateHooks(hooks)).toThrow('command');
    });

    it('rejects a hook config missing type', () => {
      const hooks: Record<string, unknown> = {
        BeforeTool: [{ hooks: [{ command: 'echo' }] }],
      };
      expect(() => validateHooks(hooks)).toThrow('type');
    });

    it('rejects event value that is not an array', () => {
      const hooks: Record<string, unknown> = {
        BeforeTool: { hooks: [{ command: 'echo' }] },
      };
      expect(() => validateHooks(hooks)).toThrow('array');
    });
  });

  describe('legacy named hooks', () => {
    it('accepts a valid named hook for consent compatibility', () => {
      const result = validateHooks({
        'pre-commit': { command: 'lint', args: ['--fix'] },
      });

      expect(result).toStrictEqual({
        'pre-commit': { command: 'lint', args: ['--fix'] },
      });
    });

    it('rejects hook names containing invalid characters', () => {
      expect(() =>
        validateHooks({ 'pre/commit': { command: 'lint' } }),
      ).toThrow('invalid characters');
    });

    it('rejects hook names longer than 128 characters', () => {
      expect(() =>
        validateHooks({ ['a'.repeat(129)]: { command: 'lint' } }),
      ).toThrow('128');
    });

    it.each(['constructor', 'prototype'])(
      'rejects reserved hook name %s',
      (name) => {
        expect(() => validateHooks({ [name]: { command: 'lint' } })).toThrow(
          'reserved',
        );
      },
    );

    it('rejects a prototype-pollution hook name parsed from JSON', () => {
      const hooks: unknown = JSON.parse('{"__proto__":{"command":"pollute"}}');

      expect(() => validateHooks(hooks)).toThrow('reserved');
      expect(Reflect.get(Object.prototype, 'command')).toBeUndefined();
    });

    it('rejects an empty legacy hook command', () => {
      expect(() => validateHooks({ 'pre-commit': { command: '' } })).toThrow(
        'Hook command cannot be empty',
      );
    });
  });

  describe('HOOKS_SCHEMA is exported', () => {
    it('is a zod schema that can parse valid input', () => {
      const result = HOOKS_SCHEMA.parse({
        BeforeTool: [{ hooks: [{ type: 'command', command: 'echo' }] }],
      });
      expect(result).toBeDefined();
    });
  });
});
