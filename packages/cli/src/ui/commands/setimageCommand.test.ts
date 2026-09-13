/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'bun:test';
import {
  createImageProfileRuntimeState,
  type ActiveImageProfile,
} from '@vybestack/llxprt-code-core';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import { setCommand } from './setCommand.js';
import { createCompletionHandler } from './schema/index.js';
import { setimageCommand } from './setimageCommand.js';

const state = createImageProfileRuntimeState();
const textSettings = new Map<string, unknown>();
void vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => ({
    getActiveImageProfile: () => state.getActive(),
    setActiveImageProfile: (selection: ActiveImageProfile) =>
      state.select(selection),
    setEphemeralSetting: (key: string, value: unknown) =>
      textSettings.set(key, value),
  }),
}));
const context = createMockCommandContext();
const run = (args: string) => setimageCommand.action!(context, args);

describe('setimage', () => {
  beforeEach(() => {
    textSettings.clear();
    state.select({
      profile: {
        version: 1,
        type: 'image',
        backend: 'codex',
        model: 'gpt-image-2',
        baseUrl: 'https://chatgpt.com/backend-api/codex',
        auth: { type: 'oauth', provider: 'codex' },
      },
    });
  });

  it('completes image parameters and registry values without reading text state', async () => {
    await run('modelparam image_only 42');
    const complete = createCompletionHandler(setimageCommand.schema!);
    for (const args of ['modelparam ', 'unset modelparam ']) {
      const result = await complete(context, args, `/setimage ${args}`);
      expect(result.suggestions.map((item) => item.value)).toStrictEqual([
        'image_only',
      ]);
    }
    const result = await complete(
      context,
      'streaming ',
      '/setimage streaming ',
    );
    expect(result.suggestions.map((item) => item.value)).toContain('enabled');
  });

  it('sets and clears image ephemeral settings without leaking text settings', async () => {
    await setCommand.action!(context, 'socket-timeout 9000');
    expect(state.getActive()?.profile.ephemeralSettings).toBeUndefined();
    expect(await run('socket-timeout 12000')).toMatchObject({
      messageType: 'info',
    });
    expect(state.getActive()?.profile.ephemeralSettings).toStrictEqual({
      'socket-timeout': 12000,
    });
    expect(textSettings.get('socket-timeout')).toBe(9000);
    await run('unset socket-timeout');
    expect(state.getActive()?.profile.ephemeralSettings).toStrictEqual({});
    expect(textSettings.get('socket-timeout')).toBe(9000);
  });

  it('sets, clears one, and clears all image model parameters', async () => {
    await run('modelparam temperature 0.7');
    await run('modelparam seed 42');
    expect(state.getActive()?.profile.modelParams).toStrictEqual({
      temperature: 0.7,
      seed: 42,
    });
    await run('unset modelparam temperature');
    expect(state.getActive()?.profile.modelParams).toStrictEqual({ seed: 42 });
    await run('unset modelparam');
    expect(state.getActive()?.profile.modelParams).toStrictEqual({});
    expect(textSettings.size).toBe(0);
  });

  it.each([
    'modelparam temperature nope',
    'modelparam top_p true',
    'socket-timeout nope',
    'unknown-setting 1',
  ])(
    'rejects invalid input without changing the active profile: %s',
    async (args) => {
      const before = state.getActive();
      expect(await run(args)).toMatchObject({
        type: 'message',
        messageType: 'error',
      });
      expect(state.getActive()).toBe(before);
    },
  );

  it.each([
    'socket-timeout 12000',
    'modelparam seed 42',
    'unset socket-timeout',
    'unset modelparam seed',
    'unset modelparam',
  ])('requires an active image configuration for %s', async (args) => {
    state.reset();
    expect(await run(args)).toMatchObject({
      type: 'message',
      messageType: 'error',
      content: expect.stringContaining('/model image'),
    });
    expect(textSettings.size).toBe(0);
  });

  it('retains the saved name and does not mutate the selected source profile', async () => {
    const active = state.getActive()!;
    state.select({ ...active, name: 'saved' });
    await run('modelparam seed 42');
    expect(state.getActive()?.name).toBe('saved');
    expect(active.profile.modelParams).toBeUndefined();
  });

  it.each(['', 'unset', 'modelparam seed', 'unset modelparam seed extra'])(
    'reports usage errors for %s',
    async (args) => {
      expect(await run(args)).toMatchObject({ messageType: 'error' });
    },
  );
});
