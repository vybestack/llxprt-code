/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for global `.env` fallback resolution.
 *
 * The LLxprt-specific global `.env` fallback must resolve through the central
 * Storage config directory (`Storage.getGlobalConfigDir()`), honoring
 * `LLXPRT_CONFIG_HOME`, instead of the legacy `~/.llxprt/.env` path.
 *
 * Runner compatibility: this file uses production
 * dependency injection (`loadEnvironment({ homeDir })`) to control the home
 * directory instead of mocking `node:os`. This makes the test compatible with
 * BOTH Bun and Vitest (no `vi.mock` hoisting / TDZ issues). No test files are
 * excluded from either runner.
 *
 * Strengthened (#9):
 * - `homeDir` is injected so production's home search is deterministically
 *   controlled (no dependence on the real HOME, no `node:os` mocking).
 * - Proves legacy `~/.llxprt/.env` is ignored even when it exists under the
 *   resolved home and no canonical .env is present.
 * - Proves generic `~/.env` remains the final fallback AFTER project-local and
 *   canonical config sources are exhausted.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadEnvironment } from './config.js';

describe('loadEnvironment global .env fallback', () => {
  const ENV_KEYS = [
    'LLXPRT_CONFIG_HOME',
    'LLXPRT_DATA_HOME',
    'LLXPRT_CACHE_HOME',
    'LLXPRT_LOG_HOME',
  ] as const;
  const SAVED_ENV: Record<string, string | undefined> = {};
  let tempRoot = '';
  let tempConfig = '';
  let tempWorkspace = '';
  let fakeHome = '';
  let savedCwd = process.cwd();
  const MARKER = 'A2A_GLOBAL_ENV_TEST_MARKER';
  const SAVED_MARKER = process.env[MARKER];

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-env-root-'));
    tempConfig = path.join(tempRoot, 'config');
    tempWorkspace = path.join(tempRoot, 'workspace');
    fakeHome = path.join(tempRoot, 'fakehome');
    fs.mkdirSync(tempConfig, { recursive: true });
    fs.mkdirSync(tempWorkspace, { recursive: true });
    fs.mkdirSync(fakeHome, { recursive: true });
    for (const key of ENV_KEYS) {
      SAVED_ENV[key] = process.env[key];
      process.env[key] = tempConfig;
    }
    delete process.env[MARKER];
    savedCwd = process.cwd();
    process.chdir(tempWorkspace);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (SAVED_ENV[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = SAVED_ENV[key];
      }
    }
    if (SAVED_MARKER === undefined) {
      delete process.env[MARKER];
    } else {
      process.env[MARKER] = SAVED_MARKER;
    }
    if (savedCwd) {
      process.chdir(savedCwd);
    }
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('loads a global .env from the canonical config directory', () => {
    fs.writeFileSync(
      path.join(tempConfig, '.env'),
      `${MARKER}=from-global-config\n`,
    );
    loadEnvironment({ homeDir: fakeHome });
    expect(process.env[MARKER]).toBe('from-global-config');
  });

  it('does NOT load a legacy ~/.llxprt/.env when the canonical config .env is absent', () => {
    // Place a legacy-style .env under the injected home .llxprt. With the
    // canonical config dir redirected elsewhere, this must not be loaded.
    const legacyLlxprt = path.join(fakeHome, '.llxprt');
    fs.mkdirSync(legacyLlxprt, { recursive: true });
    fs.writeFileSync(
      path.join(legacyLlxprt, '.env'),
      `${MARKER}=from-legacy-llxprt\n`,
    );
    loadEnvironment({ homeDir: fakeHome });
    expect(process.env[MARKER]).toBeUndefined();
  });

  it('project-local .llxprt/.env takes precedence over the global config .env', () => {
    fs.writeFileSync(
      path.join(tempConfig, '.env'),
      `${MARKER}=from-global-config\n`,
    );
    const wsLlxprt = path.join(tempWorkspace, '.llxprt');
    fs.mkdirSync(wsLlxprt, { recursive: true });
    fs.writeFileSync(
      path.join(wsLlxprt, '.env'),
      `${MARKER}=from-workspace-llxprt\n`,
    );
    loadEnvironment({ homeDir: fakeHome });
    expect(process.env[MARKER]).toBe('from-workspace-llxprt');
  });

  it('generic ~/.env remains the final fallback after project-local and canonical sources are absent', () => {
    // No project-local, no canonical config .env. The generic ~/.env under the
    // injected home must be the final fallback.
    fs.writeFileSync(
      path.join(fakeHome, '.env'),
      `${MARKER}=from-generic-home-env\n`,
    );
    loadEnvironment({ homeDir: fakeHome });
    expect(process.env[MARKER]).toBe('from-generic-home-env');
  });

  it('canonical config .env takes precedence over the generic ~/.env fallback', () => {
    fs.writeFileSync(
      path.join(tempConfig, '.env'),
      `${MARKER}=from-global-config\n`,
    );
    fs.writeFileSync(
      path.join(fakeHome, '.env'),
      `${MARKER}=from-generic-home-env\n`,
    );
    loadEnvironment({ homeDir: fakeHome });
    expect(process.env[MARKER]).toBe('from-global-config');
  });

  it('legacy ~/.llxprt/.env is ignored even when the generic ~/.env is the final fallback', () => {
    // Both legacy and generic exist under home; only generic should load.
    const legacyLlxprt = path.join(fakeHome, '.llxprt');
    fs.mkdirSync(legacyLlxprt, { recursive: true });
    fs.writeFileSync(
      path.join(legacyLlxprt, '.env'),
      `${MARKER}=from-legacy-llxprt\n`,
    );
    fs.writeFileSync(
      path.join(fakeHome, '.env'),
      `${MARKER}=from-generic-home-env\n`,
    );
    loadEnvironment({ homeDir: fakeHome });
    expect(process.env[MARKER]).toBe('from-generic-home-env');
  });
});
