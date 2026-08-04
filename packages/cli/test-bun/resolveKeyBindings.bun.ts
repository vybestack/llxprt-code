/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2951 — `resolveKeyBindings` is a pure function of its `platform`
 * argument, so it needs no React/ink harness and is Bun-native.
 *
 * Windows consoles deliver Ctrl+Enter as a bare line feed (0x0A), which the
 * keypress parser reports as `{ name: 'j', ctrl: true }`. `resolveKeyBindings`
 * therefore appends a Ctrl+J alias to STEER on win32 only, leaving
 * `defaultKeyBindings` platform-neutral so the generated
 * `docs/keyboard-shortcuts.md` is identical on every platform.
 */

import { describe, expect, it } from 'bun:test';
import type { KeyBinding } from '../src/config/keyBindings.js';
import {
  Command,
  defaultKeyBindings,
  resolveKeyBindings,
  windowsKeyBindingAdditions,
} from '../src/config/keyBindings.js';

const CTRL_J: KeyBinding = { key: 'j', ctrl: true };
const CTRL_RETURN: KeyBinding = { key: 'return', ctrl: true };

/** Structural identity used to compare bindings by value. */
function fingerprint(binding: KeyBinding): string {
  return JSON.stringify([
    binding.key,
    binding.ctrl,
    binding.shift,
    binding.command,
    binding.paste,
  ]);
}

function contains(
  bindings: readonly KeyBinding[],
  target: KeyBinding,
): boolean {
  const wanted = fingerprint(target);
  return bindings.some((binding) => fingerprint(binding) === wanted);
}

describe('resolveKeyBindings (platform-aware STEER alias, issue #2951)', () => {
  it('keeps defaultKeyBindings[STEER] as a single binding so the generated docs are unaffected', () => {
    expect(defaultKeyBindings[Command.STEER]).toHaveLength(1);
    expect(contains(defaultKeyBindings[Command.STEER], CTRL_RETURN)).toBe(true);
  });

  it('adds the Windows Ctrl+J alias to STEER on win32', () => {
    const win32 = resolveKeyBindings('win32');
    expect(contains(win32[Command.STEER], CTRL_RETURN)).toBe(true);
    expect(contains(win32[Command.STEER], CTRL_J)).toBe(true);
  });

  it('does NOT add the Ctrl+J alias on darwin/linux and resolves to the default bindings', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const resolved = resolveKeyBindings(platform);
      expect(resolved).toEqual(defaultKeyBindings);
      expect(contains(resolved[Command.STEER], CTRL_J)).toBe(false);
    }
  });

  it('leaves every non-STEER command identical between win32 and linux', () => {
    const win32 = resolveKeyBindings('win32');
    const linux = resolveKeyBindings('linux');
    for (const command of Object.values(Command)) {
      if (command === Command.STEER) continue;
      expect(win32[command]).toEqual(linux[command]);
    }
  });

  it('appends the Windows additions to the defaults rather than replacing them', () => {
    const win32 = resolveKeyBindings('win32');
    for (const command of Object.values(Command)) {
      const additions = windowsKeyBindingAdditions[command] ?? [];

      // Every default binding survives the merge.
      for (const binding of defaultKeyBindings[command]) {
        expect(contains(win32[command], binding)).toBe(true);
      }
      // Every addition is present.
      for (const addition of additions) {
        expect(contains(win32[command], addition)).toBe(true);
      }

      // The result is exactly the union of defaults and additions, so an
      // addition that already exists as a default does not grow the list.
      const union = new Set(
        [...defaultKeyBindings[command], ...additions].map(fingerprint),
      );
      expect(win32[command]).toHaveLength(union.size);
    }
  });

  it('never emits the same binding twice for any command', () => {
    const win32 = resolveKeyBindings('win32');
    for (const command of Object.values(Command)) {
      const seen = win32[command].map(fingerprint);
      expect(new Set(seen).size).toBe(seen.length);
    }
  });
});
