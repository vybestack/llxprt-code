/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for the dedicated SessionSettingsOverlay and its
 * integration into SettingsService (Issue #3151).
 *
 * The overlay is a session-scoped key-value store, shared by reference between
 * a foreground service and its isolated child instances. Only registry-
 * classified session-scoped keys may enter the overlay; arbitrary keys are
 * rejected at the owner boundary. Profile-local clears and reapplies must NOT
 * erase an explicit session override. A brand-new SettingsService gets a fresh
 * overlay with no inherited values.
 */

import { describe, expect, it, vi } from 'bun:test';
import { SettingsService } from '../settings/SettingsService.js';
import { SessionSettingsOverlay } from '../settings/SessionSettingsOverlay.js';

describe('SessionSettingsOverlay', () => {
  it('stores and retrieves values by canonical key', () => {
    const overlay = new SessionSettingsOverlay();
    overlay.set('dumpcontext', 'on');
    expect(overlay.get('dumpcontext')).toBe('on');
    expect(overlay.has('dumpcontext')).toBe(true);
  });

  it('returns undefined for absent keys', () => {
    const overlay = new SessionSettingsOverlay();
    expect(overlay.get('dumpcontext')).toBeUndefined();
    expect(overlay.has('dumpcontext')).toBe(false);
  });

  it('deletes values', () => {
    const overlay = new SessionSettingsOverlay();
    overlay.set('dumpcontext', 'on');
    overlay.delete('dumpcontext');
    expect(overlay.has('dumpcontext')).toBe(false);
  });

  it('toObject returns a detached copy', () => {
    const overlay = new SessionSettingsOverlay();
    overlay.set('dumpcontext', 'error');
    const snapshot = overlay.toObject();
    overlay.set('dumpcontext', 'off');
    expect(snapshot.dumpcontext).toBe('error');
  });

  it('rejects non-session-scoped keys on set', () => {
    const overlay = new SessionSettingsOverlay();
    expect(() => overlay.set('auth-key', 'secret')).toThrow(
      /not a registry-classified session-scoped setting/,
    );
  });

  it('rejects non-session-scoped keys on get', () => {
    const overlay = new SessionSettingsOverlay();
    expect(() => overlay.get('auth-key')).toThrow(
      /not a registry-classified session-scoped setting/,
    );
  });

  it('rejects non-session-scoped keys on has', () => {
    const overlay = new SessionSettingsOverlay();
    expect(() => overlay.has('model')).toThrow(
      /not a registry-classified session-scoped setting/,
    );
  });

  it('rejects non-session-scoped keys on delete', () => {
    const overlay = new SessionSettingsOverlay();
    expect(() => overlay.delete('temperature')).toThrow(
      /not a registry-classified session-scoped setting/,
    );
  });
});

describe('SettingsService — session overlay lifecycle (Issue #3151)', () => {
  describe('session-scoped read precedence', () => {
    it('reads a session override value before the local store', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'on');

      const child = new SettingsService({ sessionSource: foreground });
      child.set('dumpcontext', 'off');

      expect(child.get('dumpcontext')).toBe('on');
      expect(child.getAllGlobalSettings().dumpcontext).toBe('on');
    });

    it('falls back to the local store when no session override exists', () => {
      const foreground = new SettingsService();
      const child = new SettingsService({ sessionSource: foreground });
      child.set('dumpcontext', 'error');

      expect(child.get('dumpcontext')).toBe('error');
      expect(child.getAllGlobalSettings().dumpcontext).toBe('error');
    });

    it('foreground reads its own session override', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'on');

      expect(foreground.get('dumpcontext')).toBe('on');
      expect(foreground.getAllGlobalSettings().dumpcontext).toBe('on');
    });
  });

  describe('explicit session override survives profile-local clear/reapply', () => {
    it('survives clear() on the same foreground service', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'on');

      foreground.clear();

      expect(foreground.get('dumpcontext')).toBe('on');
      expect(foreground.getAllGlobalSettings().dumpcontext).toBe('on');
    });

    it('survives clear() on the child service', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'error');

      const child = new SettingsService({ sessionSource: foreground });
      child.set('dumpcontext', 'on');
      child.clear();

      expect(child.get('dumpcontext')).toBe('error');
    });

    it('survives importFromProfile on the foreground', async () => {
      const foreground = new SettingsService();
      foreground.set('dumpcontext', 'off');
      foreground.setSessionScoped('dumpcontext', 'on');

      await foreground.importFromProfile({
        defaultProvider: 'openai',
        providers: {
          openai: { model: 'gpt-4' },
        },
        tools: { allowed: [], disabled: [] },
      });

      // The real flattened payload mutated providers/activeProvider (proving
      // the import path ran), but the explicit session override still wins
      // over the local 'off' value.
      expect(foreground.get('activeProvider')).toBe('openai');
      expect(foreground.get('dumpcontext')).toBe('on');
    });
  });

  describe('live updates through the shared overlay', () => {
    it('reflects foreground session changes on the child without re-creation', () => {
      const foreground = new SettingsService();
      const child = new SettingsService({ sessionSource: foreground });

      foreground.setSessionScoped('dumpcontext', 'on');
      expect(child.get('dumpcontext')).toBe('on');

      foreground.setSessionScoped('dumpcontext', 'off');
      expect(child.get('dumpcontext')).toBe('off');

      foreground.setSessionScoped('dumpcontext', 'error');
      expect(child.get('dumpcontext')).toBe('error');
      expect(child.getAllGlobalSettings().dumpcontext).toBe('error');
    });
  });

  describe('snapshot immutability', () => {
    it('a returned snapshot is unchanged after later session edits', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'on');

      const child = new SettingsService({ sessionSource: foreground });
      const snapshotBefore = child.getAllGlobalSettings();

      foreground.setSessionScoped('dumpcontext', 'off');

      expect(snapshotBefore.dumpcontext).toBe('on');
      expect(child.getAllGlobalSettings().dumpcontext).toBe('off');
    });
  });

  describe('session off overrides profile on', () => {
    it('explicit session off shadows a profile-local on', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'off');

      const child = new SettingsService({ sessionSource: foreground });
      child.set('dumpcontext', 'on');

      expect(child.get('dumpcontext')).toBe('off');
      expect(child.getAllGlobalSettings().dumpcontext).toBe('off');
    });
  });

  describe('absent session uses profile fallback', () => {
    it('no session value means the local/profile value wins', () => {
      const foreground = new SettingsService();
      const child = new SettingsService({ sessionSource: foreground });
      child.set('dumpcontext', 'on');

      expect(child.get('dumpcontext')).toBe('on');
    });
  });

  describe('unrelated-setting isolation', () => {
    it('does not inherit unrelated foreground globals', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'on');
      foreground.set('temperature', 0.9);
      foreground.set('auth-key', 'sk-source-secret');

      const child = new SettingsService({ sessionSource: foreground });
      child.set('temperature', 0.3);

      expect(child.get('dumpcontext')).toBe('on');
      expect(child.get('temperature')).toBe(0.3);
      expect(child.get('auth-key')).toBeUndefined();

      const all = child.getAllGlobalSettings();
      expect(all.temperature).toBe(0.3);
      expect(all['auth-key']).toBeUndefined();
    });

    it('does not inherit foreground provider settings', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'on');
      foreground.setProviderSetting('openai', 'model', 'gpt-source');

      const child = new SettingsService({ sessionSource: foreground });
      child.setProviderSetting('openai', 'model', 'gpt-child');

      expect(child.getProviderSettings('openai').model).toBe('gpt-child');
    });
  });

  describe('new sessions do not leak', () => {
    it('a brand-new service has no inherited session values', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'on');

      const independent = new SettingsService();
      expect(independent.get('dumpcontext')).toBeUndefined();
      expect(independent.getAllGlobalSettings().dumpcontext).toBeUndefined();
    });

    it('a second foreground session does not inherit from the first', () => {
      const foregroundA = new SettingsService();
      foregroundA.setSessionScoped('dumpcontext', 'on');

      const foregroundB = new SettingsService();
      expect(foregroundB.get('dumpcontext')).toBeUndefined();
    });
  });

  describe('explicit session methods', () => {
    it('setSessionScoped / getSessionScoped round-trip', () => {
      const svc = new SettingsService();
      svc.setSessionScoped('dumpcontext', 'error');
      expect(svc.getSessionScoped('dumpcontext')).toBe('error');
    });

    it('clearSessionScoped removes the override', () => {
      const svc = new SettingsService();
      svc.setSessionScoped('dumpcontext', 'on');
      svc.clearSessionScoped('dumpcontext');
      expect(svc.getSessionScoped('dumpcontext')).toBeUndefined();
    });

    it('ordinary set does not write to the session overlay', () => {
      const foreground = new SettingsService();
      const child = new SettingsService({ sessionSource: foreground });

      child.set('dumpcontext', 'on');
      expect(foreground.getSessionScoped('dumpcontext')).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // HIGH — session isolation: non-session keys are rejected
  // ------------------------------------------------------------------
  describe('non-session key rejection (Issue #3151 HIGH)', () => {
    it.each([
      ['auth-key', 'secret-key-value'],
      ['model', 'gpt-4'],
      ['endpoint', 'https://custom.api.com'],
      ['reasoning.effort', 'high'],
      ['tools.disabled', ['tool-a']],
      ['totally-unknown-key', 'whatever'],
    ])(
      'setSessionScoped rejects "%s" and it never enters the overlay',
      (key, value) => {
        const foreground = new SettingsService();
        expect(() => foreground.setSessionScoped(key, value)).toThrow(
          /not a registry-classified session-scoped setting/,
        );

        // The overlay must not contain the rejected key.
        expect(foreground.getAllGlobalSettings()[key]).toBeUndefined();

        // A child snapshot must not see it either.
        const child = new SettingsService({ sessionSource: foreground });
        expect(child.getAllGlobalSettings()[key]).toBeUndefined();
      },
    );

    it.each([
      ['auth-key'],
      ['model'],
      ['endpoint'],
      ['temperature'],
      ['totally-unknown-key'],
    ])('getSessionScoped rejects "%s"', (key) => {
      const svc = new SettingsService();
      expect(() => svc.getSessionScoped(key)).toThrow(
        /not a registry-classified session-scoped setting/,
      );
    });

    it.each([
      ['auth-key'],
      ['model'],
      ['endpoint'],
      ['temperature'],
      ['totally-unknown-key'],
    ])('clearSessionScoped rejects "%s"', (key) => {
      const svc = new SettingsService();
      expect(() => svc.clearSessionScoped(key)).toThrow(
        /not a registry-classified session-scoped setting/,
      );
    });

    it('a rejected auth-key write cannot appear in a child provider snapshot', () => {
      const foreground = new SettingsService();
      expect(() =>
        foreground.setSessionScoped('auth-key', 'sk-leaked'),
      ).toThrow(/not a registry-classified session-scoped setting/);

      const child = new SettingsService({ sessionSource: foreground });
      const snapshot = child.getAllGlobalSettings();

      expect(snapshot['auth-key']).toBeUndefined();
      expect(Object.keys(snapshot)).not.toContain('auth-key');
    });
  });

  // ------------------------------------------------------------------
  // OWNERSHIP — only the foreground owner may mutate the overlay
  // ------------------------------------------------------------------
  describe('overlay ownership (Issue #3151 OWNERSHIP)', () => {
    it('child setSessionScoped fails fast', () => {
      const foreground = new SettingsService();
      const child = new SettingsService({ sessionSource: foreground });

      expect(() => child.setSessionScoped('dumpcontext', 'on')).toThrow(
        /read-only consumer/,
      );
    });

    it('child clearSessionScoped fails fast', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'on');
      const child = new SettingsService({ sessionSource: foreground });

      expect(() => child.clearSessionScoped('dumpcontext')).toThrow(
        /read-only consumer/,
      );
    });

    it('child setSessionScoped does not alter foreground state', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'off');
      const child = new SettingsService({ sessionSource: foreground });

      expect(() => child.setSessionScoped('dumpcontext', 'on')).toThrow(
        /read-only consumer/,
      );

      // Foreground must be unchanged.
      expect(foreground.get('dumpcontext')).toBe('off');
      expect(foreground.getSessionScoped('dumpcontext')).toBe('off');
    });

    it('child getSessionScoped still reads the shared overlay', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'error');
      const child = new SettingsService({ sessionSource: foreground });

      expect(child.getSessionScoped('dumpcontext')).toBe('error');
    });

    it('chained children share the same overlay read-only', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'on');

      const child = new SettingsService({ sessionSource: foreground });
      const grandchild = new SettingsService({ sessionSource: child });

      expect(grandchild.get('dumpcontext')).toBe('on');

      // Grandchild is also read-only.
      expect(() => grandchild.setSessionScoped('dumpcontext', 'off')).toThrow(
        /read-only consumer/,
      );

      // Foreground live change propagates to grandchild.
      foreground.setSessionScoped('dumpcontext', 'error');
      expect(grandchild.get('dumpcontext')).toBe('error');
    });

    it('child can still use ordinary set for non-session writes', () => {
      const foreground = new SettingsService();
      const child = new SettingsService({ sessionSource: foreground });

      // Ordinary writes are not blocked by ownership.
      child.set('temperature', 0.5);
      expect(child.get('temperature')).toBe(0.5);
    });

    it('foreground owner can set and clear session overrides', () => {
      const foreground = new SettingsService();

      foreground.setSessionScoped('dumpcontext', 'on');
      expect(foreground.get('dumpcontext')).toBe('on');

      foreground.clearSessionScoped('dumpcontext');
      expect(foreground.getSessionScoped('dumpcontext')).toBeUndefined();
    });
  });

  // ------------------------------------------------------------------
  // EVENT COMPATIBILITY
  // ------------------------------------------------------------------
  describe('event compatibility (Issue #3151 EVENT)', () => {
    it('repeated ordinary writes still emit change events', () => {
      const svc = new SettingsService();
      const handler = vi.fn();
      svc.on('change', handler);

      svc.set('temperature', 0.5);
      // Historical behavior: every set() emits, even when the value repeats.
      svc.set('temperature', 0.5);

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('a non-session local write emits with the written value', () => {
      const svc = new SettingsService();
      const handler = vi.fn();
      svc.on('change', handler);

      svc.set('temperature', 0.7);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({
        key: 'temperature',
        oldValue: undefined,
        newValue: 0.7,
      });
    });

    it('does not emit when a shadowed session-scoped local write has no effective transition', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'off');

      const child = new SettingsService({ sessionSource: foreground });
      const handler = vi.fn();
      child.on('change', handler);

      child.set('dumpcontext', 'on');

      // The effective value is still 'off' (session override). No transition.
      expect(handler).not.toHaveBeenCalled();
    });

    it('emits a change event when the session value actually changes', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'off');

      const handler = vi.fn();
      foreground.on('change', handler);

      foreground.setSessionScoped('dumpcontext', 'on');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({
        key: 'dumpcontext',
        oldValue: 'off',
        newValue: 'on',
      });
    });

    it('a session-scoped local write without a session override emits', () => {
      // No session override — the local write IS the effective value.
      const svc = new SettingsService();
      const handler = vi.fn();
      svc.on('change', handler);

      svc.set('dumpcontext', 'on');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({
        key: 'dumpcontext',
        newValue: 'on',
      });
    });
  });

  // ------------------------------------------------------------------
  // CANONICAL — truthful canonical key resolution
  // ------------------------------------------------------------------
  describe('canonical key resolution (Issue #3151 CANONICAL)', () => {
    it('stores and reads a session-scoped key by its canonical form', () => {
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'on');

      // The overlay stores the canonical key; reads converge regardless
      // of the alias/canonical path.
      expect(foreground.getSessionScoped('dumpcontext')).toBe('on');
      expect(foreground.get('dumpcontext')).toBe('on');
    });

    it('resolves a non-alias canonical key through the public API', () => {
      // dumpcontext is the only session-scoped key and has no alias. Prove
      // the canonical path works end-to-end without relying on aliases.
      const foreground = new SettingsService();
      foreground.setSessionScoped('dumpcontext', 'error');

      const child = new SettingsService({ sessionSource: foreground });
      expect(child.get('dumpcontext')).toBe('error');
      expect(child.getSessionScoped('dumpcontext')).toBe('error');
      expect(child.getAllGlobalSettings().dumpcontext).toBe('error');
    });
  });
});
