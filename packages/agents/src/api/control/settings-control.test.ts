/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { assembleSettingsControl } from './settings-control.js';

function control(owner: SessionSettingsOwner, assertWrite: () => void) {
  return assembleSettingsControl(
    owner.readNamedParameter.bind(owner),
    owner.captureNamedParameters.bind(owner),
    owner.writeUserParameter.bind(owner),
    owner.readSessionOverride.bind(owner),
    owner.writeSessionOverride.bind(owner),
    owner.clearSessionOverride.bind(owner),
    () => {},
    assertWrite,
  );
}

describe('settings operation ports', () => {
  it('keeps equal-label owners independent and clears only the selected override', () => {
    const a = new SessionSettingsOwner(new SettingsService());
    const b = new SessionSettingsOwner(new SettingsService());
    const left = control(a, () => {});
    const right = control(b, () => {});
    left.setEphemeralSetting('temperature', 0.4);
    left.setSessionSetting('dumpcontext', true);
    right.setSessionSetting('dumpcontext', false);
    left.clearSessionSetting('dumpcontext');
    expect(left.getEphemeralSettings()).toMatchObject({ temperature: 0.4 });
    expect(right.getEphemeralSetting('temperature')).toBeUndefined();
    expect(left.getSessionSetting('dumpcontext')).toBeUndefined();
    expect(right.getSessionSetting('dumpcontext')).toBe(false);
  });

  it('rejects a busy mutation without changing the captured settings', () => {
    const owner = new SessionSettingsOwner(new SettingsService());
    const settings = control(owner, () => {
      throw new Error('busy');
    });
    expect(() => settings.setEphemeralSetting('temperature', 0.5)).toThrow(
      'busy',
    );
    expect(owner.captureNamedParameters()).not.toHaveProperty('temperature');
  });
});
