/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for scripts/telemetry.ts finding 1: the active user
 * settings path must use the shared canonical source resolver (Storage /
 * path-resolver) and honor LLXPRT_CONFIG_HOME / platform. Workspace-local
 * .llxprt settings are retained.
 *
 * The telemetry wrapper resolves the USER_SETTINGS_PATH at module load from
 * the shared `resolveGlobalConfigDir()` authority, which honors
 * LLXPRT_CONFIG_HOME and the platform default (NOT the legacy ~/.llxprt
 * global layout).
 *
 * These tests verify the path resolution behavior directly:
 * 1. resolveGlobalConfigDir() honors LLXPRT_CONFIG_HOME.
 * 2. It does NOT resolve to the legacy ~/.llxprt directory.
 * 3. The telemetry.ts source imports and uses resolveGlobalConfigDir (no
 *    homedir() + '.llxprt' construction).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveGlobalConfigDir,
  resolveEnvOverride,
} from '../../packages/storage/src/config/path-resolver.js';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(__filename), '..', '..');
const TELEMETRY_SOURCE = join(REPO_ROOT, 'scripts', 'telemetry.ts');

describe('scripts/telemetry.ts user settings canonical path', () => {
  it('imports resolveGlobalConfigDir from the shared path-resolver', () => {
    const source = readFileSync(TELEMETRY_SOURCE, 'utf8');
    expect(source).toContain('resolveGlobalConfigDir');
    expect(source).toContain(
      "from '../packages/storage/src/config/path-resolver.js'",
    );
  });

  it('does NOT construct user settings path via homedir() + .llxprt', () => {
    const source = readFileSync(TELEMETRY_SOURCE, 'utf8');
    // The telemetry.ts must NOT use homedir() to construct the user settings
    // path. The homedir import from node:os must be absent.
    expect(source).not.toContain('homedir');
    expect(source).not.toContain('join(homedir()');
    // USER_SETTINGS_PATH must be derived from resolveGlobalConfigDir().
    expect(source).toContain('resolveGlobalConfigDir()');
  });

  it('retains workspace-local .llxprt settings', () => {
    const source = readFileSync(TELEMETRY_SOURCE, 'utf8');
    // WORKSPACE_SETTINGS_PATH is still derived from the project root + .llxprt.
    expect(source).toContain('WORKSPACE_SETTINGS_PATH');
    expect(source).toContain("SETTINGS_DIRECTORY_NAME = '.llxprt'");
  });

  it('resolveGlobalConfigDir honors LLXPRT_CONFIG_HOME', () => {
    const saved = process.env.LLXPRT_CONFIG_HOME;
    try {
      process.env.LLXPRT_CONFIG_HOME = '/custom/config/home';
      const dir = resolveGlobalConfigDir();
      expect(dir).toBe('/custom/config/home');
    } finally {
      if (saved === undefined) {
        delete process.env.LLXPRT_CONFIG_HOME;
      } else {
        process.env.LLXPRT_CONFIG_HOME = saved;
      }
    }
  });

  it('resolveEnvOverride rejects relative paths and empty strings', () => {
    expect(resolveEnvOverride('')).toBeUndefined();
    expect(resolveEnvOverride('   ')).toBeUndefined();
    expect(resolveEnvOverride('relative/path')).toBeUndefined();
    expect(resolveEnvOverride('/absolute/path')).toBe('/absolute/path');
  });

  it('resolveGlobalConfigDir does NOT resolve to ~/.llxprt', () => {
    // When LLXPRT_CONFIG_HOME is unset, resolveGlobalConfigDir returns the
    // platform default (e.g. ~/.config/llxprt-code on Linux), NOT ~/.llxprt.
    const saved = process.env.LLXPRT_CONFIG_HOME;
    try {
      delete process.env.LLXPRT_CONFIG_HOME;
      const dir = resolveGlobalConfigDir();
      expect(dir).not.toContain('.llxprt');
    } finally {
      if (saved !== undefined) {
        process.env.LLXPRT_CONFIG_HOME = saved;
      }
    }
  });
});
