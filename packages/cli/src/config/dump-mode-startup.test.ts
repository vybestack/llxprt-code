/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { applyDumpContextStartupSettings } from './postConfigRuntime.js';

const owners: SessionSettingsOwner[] = [];

function createOwner(): SessionSettingsOwner {
  const owner = new SessionSettingsOwner(new SettingsService());
  owners.push(owner);
  return owner;
}

describe('dumpcontext startup settings (#4101 P03)', () => {
  afterEach(async () => {
    for (const owner of owners.splice(0)) await owner.dispose();
  });

  it.each([
    { label: 'code default', input: {}, expected: 'off' },
    {
      label: 'user settings default',
      input: { userDefault: 'error' as const },
      expected: 'error',
    },
    {
      label: '--dumponerror',
      input: { userDefault: 'off' as const, dumponerrorFlag: true },
      expected: 'error',
    },
    {
      label: '--set',
      input: { set: ['dumpcontext=error'] },
      expected: 'error',
    },
    {
      label: 'explicit on over shorthand',
      input: { dumponerrorFlag: true, set: ['dumpcontext=on'] },
      expected: 'on',
    },
    {
      label: 'explicit off over shorthand',
      input: { dumponerrorFlag: true, set: ['dumpcontext=off'] },
      expected: 'off',
    },
    {
      label: 'last explicit mode wins',
      input: { set: ['dumpcontext=on', 'dumpcontext=off'] },
      expected: 'off',
    },
  ])('applies $label into the session overlay', async ({ input, expected }) => {
    const owner = createOwner();

    applyDumpContextStartupSettings(owner, input);

    expect(owner.readSessionOverride('dumpcontext')).toBe(expected);
  });

  it('applies user retention limits as session-visible provider settings', () => {
    const owner = createOwner();
    applyDumpContextStartupSettings(owner, {
      userRetention: { maxBytes: 4096, maxAgeDays: 3 },
    });

    expect(owner.readNamedParameter('dump-retention-max-bytes')).toBe(4096);
    expect(owner.readNamedParameter('dump-retention-max-age-days')).toBe(3);
  });

  it('makes the startup override visible to a child session', async () => {
    const settings = new SettingsService();
    const owner = new SessionSettingsOwner(settings);
    const child = new SessionSettingsOwner(owner.createChildStore());
    owners.push(owner, child);

    applyDumpContextStartupSettings(owner, {
      userDefault: 'error',
      dumponerrorFlag: true,
    });

    expect(child.readNamedParameter('dumpcontext')).toBe('error');
  });

  it('rejects an action mode in the user default', () => {
    const owner = createOwner();

    expect(() =>
      applyDumpContextStartupSettings(owner, { userDefault: 'now' }),
    ).toThrow(/settings.json dumpcontext mode/i);
    expect(owner.readSessionOverride('dumpcontext')).toBeUndefined();
  });

  it('rejects action modes in --set and does not persist them', async () => {
    const owner = createOwner();

    expect(() =>
      applyDumpContextStartupSettings(owner, { set: ['dumpcontext=now'] }),
    ).toThrow(/dumpcontext.*off.*error.*on/i);
    expect(owner.readSessionOverride('dumpcontext')).toBeUndefined();
  });

  it('lets a later session command override the startup result', async () => {
    const owner = createOwner();
    applyDumpContextStartupSettings(owner, { dumponerrorFlag: true });

    owner.writeSessionOverride('dumpcontext', 'off');

    expect(owner.readNamedParameter('dumpcontext')).toBe('off');
  });
});
