/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavior tests for A2A user (global) extension discovery through the
 * central Storage path authority.
 *
 * Contract (AD5 from project-plans/issue2606.md):
 * - User extensions resolve through `Storage.getUserExtensionsDir()`
 *   (`<LLXPRT_DATA_HOME>/extensions`), NOT the legacy `~/.llxprt/extensions`.
 * - The `.gemini/extensions` root under the user home remains a read-only
 *   compatibility source.
 * - Workspace `<workspace>/.llxprt/extensions` is unchanged and takes
 *   precedence when the workspace is trusted.
 * - Legacy `~/.llxprt/extensions` is NOT scanned (startup migration already
 *   copied it to the canonical data dir).
 *
 * Runner compatibility: this file uses production
 * dependency injection (`loadExtensions(ws, { homeDir })`) to control the
 * compat root's home directory instead of mocking `node:os`. This makes the
 * test compatible with BOTH Bun and Vitest (no `vi.mock` hoisting / TDZ
 * issues). No test files are excluded from either runner.
 *
 * These tests use real filesystem I/O against temp directories. The injected
 * `homeDir` isolates the `.gemini` compat root, and `LLXPRT_DATA_HOME`
 * redirects the canonical user extensions dir.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const { loadExtensions, EXTENSIONS_CONFIG_FILENAME } = await import(
  './extension.js'
);

const ENV_KEYS = [
  'LLXPRT_DATA_HOME',
  'LLXPRT_CONFIG_HOME',
  'LLXPRT_CACHE_HOME',
  'LLXPRT_LOG_HOME',
] as const;

interface Harness {
  root: string;
  workspaceDir: string;
  workspaceExtensionsDir: string;
  dataHome: string;
  userExtensionsDir: string;
  fakeHome: string;
}

function createHarness(): Harness {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a2a-userdirs-'));
  const workspaceDir = path.join(root, 'ws');
  const workspaceExtensionsDir = path.join(
    workspaceDir,
    '.llxprt',
    'extensions',
  );
  fs.mkdirSync(workspaceExtensionsDir, { recursive: true });

  const dataHome = path.join(root, 'data');
  const userExtensionsDir = path.join(dataHome, 'extensions');
  fs.mkdirSync(userExtensionsDir, { recursive: true });

  const fakeHome = path.join(root, 'fake-home');
  fs.mkdirSync(fakeHome, { recursive: true });

  return {
    root,
    workspaceDir,
    workspaceExtensionsDir,
    dataHome,
    userExtensionsDir,
    fakeHome,
  };
}

function writeExtension(
  extensionsDir: string,
  extName: string,
  manifest: { name: string; version: string },
): void {
  const extDir = path.join(extensionsDir, extName);
  fs.mkdirSync(extDir, { recursive: true });
  fs.writeFileSync(
    path.join(extDir, EXTENSIONS_CONFIG_FILENAME),
    JSON.stringify(manifest),
  );
}

describe('A2A user extension discovery (canonical Storage path)', () => {
  let harness: Harness;
  let cleanupRoot: string | undefined;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Snapshot env BEFORE createHarness so a harness-creation failure cannot
    // leave afterEach restoring from a stale/empty savedEnv snapshot.
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    harness = createHarness();
    cleanupRoot = harness.root;
    for (const key of ENV_KEYS) {
      process.env[key] = harness.dataHome;
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
    // Guard cleanup: if createHarness threw in beforeEach, cleanupRoot was
    // never assigned. Remove the parent root only when it was created.
    // Cleanup failures surface as an aggregate error via process.exitCode
    // instead of being silently swallowed by console.
    if (cleanupRoot !== undefined) {
      try {
        fs.rmSync(cleanupRoot, { recursive: true, force: true });
      } catch (error) {
        process.exitCode = 1;
        throw new Error(`Failed to cleanup test harness: ${error}`);
      }
    }
  });

  it('discovers a user extension placed under Storage.getUserExtensionsDir()', () => {
    writeExtension(harness.userExtensionsDir, 'canonical-user', {
      name: 'canonical-user',
      version: '1.0.0',
    });

    const extensions = loadExtensions(harness.workspaceDir, {
      folderTrust: false,
      homeDir: harness.fakeHome,
    });
    expect(extensions.some((e) => e.name === 'canonical-user')).toBe(true);
  });

  it('does NOT discover a user extension placed only under legacy ~/.llxprt/extensions', () => {
    const legacyDir = path.join(harness.fakeHome, '.llxprt', 'extensions');
    fs.mkdirSync(legacyDir, { recursive: true });
    writeExtension(legacyDir, 'legacy-user', {
      name: 'legacy-user',
      version: '1.0.0',
    });

    const extensions = loadExtensions(harness.workspaceDir, {
      folderTrust: false,
      homeDir: harness.fakeHome,
    });
    expect(extensions.some((e) => e.name === 'legacy-user')).toBe(false);
  });

  it('still discovers extensions from the ~/.gemini/extensions compatibility root', () => {
    const compatDir = path.join(harness.fakeHome, '.gemini', 'extensions');
    fs.mkdirSync(compatDir, { recursive: true });
    writeExtension(compatDir, 'gemini-compat', {
      name: 'gemini-compat',
      version: '1.0.0',
    });

    const extensions = loadExtensions(harness.workspaceDir, {
      folderTrust: false,
      homeDir: harness.fakeHome,
    });
    expect(extensions.some((e) => e.name === 'gemini-compat')).toBe(true);
  });

  it('keeps workspace extensions taking precedence over user extensions by name', () => {
    writeExtension(harness.userExtensionsDir, 'shared', {
      name: 'shared',
      version: '1.0.0',
    });
    writeExtension(harness.workspaceExtensionsDir, 'shared', {
      name: 'shared',
      version: '2.0.0',
    });

    const extensions = loadExtensions(harness.workspaceDir, {
      folderTrust: true,
      homeDir: harness.fakeHome,
    });
    const shared = extensions.find((e) => e.name === 'shared');
    expect(shared).toBeDefined();
    expect(shared?.version).toBe('2.0.0');
  });

  it('still loads user extensions when folderTrust is false (workspace extensions blocked)', () => {
    writeExtension(harness.userExtensionsDir, 'user-only', {
      name: 'user-only',
      version: '1.0.0',
    });
    writeExtension(harness.workspaceExtensionsDir, 'ws-only', {
      name: 'ws-only',
      version: '1.0.0',
    });

    const extensions = loadExtensions(harness.workspaceDir, {
      folderTrust: false,
      homeDir: harness.fakeHome,
    });
    expect(extensions.some((e) => e.name === 'user-only')).toBe(true);
    expect(extensions.some((e) => e.name === 'ws-only')).toBe(false);
  });

  it('honors LLXPRT_DATA_HOME override for the canonical user extensions dir', () => {
    const customData = path.join(path.dirname(harness.dataHome), 'custom-data');
    fs.mkdirSync(path.join(customData, 'extensions'), { recursive: true });
    writeExtension(path.join(customData, 'extensions'), 'override-ext', {
      name: 'override-ext',
      version: '1.0.0',
    });
    process.env['LLXPRT_DATA_HOME'] = customData;

    const extensions = loadExtensions(harness.workspaceDir, {
      folderTrust: false,
      homeDir: harness.fakeHome,
    });
    expect(extensions.some((e) => e.name === 'override-ext')).toBe(true);
  });
});
