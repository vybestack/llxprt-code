/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ProfileManager, SettingsService } from '@vybestack/llxprt-code-core';
import { toolsCommand } from '../ui/commands/toolsCommand.js';
import { createMockCommandContext } from '../test-utils/mockCommandContext.js';
import type { Config } from '@vybestack/llxprt-code-core';

const PROFILE_NAME = 'dev-profile';

describe('tools governance integration', () => {
  let originalHome: string | undefined;
  let tempHome: string;
  let profilesDir: string;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tools-governance-'));
    process.env.HOME = tempHome;
    profilesDir = path.join(tempHome, '.llxprt', 'profiles');
    await fs.mkdir(profilesDir, { recursive: true });
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await fs.rm(tempHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('reflects saved tool restrictions when listing tools', async () => {
    const profilePath = path.join(profilesDir, `${PROFILE_NAME}.json`);
    await fs.writeFile(
      profilePath,
      JSON.stringify(
        {
          version: 1,
          provider: 'openai',
          model: 'test-model',
          modelParams: {
            temperature: 0.2,
            max_tokens: 512,
          },
          ephemeralSettings: {
            'tools.allowed': [],
            'tools.disabled': ['code-editor'],
            'disabled-tools': ['code-editor'],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const settings = new SettingsService();
    const profileManager = new ProfileManager();
    const loadedProfile = await profileManager.loadProfile(PROFILE_NAME);
    expect(loadedProfile.ephemeralSettings['tools.disabled']).toEqual([
      'code-editor',
    ]);
    const setSpy = vi.spyOn(settings, 'set');
    await profileManager.load(PROFILE_NAME, settings);
    expect(setSpy).toHaveBeenCalledWith('tools.disabled', ['code-editor']);
    expect(setSpy).toHaveBeenCalledWith('tools.allowed', []);
    expect(settings.get('tools.disabled')).toEqual(['code-editor']);
    const exported = await settings.exportForProfile();
    expect(exported.tools?.disabled).toEqual(['code-editor']);

    const mockToolRegistry = {
      getAllTools: () => [
        {
          name: 'file-reader',
          displayName: 'File Reader',
          description: 'Reads files',
          schema: {},
        },
        {
          name: 'code-editor',
          displayName: 'Code Editor',
          description: 'Edits files',
          schema: {},
        },
      ],
    };

    const configStub = {
      getToolRegistry: () => mockToolRegistry,
      getSettingsService: () => settings,
      getEphemeralSetting: (key: string) => settings.get(key),
      getEphemeralSettings: () => settings.getAllGlobalSettings(),
      setEphemeralSetting: (key: string, value: unknown) =>
        settings.set(key, value),
    } as unknown as Config;

    const uiAddItem = vi.fn();
    const context = createMockCommandContext({
      services: { config: configStub },
      ui: { addItem: uiAddItem },
    });

    if (!toolsCommand.action) {
      throw new Error('toolsCommand action not defined');
    }

    await toolsCommand.action(context, 'list');

    const listMessage = uiAddItem.mock.calls[0][0].text;
    expect(listMessage).toContain('File Reader [enabled]');
    expect(listMessage).toContain('Code Editor [disabled]');

    await toolsCommand.action(context, 'enable code-editor');
    expect(settings.get('tools.disabled')).toEqual([]);
  });
});
