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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: vi.fn(() => actual.homedir()),
  };
});

const { loadSettings } = await import('./settings.js');

describe('A2A settings folder trust authorization', () => {
  let tempHome: string;
  let tempWorkspace: string;
  let originalHome: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-settings-home-'));
    tempWorkspace = fs.mkdtempSync(path.join(tempHome, 'a2a-settings-ws-'));
    originalHome = os.homedir();
    vi.mocked(os.homedir).mockReturnValue(tempHome);
  });

  afterEach(() => {
    vi.mocked(os.homedir).mockReturnValue(originalHome);
    fs.rmSync(tempHome, { recursive: true, force: true });
  });

  it('user folderTrust:true is honored when workspace has no folderTrust', () => {
    const homeSettingsDir = path.join(tempHome, '.llxprt');
    fs.mkdirSync(homeSettingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(homeSettingsDir, 'settings.json'),
      JSON.stringify({ folderTrust: true }),
    );

    const settings = loadSettings(tempWorkspace);
    expect(settings.folderTrust).toBe(true);
  });

  it('user folderTrust absent → workspace folderTrust:true does NOT self-elevate', () => {
    // User has NO folderTrust in settings
    const homeSettingsDir = path.join(tempHome, '.llxprt');
    fs.mkdirSync(homeSettingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(homeSettingsDir, 'settings.json'),
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
    const homeSettingsDir = path.join(tempHome, '.llxprt');
    fs.mkdirSync(homeSettingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(homeSettingsDir, 'settings.json'),
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
    const homeSettingsDir = path.join(tempHome, '.llxprt');
    fs.mkdirSync(homeSettingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(homeSettingsDir, 'settings.json'),
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
    const homeSettingsDir = path.join(tempHome, '.llxprt');
    fs.mkdirSync(homeSettingsDir, { recursive: true });
    fs.writeFileSync(
      path.join(homeSettingsDir, 'settings.json'),
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
