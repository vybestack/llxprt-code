import { CliSessionPersistence } from './cliSessionPersistence.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCommandOwners as installCommandOwners } from './__tests__/command-owner-fixture.js';
const makeRenderAgent = installCommandOwners();
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Config, LocalMediaStore } from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { inkRenderOptions } from './ui/inkRenderOptions.js';
import { __setRenderForTesting } from './session/interactiveUI.js';

import { LoadedSettings } from './config/settings.js';

const createFakeAgent = async (_config: Config): Promise<Agent> =>
  makeRenderAgent(crypto.randomUUID());

void vi.mock('./utils/version.js', () => ({
  getCliVersion: vi.fn(() => Promise.resolve('1.0.0')),
}));

void vi.mock('./ui/utils/terminalCapabilityManager.js', () => ({
  terminalCapabilityManager: {
    detectCapabilities: vi.fn(() => Promise.resolve()),
    isKittyProtocolEnabled: vi.fn(() => false),
    enableKittyProtocol: vi.fn(),
    disableKittyProtocol: vi.fn(),
    getTerminalName: vi.fn(() => undefined),
    getTerminalBackgroundColor: vi.fn(() => undefined),
  },
}));

void vi.mock('./ui/utils/updateCheck.js', () => ({
  checkForUpdates: vi.fn(() => Promise.resolve(null)),
}));

void vi.mock('./utils/cleanup.js', () => ({
  registerCleanup: vi.fn(),
  registerSyncCleanup: vi.fn(),
}));

const actual = { ...(await import('@vybestack/llxprt-code-core')) };
void vi.mock('@vybestack/llxprt-code-core', () => ({
  ...actual,
  writeToStdout: vi.fn().mockReturnValue(true),
  writeToStderr: vi.fn().mockReturnValue(true),
  patchStdio: vi.fn(() => vi.fn()),
}));

void vi.mock('./utils/sandbox.js', () => ({
  start_sandbox: vi.fn(() => Promise.resolve(0)),
}));

// Ink is an async ESM module that cannot be loaded via require() once the
// OpenTelemetry require-in-the-middle hook (installed transitively by core)
// is active. vi.mock('ink') triggers that require path under Bun, so we use
// the __setRenderForTesting seam exported by interactiveUI.tsx instead. The
// Bun preload plugin already redirects all `import ... from 'ink'` to the
// ink-stub, so transitive imports resolve normally.
const renderSpy = vi.fn().mockReturnValue({
  waitUntilExit: vi.fn(async () => undefined),
  clear: vi.fn(),
  unmount: vi.fn(),
});

const createLoadedSettings = () =>
  new LoadedSettings(
    { settings: {}, path: '/dev/null/system.json' },
    { settings: {}, path: '/dev/null/system-defaults.json' },
    { settings: {}, path: '/dev/null/user.json' },
    { settings: {}, path: '/dev/null/workspace.json' },
    true,
  );

const startupOwners: SessionSettingsOwner[] = [];

describe('startInteractiveUI ink render options', () => {
  afterEach(async () => {
    for (const owner of startupOwners.splice(0)) await owner.dispose();
  });
  let tempDir: string;

  // Module loading (cli.js + transitive deps) is expensive in jsdom;
  // full-suite coverage runs can make the cold import exceed the workspace
  // timeout. Per-test timeouts keep assertions intact while avoiding
  // cross-test overlap when a test times out mid-import.

  beforeEach(() => {
    vi.clearAllMocks();
    renderSpy.mockReturnValue({
      waitUntilExit: vi.fn(async () => undefined),
      clear: vi.fn(),
      unmount: vi.fn(),
    });
    __setRenderForTesting(renderSpy);
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-render-test-'));
  });

  afterEach(() => {
    __setRenderForTesting(null);
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('passes computed Ink render options to ink.render()', async () => {
    const { startInteractiveUI } = await import(
      './__tests__/raw-interactive-startup-fixture.js'
    );
    const config = new Config({
      sessionId: 'test-session',
      targetDir: tempDir,
      cwd: tempDir,
      debugMode: false,
      model: 'gemini-2.5-flash-lite',
      accessibility: { screenReader: false },
    });

    const settings = createLoadedSettings();

    await startInteractiveUI(
      config,
      await createFakeAgent(config),
      settings,
      [],
      tempDir,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'raw',
      rawPersistence(tempDir),
      startupSettings(),
    );

    expect(renderSpy).toHaveBeenCalledTimes(1);
    const [_reactElement, options] = renderSpy.mock.calls[0];
    const expectedRenderOptions = inkRenderOptions(config, settings);
    expect(options).toStrictEqual(
      expect.objectContaining({
        exitOnCtrlC: false,
        patchConsole: false,
        isScreenReaderEnabled: false,
        alternateBuffer: expectedRenderOptions.alternateBuffer,
        incrementalRendering: expectedRenderOptions.incrementalRendering,
      }),
    );
  }, 120_000);

  it('forces alternate buffer off when screen reader mode is enabled', async () => {
    const { startInteractiveUI } = await import(
      './__tests__/raw-interactive-startup-fixture.js'
    );
    const config = new Config({
      sessionId: 'test-session',
      targetDir: tempDir,
      cwd: tempDir,
      debugMode: false,
      model: 'gemini-2.5-flash-lite',
      accessibility: { screenReader: true },
    });

    await startInteractiveUI(
      config,
      await createFakeAgent(config),
      createLoadedSettings(),
      [],
      tempDir,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'raw',
      rawPersistence(tempDir),
      startupSettings(),
    );

    expect(renderSpy).toHaveBeenCalledTimes(1);
    const [_reactElement, options] = renderSpy.mock.calls[0];
    expect(options).toStrictEqual(
      expect.objectContaining({
        exitOnCtrlC: false,
        patchConsole: false,
        isScreenReaderEnabled: true,
        alternateBuffer: false,
        incrementalRendering: false,
      }),
    );
  }, 120_000);
});

function startupSettings(): SessionSettingsOwner {
  const store = new SettingsService();
  const owner = new SessionSettingsOwner(store);
  startupOwners.push(owner);
  return owner;
}

function rawPersistence(root: string): CliSessionPersistence {
  return new CliSessionPersistence(
    { projectRoot: root, chatsDir: path.join(root, 'chats') },
    {
      mediaStore: new LocalMediaStore({
        rootDirectory: path.join(root, 'media'),
        quotaBytes: 1024,
      }),
    },
  );
}
