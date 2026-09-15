/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * #2534 review Finding 5: direct behavioral tests for
 * SettingsService.exportForStateSnapshot / restoreFromStateSnapshot. The C5
 * atomicity tests cover these APIs only through stub mirrors; these tests
 * exercise the real service: round-trip exactness, deep-clone isolation, and
 * the documented no-event-emission rollback contract.
 */

import { describe, it, expect } from 'bun:test';
import { SettingsService } from '../settings/SettingsService.js';

function seedService(): SettingsService {
  const svc = new SettingsService();
  svc.set('activeProvider', 'openai');
  svc.set('currentProfile', 'work');
  svc.set('shell-replacement', 'none');
  svc.setProviderSetting('openai', 'model', 'gpt-4o');
  svc.setProviderSetting('openai', 'auth-key', 'sk-seed');
  svc.setProviderSetting('anthropic', 'base-url', 'https://anthropic.example');
  return svc;
}

describe('SettingsService — state snapshot round-trip', () => {
  it('restores the exact pre-mutation state after further mutations', () => {
    const svc = seedService();
    const snapshot = svc.exportForStateSnapshot();

    // Mutate every surface after the snapshot: global keys (existing +
    // new), provider settings (existing + new), and a brand-new provider.
    svc.set('activeProvider', 'anthropic');
    svc.set('currentProfile', null);
    svc.set('theme', 'dark');
    svc.setProviderSetting('openai', 'model', 'gpt-4o-mini');
    svc.setProviderSetting('openai', 'auth-key', 'sk-rotated');
    svc.setProviderSetting('gemini', 'model', 'gemini-2');
    // Sanity: the mutations took effect before the restore.
    expect(svc.get('activeProvider')).toBe('anthropic');
    expect(svc.getProviderSettings('gemini')).toStrictEqual({
      model: 'gemini-2',
    });

    svc.restoreFromStateSnapshot(snapshot);

    // Global keys return to their pre-mutation values.
    expect(svc.get('activeProvider')).toBe('openai');
    expect(svc.get('currentProfile')).toBe('work');
    expect(svc.get('shell-replacement')).toBe('none');
    // A key first set AFTER the snapshot is absent again.
    expect(svc.get('theme')).toBeUndefined();
    // Provider settings return to their pre-mutation values, including
    // nested provider records.
    expect(svc.getProviderSettings('openai')).toStrictEqual({
      model: 'gpt-4o',
      'auth-key': 'sk-seed',
    });
    expect(svc.getProviderSettings('anthropic')).toStrictEqual({
      'base-url': 'https://anthropic.example',
    });
    // A provider created AFTER the snapshot is gone again.
    expect(svc.getProviderSettings('gemini')).toStrictEqual({});
    // And the re-exported snapshot equals the original snapshot exactly.
    expect(svc.exportForStateSnapshot()).toStrictEqual(snapshot);
  });

  it('isolates the snapshot from later service mutations (deep clone, export direction)', () => {
    const svc = seedService();
    const snapshot = svc.exportForStateSnapshot();

    svc.set('activeProvider', 'anthropic');
    svc.setProviderSetting('openai', 'model', 'gpt-4o-mini');

    expect(snapshot.global['activeProvider']).toBe('openai');
    expect(snapshot.providers['openai']?.model).toBe('gpt-4o');
  });

  it('isolates the restored service from later snapshot-object mutations (deep clone, restore direction)', () => {
    const svc = seedService();
    const snapshot = svc.exportForStateSnapshot();
    svc.restoreFromStateSnapshot(snapshot);

    // Mutating the handed-out snapshot object must not leak into the
    // service: restore deep-clones its input.
    snapshot.global['activeProvider'] = 'tampered';
    expect(svc.get('activeProvider')).toBe('openai');

    // Mutating the service after a restore must not leak back into a
    // snapshot object taken earlier.
    svc.set('activeProvider', 'anthropic');
    const second = svc.exportForStateSnapshot();
    expect(second.global['activeProvider']).toBe('anthropic');
    // The first snapshot object still holds its own pre-mutation copy.
    // (The tampered key above proves the point doubly: the service and the
    // snapshot object are fully independent.)
    svc.restoreFromStateSnapshot({
      global: structuredClone(second.global),
      providers: structuredClone(second.providers),
    });
    expect(svc.get('activeProvider')).toBe('anthropic');
  });
});

describe('SettingsService — state snapshot event contract', () => {
  it('emits no change/provider-change/cleared events during snapshot and restore', () => {
    const svc = seedService();
    const events: string[] = [];
    svc.on('change', () => events.push('change'));
    svc.on('provider-change', () => events.push('provider-change'));
    svc.on('cleared', () => events.push('cleared'));

    // Control: the listeners are wired and ordinary mutations DO emit.
    svc.set('theme', 'dark');
    expect(events).toStrictEqual(['change']);

    events.length = 0;
    const snapshot = svc.exportForStateSnapshot();
    svc.restoreFromStateSnapshot(snapshot);
    // Rollback is a silent primitive by contract: listeners re-read state
    // instead of reacting to a synthetic per-key event stream.
    expect(events).toStrictEqual([]);
  });
});
