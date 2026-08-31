/**
 * Behavioral tests for the registry `owner` / `propagation` metadata (#2642).
 *
 * Every registry key must carry a non-empty `owner` and `propagation`, the
 * owner values must fall within the documented union, and the application-owned
 * cluster (emojifilter / dumponerror / dumpcontext) must be excluded from
 * profile persistence while the new application-owned helpers agree.
 *
 * These are pure registry tests — no filesystem, no mocks.
 */

import { describe, it, expect } from 'bun:test';
import {
  SETTINGS_REGISTRY,
  getProfilePersistableKeys,
  getApplicationOwnedKeys,
  isApplicationOwnedKey,
} from '../settings/settingsRegistry.js';

const ALLOWED_OWNERS = new Set([
  'application',
  'provider-connection',
  'model',
  'agent-policy',
]);

const ALLOWED_PROPAGATION = new Set([
  'render-immediate',
  'next-turn',
  'service-reconfigure',
  'profile-transition',
  'restart-required',
]);

// Key per owner that is part of the profile persistence surface.
const REPRESENTATIVE_KEYS: Record<
  'application' | 'provider-connection' | 'model' | 'agent-policy',
  string
> = {
  application: 'emojifilter',
  'provider-connection': 'auth-key',
  model: 'reasoning.enabled',
  'agent-policy': 'tools.allowed',
};

describe('settings registry — owner / propagation metadata (#2642)', () => {
  it('every registry entry has a non-empty owner and propagation', () => {
    // Guard against a vacuous pass if the registry is ever empty or unloaded.
    // Deliberately a non-empty check rather than a headcount: legitimate
    // registry cleanup must not fail this contract test.
    expect(SETTINGS_REGISTRY.length).toBeGreaterThan(0);

    for (const spec of SETTINGS_REGISTRY) {
      expect(spec.owner.length).toBeGreaterThan(0);
      expect(spec.propagation.length).toBeGreaterThan(0);
      expect(ALLOWED_OWNERS.has(spec.owner)).toBe(true);
      expect(ALLOWED_PROPAGATION.has(spec.propagation)).toBe(true);
    }
  });

  it('each representative key maps to its documented owner', () => {
    const byKey = new Map<string, string>(
      SETTINGS_REGISTRY.map((s) => [s.key, s.owner]),
    );
    for (const [owner, key] of Object.entries(REPRESENTATIVE_KEYS)) {
      // `?? '(missing)'` keeps both sides `string` and gives a readable
      // failure if a representative key is ever removed from the registry.
      expect(byKey.get(key) ?? '(missing)').toBe(owner);
    }
  });

  it('getApplicationOwnedKeys includes the application-owned keys', () => {
    const appKeys = getApplicationOwnedKeys();
    for (const key of ['emojifilter', 'dumponerror', 'dumpcontext']) {
      expect(appKeys).toContain(key);
    }
  });

  it('isApplicationOwnedKey is true for application keys and false for others', () => {
    expect(isApplicationOwnedKey('emojifilter')).toBe(true);
    expect(isApplicationOwnedKey('dumpcontext')).toBe(true);
    expect(isApplicationOwnedKey('auth-key')).toBe(false);
    expect(isApplicationOwnedKey('reasoning.enabled')).toBe(false);
  });

  it('application-owned keys are excluded from profile persistence', () => {
    const keys = getProfilePersistableKeys();
    const persistable = new Set(keys);

    // Positive control: without this the exclusion assertions below would
    // still pass if the persistable set were ever empty.
    expect(keys.length).toBeGreaterThan(0);
    expect(persistable.has('auth-key')).toBe(true);

    for (const key of ['emojifilter', 'dumponerror', 'dumpcontext']) {
      expect(persistable.has(key)).toBe(false);
    }
  });

  it('the three application keys declare persistToProfile: false in the registry', () => {
    // Asserting the registry data directly, not just the derived list: if
    // getProfilePersistableKeys() ever excluded these for an unrelated reason
    // the exclusion test above would still pass while the data stayed wrong.
    for (const key of ['emojifilter', 'dumponerror', 'dumpcontext']) {
      const spec = SETTINGS_REGISTRY.find((s) => s.key === key);
      expect(spec).toBeDefined();
      expect(spec?.owner).toBe('application');
      expect(spec?.persistToProfile).toBe(false);
    }
  });

  it('getProfilePersistableKeys matches exactly the specs flagged persistToProfile', () => {
    // End-to-end contract: the derived list is the flag, nothing more.
    const expected = SETTINGS_REGISTRY.filter((s) => s.persistToProfile).map(
      (s) => s.key,
    );
    expect(getProfilePersistableKeys().sort()).toStrictEqual(expected.sort());
  });

  it('persistence follows the per-spec flag, not a blanket owner rule', () => {
    // `token-usage-log` is application-owned but explicitly persists. A blanket
    // `owner !== 'application'` filter would silently drop it and contradict
    // its own spec.
    const tokenUsageLog = SETTINGS_REGISTRY.find(
      (s) => s.key === 'token-usage-log',
    );
    expect(tokenUsageLog).toBeDefined();
    expect(tokenUsageLog?.owner).toBe('application');
    expect(tokenUsageLog?.persistToProfile).toBe(true);
    expect(getProfilePersistableKeys()).toContain('token-usage-log');
  });
});
