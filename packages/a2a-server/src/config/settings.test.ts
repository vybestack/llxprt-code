/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for A2A settings trust authorization.
 *
 * Finding 1: Project/workspace settings cannot self-elevate folder trust.
 * The `folderTrust` setting must be derived from user-owned settings only,
 * NOT from workspace/project settings. A workspace settings.json that sets
 * `folderTrust: true` must NOT override the user-level absence of that setting.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const { loadSettings } = await import('./settings.js');

describe('A2A settings folder trust authorization', () => {
  let tempHome: string;
  let tempConfig: string;
  let tempWorkspace: string;
  const ENV_KEYS = [
    'LLXPRT_CONFIG_HOME',
    'LLXPRT_DATA_HOME',
    'LLXPRT_CACHE_HOME',
    'LLXPRT_LOG_HOME',
  ] as const;
  const SAVED_ENV: Record<string, string | undefined> = {};

  beforeEach(() => {
    // tempHome nests tempWorkspace to mirror the real layout (a workspace is
    // commonly a subdir of HOME). User settings now resolve under tempConfig
    // (LLXPRT_CONFIG_HOME), NOT tempHome — tempHome only provides the parent
    // tree for the workspace fixture.
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-settings-home-'));
    tempConfig = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-settings-cfg-'));
    tempWorkspace = fs.mkdtempSync(path.join(tempHome, 'a2a-settings-ws-'));
    for (const key of ENV_KEYS) {
      SAVED_ENV[key] = process.env[key];
      process.env[key] = tempConfig;
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (SAVED_ENV[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = SAVED_ENV[key];
      }
    }
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(tempConfig, { recursive: true, force: true });
  });

  it('user folderTrust:true is honored when workspace has no folderTrust', () => {
    fs.mkdirSync(tempConfig, { recursive: true });
    fs.writeFileSync(
      path.join(tempConfig, 'settings.json'),
      JSON.stringify({ folderTrust: true }),
    );

    const settings = loadSettings(tempWorkspace);
    expect(settings.folderTrust).toBe(true);
  });

  it('user folderTrust absent → workspace folderTrust:true does NOT self-elevate', () => {
    // User has NO folderTrust in settings
    fs.mkdirSync(tempConfig, { recursive: true });
    fs.writeFileSync(
      path.join(tempConfig, 'settings.json'),
      JSON.stringify({}),
    );

    // Workspace tries to self-elevate
    const wsSettingsDir = path.join(tempWorkspace, '.llxprt');
    fs.mkdirSync(wsSettingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsSettingsDir, 'settings.json'),
      JSON.stringify({ folderTrust: true }),
    );

    const settings = loadSettings(tempWorkspace);
    // folderTrust must NOT be true — workspace cannot self-elevate
    expect(settings.folderTrust).not.toBe(true);
  });

  it('user folderTrust:false → workspace folderTrust:true does NOT override', () => {
    fs.mkdirSync(tempConfig, { recursive: true });
    fs.writeFileSync(
      path.join(tempConfig, 'settings.json'),
      JSON.stringify({ folderTrust: false }),
    );

    const wsSettingsDir = path.join(tempWorkspace, '.llxprt');
    fs.mkdirSync(wsSettingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsSettingsDir, 'settings.json'),
      JSON.stringify({ folderTrust: true }),
    );

    const settings = loadSettings(tempWorkspace);
    // User explicitly disabled; workspace cannot override
    expect(settings.folderTrust).toBe(false);
  });

  it('user folderTrust:true → workspace folderTrust:false is honored (workspace can restrict)', () => {
    fs.mkdirSync(tempConfig, { recursive: true });
    fs.writeFileSync(
      path.join(tempConfig, 'settings.json'),
      JSON.stringify({ folderTrust: true }),
    );

    const wsSettingsDir = path.join(tempWorkspace, '.llxprt');
    fs.mkdirSync(wsSettingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsSettingsDir, 'settings.json'),
      JSON.stringify({ folderTrust: false }),
    );

    const settings = loadSettings(tempWorkspace);
    // Workspace can RESTRICT (false) but not ELEVATE (true→true is a no-op, false is restrictive)
    expect(settings.folderTrust).toBe(false);
  });

  it('absent in both user and workspace → folderTrust is undefined (not true)', () => {
    const settings = loadSettings(tempWorkspace);
    expect(settings.folderTrust).toBeUndefined();
  });

  it('non-folderTrust keys still merge from workspace into user', () => {
    fs.mkdirSync(tempConfig, { recursive: true });
    fs.writeFileSync(
      path.join(tempConfig, 'settings.json'),
      JSON.stringify({ showMemoryUsage: true }),
    );

    const wsSettingsDir = path.join(tempWorkspace, '.llxprt');
    fs.mkdirSync(wsSettingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(wsSettingsDir, 'settings.json'),
      JSON.stringify({ coreTools: ['tool-a'] }),
    );

    const settings = loadSettings(tempWorkspace);
    expect(settings.showMemoryUsage).toBe(true);
    expect(settings.coreTools).toStrictEqual(['tool-a']);
  });
});
