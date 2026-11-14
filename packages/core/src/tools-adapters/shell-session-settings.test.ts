/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import {
  SettingsService,
  getSettingSpec,
} from '@vybestack/llxprt-code-settings';
import { Config } from '../config/config.js';
import { SessionSettingsOwner } from '../session/session-settings-owner.js';
import { WorkspaceFilesystemOwner } from '../services/workspace-filesystem-owner.js';
import { CoreShellToolHostAdapter } from './CoreShellToolHostAdapter.js';

describe('shell session acquisition policy', () => {
  it('resolves live shell acquisition settings from the selected session without changing a peer', () => {
    const config = new Config({
      model: 'shell-model',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      sessionId: 'shell-settings-owner',
      debugMode: false,
    });
    const first = new SessionSettingsOwner(new SettingsService());
    const second = new SessionSettingsOwner(new SettingsService());
    const workspace = new WorkspaceFilesystemOwner({
      targetDir: config.getTargetDir(),
      isTrusted: () => true,
    });
    const firstHost = new CoreShellToolHostAdapter(
      config,
      workspace.paths,
      () => first.readToolExecutionPolicy(),
    );
    const secondHost = new CoreShellToolHostAdapter(
      config,
      workspace.paths,
      () => second.readToolExecutionPolicy(),
    );
    expect(
      firstHost.getShellExecutionConfig().executionOptions
        .outputRetentionMaxBytes,
    ).toBeUndefined();
    first.writeUserParameter('shell-output-retention-max-bytes', -1);
    first.writeUserParameter('shell-inactivity-timeout-seconds', 7);
    expect(
      firstHost.getShellExecutionConfig().executionOptions
        .outputRetentionMaxBytes,
    ).toBe(-1);
    expect(firstHost.getShellExecutionConfig().inactivityTimeoutMs).toBe(7000);
    expect(
      secondHost.getShellExecutionConfig().executionOptions
        .outputRetentionMaxBytes,
    ).toBeUndefined();
    expect(secondHost.getShellExecutionConfig().inactivityTimeoutMs).toBe(
      300000,
    );
    first.writeUserParameter('shell-inactivity-timeout-seconds', -1);
    expect(
      firstHost.getShellExecutionConfig().inactivityTimeoutMs,
    ).toBeUndefined();
    first.writeUserParameter('shell-output-retention-max-bytes', undefined);
    expect(
      firstHost.getShellExecutionConfig().executionOptions
        .outputRetentionMaxBytes,
    ).toBeUndefined();
  });

  it('declares the 300 s inactivity default in the settings registry and applies it when nothing is set', () => {
    expect(getSettingSpec('shell-inactivity-timeout-seconds')?.default).toBe(
      300,
    );
    const config = new Config({
      model: 'shell-model',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      sessionId: 'shell-inactivity-default',
      debugMode: false,
    });
    expect(config.getShellExecutionConfig().inactivityTimeoutMs).toBe(300000);
  });

  it('applies a profile value present at startup, including -1 for unlimited', () => {
    const create = (value: number) =>
      new Config({
        model: 'shell-model',
        targetDir: process.cwd(),
        cwd: process.cwd(),
        sessionId: `shell-inactivity-startup-${value}`,
        debugMode: false,
        initialSettings: { 'shell-inactivity-timeout-seconds': value },
      });
    expect(create(900).getShellExecutionConfig().inactivityTimeoutMs).toBe(
      900000,
    );
    expect(
      create(-1).getShellExecutionConfig().inactivityTimeoutMs,
    ).toBeUndefined();
  });

  it('follows a live settings reader over the startup snapshot, so a later profile load applies to direct shell commands', () => {
    const config = new Config({
      model: 'shell-model',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      sessionId: 'shell-inactivity-live',
      debugMode: false,
      initialSettings: { 'shell-inactivity-timeout-seconds': 60 },
    });
    let live: Record<string, unknown> = {};
    config.bindLiveSettingsReader(() => live);
    expect(config.getShellExecutionConfig().inactivityTimeoutMs).toBe(60000);

    live = { 'shell-inactivity-timeout-seconds': 900 };
    expect(config.getShellExecutionConfig().inactivityTimeoutMs).toBe(900000);

    live = { 'shell-inactivity-timeout-seconds': -1 };
    expect(
      config.getShellExecutionConfig().inactivityTimeoutMs,
    ).toBeUndefined();
  });
});
