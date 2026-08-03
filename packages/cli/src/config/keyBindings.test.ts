/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { KeyBindingConfig } from './keyBindings.js';
import {
  Command,
  commandCategories,
  commandDescriptions,
  defaultKeyBindings,
  getDefaultKeyBindingHint,
  resolveKeyBindings,
  windowsKeyBindingOverrides,
} from './keyBindings.js';

function hasNonEmptyBindingTarget(binding: {
  key?: string;
  sequence?: string;
  paste?: boolean;
}): boolean {
  if (typeof binding.key === 'string' && binding.key.length > 0) {
    return true;
  }
  if (typeof binding.sequence === 'string' && binding.sequence.length > 0) {
    return true;
  }
  return binding.paste === true;
}

describe('keyBindings config', () => {
  describe('defaultKeyBindings', () => {
    it('should have bindings for all commands', () => {
      const commands = Object.values(Command);

      for (const command of commands) {
        expect(defaultKeyBindings[command]).toBeDefined();
        expect(Array.isArray(defaultKeyBindings[command])).toBe(true);
        expect(defaultKeyBindings[command].length).toBeGreaterThan(0);
      }
    });

    it('should have valid key binding structures', () => {
      for (const [_, bindings] of Object.entries(defaultKeyBindings)) {
        for (const binding of bindings) {
          // Each binding must match by key, sequence, or paste semantics.
          expect(hasNonEmptyBindingTarget(binding)).toBe(true);

          // Modifier properties should be boolean or undefined
          expect(
            binding.ctrl === undefined || typeof binding.ctrl === 'boolean',
          ).toBe(true);
          expect(
            binding.shift === undefined || typeof binding.shift === 'boolean',
          ).toBe(true);
          expect(
            binding.command === undefined ||
              typeof binding.command === 'boolean',
          ).toBe(true);
          expect(
            binding.paste === undefined || typeof binding.paste === 'boolean',
          ).toBe(true);
        }
      }
    });

    it('should export all required types', () => {
      // Basic type checks
      expect(typeof Command.HOME).toBe('string');
      expect(typeof Command.END).toBe('string');

      // Config should be readonly
      const config: KeyBindingConfig = defaultKeyBindings;
      expect(config[Command.HOME]).toBeDefined();
    });

    it('formats the queued-messages key hint from its default binding', () => {
      expect(getDefaultKeyBindingHint(Command.TOGGLE_QUEUED_MESSAGES)).toBe(
        'Ctrl+]',
      );
    });

    it('should have correct specific bindings', () => {
      // Verify navigation ignores shift
      const navUp = defaultKeyBindings[Command.NAVIGATION_UP];
      expect(navUp).toContainEqual({ key: 'up', shift: false });

      const navDown = defaultKeyBindings[Command.NAVIGATION_DOWN];
      expect(navDown).toContainEqual({ key: 'down', shift: false });

      // Verify dialog navigation
      const dialogNavUp = defaultKeyBindings[Command.DIALOG_NAVIGATION_UP];
      expect(dialogNavUp).toContainEqual({ key: 'up', shift: false });
      expect(dialogNavUp).toContainEqual({ key: 'k', shift: false });

      const dialogNavDown = defaultKeyBindings[Command.DIALOG_NAVIGATION_DOWN];
      expect(dialogNavDown).toContainEqual({ key: 'down', shift: false });
      expect(dialogNavDown).toContainEqual({ key: 'j', shift: false });

      // Verify physical home/end keys for cursor movement
      expect(defaultKeyBindings[Command.HOME]).toContainEqual({
        key: 'home',
        ctrl: false,
        shift: false,
      });
      expect(defaultKeyBindings[Command.END]).toContainEqual({
        key: 'end',
        ctrl: false,
        shift: false,
      });

      // Verify physical home/end keys for scrolling
      expect(defaultKeyBindings[Command.SCROLL_HOME]).toContainEqual({
        key: 'home',
        ctrl: true,
      });
      expect(defaultKeyBindings[Command.SCROLL_END]).toContainEqual({
        key: 'end',
        ctrl: true,
      });
    });
  });

  describe('resolveKeyBindings (platform-aware STEER alias, issue #2951)', () => {
    it('keeps defaultKeyBindings[STEER] as a single binding so docs are unaffected', () => {
      expect(defaultKeyBindings[Command.STEER]).toHaveLength(1);
      expect(defaultKeyBindings[Command.STEER]).toContainEqual({
        key: 'return',
        ctrl: true,
      });
    });

    it('adds the Windows Ctrl+J alias to STEER on win32', () => {
      const win32 = resolveKeyBindings('win32');
      expect(win32[Command.STEER]).toContainEqual({
        key: 'return',
        ctrl: true,
      });
      expect(win32[Command.STEER]).toContainEqual({
        key: 'j',
        ctrl: true,
      });
    });

    it('does NOT add the Ctrl+J alias on darwin/linux and resolves to the default bindings', () => {
      const darwin = resolveKeyBindings('darwin');
      const linux = resolveKeyBindings('linux');
      expect(darwin).toStrictEqual(defaultKeyBindings);
      expect(linux).toStrictEqual(defaultKeyBindings);
      expect(darwin[Command.STEER]).not.toContainEqual({
        key: 'j',
        ctrl: true,
      });
      expect(linux[Command.STEER]).not.toContainEqual({
        key: 'j',
        ctrl: true,
      });
    });

    it('leaves every non-STEER command identical between win32 and linux', () => {
      const win32 = resolveKeyBindings('win32');
      const linux = resolveKeyBindings('linux');
      for (const command of Object.values(Command)) {
        if (command === Command.STEER) continue;
        expect(win32[command]).toStrictEqual(linux[command]);
      }
    });

    it('applies the Windows overrides on top of the defaults without dropping any command', () => {
      const win32 = resolveKeyBindings('win32');
      for (const command of Object.values(Command)) {
        const override = windowsKeyBindingOverrides[command];
        expect(win32[command]).toStrictEqual(
          override ?? defaultKeyBindings[command],
        );
      }
    });
  });

  describe('command metadata', () => {
    const commandValues = Object.values(Command);

    it('has a description entry for every command', () => {
      const describedCommands = Object.keys(commandDescriptions);
      expect(describedCommands.sort()).toStrictEqual([...commandValues].sort());

      for (const command of commandValues) {
        expect(typeof commandDescriptions[command]).toBe('string');
        expect(commandDescriptions[command].trim()).not.toHaveLength(0);
      }
    });

    it('categorizes each command exactly once', () => {
      const seen = new Set<Command>();

      for (const category of commandCategories) {
        expect(typeof category.title).toBe('string');
        expect(Array.isArray(category.commands)).toBe(true);

        for (const command of category.commands) {
          expect(commandValues).toContain(command);
          expect(seen.has(command)).toBe(false);
          seen.add(command);
        }
      }

      expect(seen.size).toBe(commandValues.length);
    });
  });
});
