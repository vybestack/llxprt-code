/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProfileManager } from '@vybestack/llxprt-code-settings';
import { SubagentManager } from '@vybestack/llxprt-code-core';
import { listProfiles } from './profiles.js';

describe('conversational profile surfaces', () => {
  let directory: string;
  let manager: ProfileManager;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'model-profile-surfaces-'));
    manager = new ProfileManager(directory);
    await manager.saveProfile('chat', {
      version: 1,
      provider: 'openai',
      model: 'chat',
      modelParams: {},
      ephemeralSettings: {},
    });
    await manager.saveImageProfile('art', {
      version: 1,
      type: 'image',
      backend: 'openai-images',
      model: 'klein',
      baseUrl: 'http://localhost:8321/v1',
      auth: { type: 'none' },
    });
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('lists only conversational profiles through the app service', async () => {
    expect(
      (await listProfiles({ profilesDir: directory })).profiles,
    ).toStrictEqual(['chat']);
  });

  it('rejects image profiles as subagent model references', async () => {
    const subagents = new SubagentManager(directory, manager);
    expect(await subagents.validateProfileReference('art')).toBe(false);
    expect(await subagents.validateProfileReference('chat')).toBe(true);
  });
});
