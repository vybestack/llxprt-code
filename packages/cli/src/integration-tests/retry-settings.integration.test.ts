/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSetCommand } from '../ui/commands/setCommand.js';
import { createMockCommandContext } from '../__tests__/mockCommandContext.js';
import type { CommandContext, SlashCommand } from '../ui/commands/types.js';
import { Config } from '@vybestack/llxprt-code-core';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

describe('retry settings integration tests', () => {
  let context: CommandContext;
  let setCommand: SlashCommand;
  let config: Config;
  let settingsOwner: SessionSettingsOwner;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-retry-settings-'));
    config = new Config({
      sessionId: 'retry-settings',
      targetDir: directory,
      cwd: directory,
      model: 'test-model',
      debugMode: false,
    });
    settingsOwner = new SessionSettingsOwner(new SettingsService());
    context = createMockCommandContext({
      runtimeApi: {
        setEphemeralSetting: (key: string, value: unknown) =>
          settingsOwner.writeUserParameter(key, value),
      },
      services: { config },
    });
    setCommand = createSetCommand({
      getEphemeralSettings: () => settingsOwner.captureNamedParameters(),
      setEphemeralSetting: (key, value) =>
        settingsOwner.writeUserParameter(key, value),
      getActiveModelParams: () => ({}),
      setActiveModelParam: () => {
        throw new Error('Model parameter operations are unused in this test');
      },
      clearActiveModelParam: () => {
        throw new Error('Model parameter operations are unused in this test');
      },
      isFuzzyFilteringEnabled: () => true,
    });
  });

  afterEach(async () => {
    await settingsOwner.dispose();
    await config.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  it('should set retries as ephemeral setting', async () => {
    const result = await setCommand.action!(context, 'retries 3');

    expect(settingsOwner.readNamedParameter('retries')).toBe(3);

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content:
        "Ephemeral setting 'retries' set to 3 (session only, use /profile save to persist)",
    });
  });

  it('should set retrywait as ephemeral setting', async () => {
    const result = await setCommand.action!(context, 'retrywait 10000');

    expect(settingsOwner.readNamedParameter('retrywait')).toBe(10000);

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'info',
      content:
        "Ephemeral setting 'retrywait' set to 10000 (session only, use /profile save to persist)",
    });
  });

  it('should validate retries setting', async () => {
    const result = await setCommand.action!(context, 'retries -1');

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'error',
      content: 'retries must be a non-negative integer (e.g., 3)',
    });
  });

  it('should validate retrywait setting', async () => {
    const result = await setCommand.action!(context, 'retrywait 0');

    expect(result).toStrictEqual({
      type: 'message',
      messageType: 'error',
      content:
        'retrywait must be a positive integer in milliseconds (e.g., 5000 for 5 seconds)',
    });
  });
});
