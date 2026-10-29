/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from './SettingsService.js';

describe('externally borrowed session override reads', () => {
  it('keeps live explicit overrides distinct from captured persistent settings and local profile writes', () => {
    const foreground = new SettingsService();
    foreground.set('dumpcontext', 'error');
    foreground.setProviderSetting('openai', 'model', 'captured-model');
    const snapshot = foreground.exportForStateSnapshot();
    const child = SettingsService.withReadOnlySessionOverrides(
      foreground.readSessionOverrides(),
    );
    child.restoreFromStateSnapshot(snapshot);
    foreground.setProviderSetting('openai', 'model', 'later-host-model');
    child.set('dumpcontext', 'off');
    expect(child.get('dumpcontext')).toBe('off');
    foreground.setSessionScoped('dumpcontext', 'on');
    expect(child.get('dumpcontext')).toBe('on');
    expect(child.getAllGlobalSettings().dumpcontext).toBe('on');
    expect(child.getProviderSettings('openai').model).toBe('captured-model');
    child.clear();
    child.restoreFromStateSnapshot(snapshot);
    expect(child.get('dumpcontext')).toBe('on');
    foreground.clearSessionScoped('dumpcontext');
    expect(child.get('dumpcontext')).toBe('error');
    expect(() => child.setSessionScoped('dumpcontext', 'off')).toThrow(
      /read-only/,
    );
    expect(() => child.clearSessionScoped('dumpcontext')).toThrow(/read-only/);
  });

  it('preserves has-versus-undefined shadowing and chained read-only ownership', () => {
    const owner = new SettingsService();
    const child = SettingsService.withReadOnlySessionOverrides(
      owner.readSessionOverrides(),
    );
    const grandchild = new SettingsService({ sessionSource: child });
    child.set('dumpcontext', 'error');
    grandchild.set('dumpcontext', 'off');
    owner.setSessionScoped('dumpcontext', undefined);
    expect(child.get('dumpcontext')).toBeUndefined();
    expect(grandchild.get('dumpcontext')).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(
        child.getAllGlobalSettings(),
        'dumpcontext',
      ),
    ).toBe(true);
    owner.clearSessionScoped('dumpcontext');
    expect(child.get('dumpcontext')).toBe('error');
    expect(grandchild.get('dumpcontext')).toBe('off');
    expect(() => grandchild.setSessionScoped('dumpcontext', 'on')).toThrow(
      /read-only/,
    );
    expect(() => child.getSessionScoped('auth-key')).toThrow(
      /not a registry-classified/,
    );
  });

  it('keeps separate roots and ordinary-local change notifications independent', () => {
    const first = new SettingsService();
    const second = new SettingsService();
    const child = SettingsService.withReadOnlySessionOverrides(
      first.readSessionOverrides(),
    );
    const peer = SettingsService.withReadOnlySessionOverrides(
      second.readSessionOverrides(),
    );
    const changed: string[] = [];
    child.on('change', (event) => {
      changed.push(event.key);
    });
    first.setSessionScoped('dumpcontext', 'on');
    child.set('dumpcontext', 'off');
    expect(changed).toStrictEqual([]);
    second.setSessionScoped('dumpcontext', 'error');
    expect(peer.get('dumpcontext')).toBe('error');
    child.set('context-limit', 4096);
    expect(changed).toStrictEqual(['context-limit']);
    expect(peer.get('context-limit')).toBeUndefined();
    const detached = first.readSessionOverrides().toObject();
    detached.dumpcontext = 'off';
    expect(child.get('dumpcontext')).toBe('on');
  });
});
