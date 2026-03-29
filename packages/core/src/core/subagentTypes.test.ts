/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeAll } from 'vitest';

// Module references populated at runtime via dynamic import in beforeAll.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ContextState: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let SubagentTerminateMode: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let templateString: any;

describe('subagentTypes', () => {
  beforeAll(async () => {
    const mod = await import('./subagentTypes.js');
    ContextState = mod.ContextState;
    SubagentTerminateMode = mod.SubagentTerminateMode;
    templateString = mod.templateString;
  });

  describe('ContextState', () => {
    it('should set and get values correctly', () => {
      const context = new ContextState();
      context.set('key1', 'value1');
      context.set('key2', 123);
      expect(context.get('key1')).toBe('value1');
      expect(context.get('key2')).toBe(123);
      expect(context.get_keys()).toStrictEqual(['key1', 'key2']);
    });

    it('should return undefined for missing keys', () => {
      const context = new ContextState();
      expect(context.get('missing')).toBeUndefined();
    });

    it('should return all keys via get_keys()', () => {
      const context = new ContextState();
      context.set('a', 1);
      context.set('b', 2);
      context.set('c', 3);
      expect(context.get_keys()).toStrictEqual(['a', 'b', 'c']);
    });

    it('should return empty array for empty state via get_keys()', () => {
      const context = new ContextState();
      expect(context.get_keys()).toStrictEqual([]);
    });

    it('should handle overwriting existing keys', () => {
      const context = new ContextState();
      context.set('key', 'original');
      context.set('key', 'overwritten');
      expect(context.get('key')).toBe('overwritten');
      expect(context.get_keys()).toStrictEqual(['key']);
    });
  });

  describe('templateString', () => {
    // Note: templateString uses ${var} syntax (dollar-brace), NOT {{var}}

    it('should replace ${var} tokens with context values', () => {
      const context = new ContextState();
      context.set('name', 'World');
      expect(templateString('Hello, ${name}!', context)).toBe('Hello, World!');
    });

    it('should handle multiple ${var} tokens in one string', () => {
      const context = new ContextState();
      context.set('greeting', 'Hello');
      context.set('subject', 'World');
      expect(templateString('${greeting}, ${subject}!', context)).toBe(
        'Hello, World!',
      );
    });

    it('should substitute placeholder when a variable key is missing from context', () => {
      const context = new ContextState();
      expect(templateString('Hello, ${missing}!', context)).toBe(
        'Hello, <missing:missing>!',
      );
    });

    it('should substitute placeholders for missing keys while replacing present ones', () => {
      const context = new ContextState();
      context.set('name', 'World');
      expect(templateString('${greeting}, ${name}!', context)).toBe(
        '<missing:greeting>, World!',
      );
    });

    it('should handle empty context with no tokens in template', () => {
      const context = new ContextState();
      expect(templateString('No tokens here.', context)).toBe(
        'No tokens here.',
      );
    });

    it('should return template unchanged when it contains no ${} tokens', () => {
      const context = new ContextState();
      context.set('unused', 'value');
      expect(templateString('plain text', context)).toBe('plain text');
    });

    it('should handle adjacent tokens like ${a}${b} correctly', () => {
      const context = new ContextState();
      context.set('a', 'foo');
      context.set('b', 'bar');
      expect(templateString('${a}${b}', context)).toBe('foobar');
    });
  });

  describe('SubagentTerminateMode', () => {
    it('should have the expected enum values', () => {
      expect(SubagentTerminateMode.GOAL).toBe('GOAL');
      expect(SubagentTerminateMode.ERROR).toBe('ERROR');
      expect(SubagentTerminateMode.TIMEOUT).toBe('TIMEOUT');
      expect(SubagentTerminateMode.MAX_TURNS).toBe('MAX_TURNS');
    });
  });
});
