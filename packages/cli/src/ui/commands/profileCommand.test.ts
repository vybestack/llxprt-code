/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { profileCommand } from './profileCommand.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { CommandContext } from './types.js';

const runtimeMocks = vi.hoisted(() => ({
  saveProfileSnapshot: vi.fn(),
  loadProfileByName: vi.fn(),
  deleteProfileByName: vi.fn(),
  listSavedProfiles: vi.fn(),
  setDefaultProfileName: vi.fn(),
  getActiveProfileName: vi.fn(),
}));

vi.mock('../contexts/RuntimeContext.js', () => ({
  getRuntimeApi: () => runtimeMocks,
}));

describe('profileCommand', () => {
  let context: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockCommandContext();
    runtimeMocks.listSavedProfiles.mockResolvedValue(['alpha', 'beta']);
  });

  describe('save subcommand', () => {
    const save = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'save',
    )!;

    it('saves profile with provided name', async () => {
      await save.action!(context, 'demo');
      expect(runtimeMocks.saveProfileSnapshot).toHaveBeenCalledWith('demo');
    });
  });

  describe('load subcommand', () => {
    const load = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'load',
    )!;

    it('loads profile and surfaces info messages', async () => {
      runtimeMocks.loadProfileByName.mockResolvedValue({
        providerName: 'openai',
        modelName: 'gpt-4',
        infoMessages: ['message one'],
        providerChanged: true,
      });

      const result = await load.action!(context, 'demo');
      expect(runtimeMocks.loadProfileByName).toHaveBeenCalledWith('demo');
      expect(result?.type).toBe('message');
      if (result?.type === 'message') {
        expect(result.content).toContain('message one');
      }
    });
  });

  describe('delete subcommand', () => {
    const del = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'delete',
    )!;

    it('deletes named profile', async () => {
      await del.action!(context, 'demo');
      expect(runtimeMocks.deleteProfileByName).toHaveBeenCalledWith('demo');
    });
  });

  describe('set-default subcommand', () => {
    const setDefault = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'set-default',
    )!;

    it('persists default profile name', async () => {
      await setDefault.action!(context, 'alpha');
      expect(runtimeMocks.setDefaultProfileName).toHaveBeenCalledWith('alpha');
    });

    it('clears default when none specified', async () => {
      await setDefault.action!(context, 'none');
      expect(runtimeMocks.setDefaultProfileName).toHaveBeenCalledWith(null);
    });
  });

  describe('list subcommand', () => {
    const list = profileCommand.subCommands!.find(
      (cmd) => cmd?.name === 'list',
    )!;

    it('lists saved profiles', async () => {
      const result = await list.action!(context, '');
      expect(runtimeMocks.listSavedProfiles).toHaveBeenCalled();
      expect(result?.type).toBe('message');
      if (result?.type === 'message') {
        expect(result.content).toContain('alpha');
        expect(result.content).toContain('beta');
      }
    });
  });
});
