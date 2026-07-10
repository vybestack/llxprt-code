/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Verifies WorkspaceContext includeDirectories handling against the REAL
 * filesystem. This is intentionally split out from config.b.test.ts, which
 * installs a global `vi.mock('fs', ...)` that stubs existsSync/statSync/
 * realpathSync and would mask real filesystem behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type { ConfigParameters } from './config.js';
import { Config } from './config.js';
import { getSettingsService } from '@vybestack/llxprt-code-settings';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  createBaseParams,
  resetAgentClientMock,
  type HoistedConfigMocks,
} from './configTestHarness.js';

// NOTE: `fs` is deliberately NOT mocked here so WorkspaceContext resolves real
// directories/symlinks. Only the non-fs dependencies are mocked, using the same
// shared harness bodies as the other config test files.

const hoistedConfigMocks = vi.hoisted<HoistedConfigMocks>(() => ({
  loadJitSubdirectoryMemory: vi.fn(),
  coreEvents: {
    emitFeedback: vi.fn(),
    emitModelChanged: vi.fn(),
    emitConsoleLog: vi.fn(),
  },
  setGlobalProxy: vi.fn(),
}));

vi.mock('@vybestack/llxprt-code-tools', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildToolsMockBody(
    await importOriginal<typeof import('@vybestack/llxprt-code-tools')>(),
  );
});

vi.mock('../core/contentGenerator.js', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildContentGeneratorMockBody(await importOriginal());
});

vi.mock('../telemetry/index.js', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildTelemetryMockBody();
});

vi.mock('../services/gitService.js', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildGitServiceMockBody();
});

vi.mock('@vybestack/llxprt-code-settings', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildSettingsMockBody();
});

vi.mock('@vybestack/llxprt-code-ide-integration', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildIdeIntegrationMockBody(
    await importOriginal<
      typeof import('@vybestack/llxprt-code-ide-integration')
    >(),
  );
});

vi.mock('../utils/memoryDiscovery.js', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildMemoryDiscoveryMockBody(hoistedConfigMocks);
});

vi.mock('../utils/events.js', async (importOriginal) => {
  const h = await import('./configTestHarness.js');
  return h.buildEventsMockBody(await importOriginal(), hoistedConfigMocks);
});

vi.mock('../utils/fetch.js', async () => {
  const h = await import('./configTestHarness.js');
  return h.buildFetchMockBody(hoistedConfigMocks);
});

describe('Server Config includeDirectories (real filesystem)', () => {
  const baseParams = createBaseParams(
    getSettingsService() as unknown as SettingsService,
  );

  beforeEach(() => {
    resetAgentClientMock();
  });

  it('should initialize WorkspaceContext with includeDirectories', () => {
    // Use real directories that exist for this test
    const tempDir = os.tmpdir();
    const resolved = fs.realpathSync(tempDir);
    // Create test subdirectories
    const dir1 = path.join(tempDir, `test-include-dir1-${Date.now()}`);
    const dir2 = path.join(tempDir, `test-include-dir2-${Date.now()}`);
    fs.mkdirSync(dir1, { recursive: true });
    fs.mkdirSync(dir2, { recursive: true });
    try {
      const paramsWithIncludeDirs: ConfigParameters = {
        ...baseParams,
        targetDir: tempDir,
        includeDirectories: [dir1, dir2],
      };
      const config = new Config(paramsWithIncludeDirs);
      const workspaceContext = config.getWorkspaceContext();
      const directories = workspaceContext.getDirectories();
      // Should include the target directory plus the included directories
      expect(directories).toHaveLength(3);
      expect(directories).toContain(resolved);
      expect(directories).toContain(fs.realpathSync(dir1));
      expect(directories).toContain(fs.realpathSync(dir2));
    } finally {
      // Cleanup
      fs.rmSync(dir1, { recursive: true, force: true });
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  });
});
