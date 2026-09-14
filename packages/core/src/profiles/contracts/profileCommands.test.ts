/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import { isProfileCommand } from './profileCommands.js';

describe('isProfileCommand', () => {
  it.each([
    { kind: 'model', model: 'gpt-4o', member: 7 },
    { kind: 'model', model: 'gpt-4o', member: null },
    { kind: 'load', name: 'work', discardUnsaved: 'true' },
    { kind: 'load', name: 'work', discardUnsaved: null },
    { kind: 'load', name: 'work', discardUnsaved: 1 },
    { kind: 'save', name: null },
    { kind: 'startup', profileName: null },
    {
      kind: 'confirm-discard',
      pending: { token: 't', commandKind: 'unknown', description: 'discard' },
    },
  ])('rejects malformed optional fields %j', (payload) => {
    expect(isProfileCommand({ expectedRevision: 3, ...payload })).toStrictEqual(
      false,
    );
  });

  it.each([true, false])('accepts load discardUnsaved=%s', (discardUnsaved) => {
    expect(
      isProfileCommand({
        kind: 'load',
        name: 'work',
        discardUnsaved,
        expectedRevision: 3,
      }),
    ).toStrictEqual(true);
  });

  it.each(['startup', 'setup'])(
    'accepts explicit discard booleans for %s',
    (kind) => {
      for (const discardUnsaved of [true, false]) {
        expect(
          isProfileCommand({ kind, discardUnsaved, expectedRevision: 3 }),
        ).toStrictEqual(true);
      }
    },
  );

  const valid = (
    kind: string,
    extra: Record<string, unknown> = {},
  ): unknown => ({ kind, expectedRevision: 3, ...extra });
  it.each([
    { kind: 'model' },
    { kind: 'model', model: 7 },
    { kind: 'provider' },
    { kind: 'provider', provider: null },
    { kind: 'load' },
    { kind: 'load', name: false },
    { kind: 'set' },
    { kind: 'set', patch: null },
    { kind: 'set', patch: [] },
    { kind: 'set', patch: 'temperature' },
    { kind: 'set', patch: new Date() },
    { kind: 'save', name: 7 },
    { kind: 'startup', profileName: 7 },
    { kind: 'startup', provider: false },
    { kind: 'startup', model: [] },
    { kind: 'startup', member: null },
    { kind: 'startup', discardUnsaved: 'true' },
    { kind: 'startup', discardUnsaved: null },
    { kind: 'setup', discardUnsaved: 'true' },
    { kind: 'setup', discardUnsaved: null },
    { kind: 'confirm-discard' },
    { kind: 'confirm-discard', pending: null },
    { kind: 'confirm-discard', pending: [] },
    { kind: 'confirm-discard', pending: {} },
    {
      kind: 'confirm-discard',
      pending: { token: 7, commandKind: 'load', description: 'discard' },
    },
    {
      kind: 'confirm-discard',
      pending: { token: 't', commandKind: 7, description: 'discard' },
    },
    {
      kind: 'confirm-discard',
      pending: { token: 't', commandKind: 'load', description: 7 },
    },
    { kind: 'confirm-discard', pending: { token: 't', commandKind: 'load' } },
  ])('rejects malformed payload %j', (payload) => {
    expect(isProfileCommand({ expectedRevision: 3, ...payload })).toBe(false);
  });

  it.each(['save', 'startup'])(
    'accepts omitted optional fields for %s',
    (kind) => {
      expect(isProfileCommand(valid(kind))).toBe(true);
    },
  );

  it('accepts a model command', () => {
    const cmd = valid('model', { model: 'claude-3-7-sonnet', member: 'a' });
    expect(isProfileCommand(cmd)).toBe(true);
  });

  it('accepts a provider command', () => {
    const cmd = valid('provider', { provider: 'openai' });
    expect(isProfileCommand(cmd)).toBe(true);
  });

  it.each([true, false])(
    'accepts provider discardUnsaved=%s',
    (discardUnsaved) => {
      expect(
        isProfileCommand(
          valid('provider', { provider: 'openai', discardUnsaved }),
        ),
      ).toStrictEqual(true);
    },
  );

  it.each(['true', null, 1])(
    'rejects provider discardUnsaved=%s',
    (discardUnsaved) => {
      expect(
        isProfileCommand(
          valid('provider', { provider: 'openai', discardUnsaved }),
        ),
      ).toStrictEqual(false);
    },
  );

  it('accepts a load command', () => {
    const cmd = valid('load', { name: 'work', discardUnsaved: true });
    expect(isProfileCommand(cmd)).toBe(true);
  });

  it('accepts a setup command', () => {
    const cmd = valid('setup');
    expect(isProfileCommand(cmd)).toBe(true);
  });

  it('accepts a set command', () => {
    const cmd = valid('set', { patch: { temperature: 0.2 } });
    expect(isProfileCommand(cmd)).toBe(true);
  });

  it('accepts a save command', () => {
    const cmd = valid('save', { name: 'saved-profile' });
    expect(isProfileCommand(cmd)).toBe(true);
  });

  it('accepts a startup command', () => {
    const cmd = valid('startup', {
      profileName: 'work',
      model: 'claude-3-7-sonnet',
      provider: 'anthropic',
      member: 'a',
    });
    expect(isProfileCommand(cmd)).toBe(true);
  });

  it('accepts a confirm-discard command with a valid pending payload', () => {
    const cmd = valid('confirm-discard', {
      pending: {
        token: 'tok-1',
        commandKind: 'load',
        description: 'discard unsaved changes',
      },
    });
    expect(isProfileCommand(cmd)).toBe(true);
  });

  it('rejects a command with a missing expectedRevision', () => {
    const cmd: unknown = { kind: 'setup' };
    expect(isProfileCommand(cmd)).toBe(false);
  });

  it('rejects a command with a non-number expectedRevision', () => {
    const cmd: unknown = { kind: 'setup', expectedRevision: '3' };
    expect(isProfileCommand(cmd)).toBe(false);
  });

  it('rejects an unknown kind string', () => {
    const cmd = valid('list');
    expect(isProfileCommand(cmd)).toBe(false);
  });

  it('rejects null', () => {
    expect(isProfileCommand(null)).toBe(false);
  });

  it('rejects an array', () => {
    expect(isProfileCommand(['setup', 3])).toBe(false);
  });

  it('rejects a confirm-discard command with a malformed pending payload', () => {
    const cmd = valid('confirm-discard', { pending: { token: 7 } });
    expect(isProfileCommand(cmd)).toBe(false);
  });
});
