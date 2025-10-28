/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  DEFAULT_CONTEXT_FILENAME,
  resetSettingsService,
  setLlxprtMdFilename,
} from '@vybestack/llxprt-code-core';
import { loadCliConfig, type CliArgs } from './config.js';
import type { Settings } from './settings.js';

describe('loadCliConfig memory discovery', () => {
  let tempRoot: string;
  let workspaceDir: string;
  let includeDir: string;
  let homeDir: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), 'llxprt-cli-config-test-'),
    );
    workspaceDir = path.join(tempRoot, 'workspace');
    includeDir = path.join(tempRoot, 'include');
    homeDir = path.join(tempRoot, 'home');
    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.mkdir(includeDir, { recursive: true });
    await fs.mkdir(homeDir, { recursive: true });

    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    setLlxprtMdFilename(DEFAULT_CONTEXT_FILENAME);
    resetSettingsService();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('loads context files from include directories even when loadMemoryFromIncludeDirectories is disabled', async () => {
    const contextFileName = 'AGENTS.md';
    const contextContent = '# Guidance\nAlways follow agent instructions.';
    const includedContextPath = path.join(includeDir, contextFileName);
    await fs.writeFile(includedContextPath, contextContent, 'utf-8');

    const settings = {
      contextFileName,
      includeDirectories: [] as string[],
      loadMemoryFromIncludeDirectories: false,
      memoryDiscoveryMaxDirs: 200,
      folderTrust: false,
      telemetry: { enabled: false },
      accessibility: { screenReader: false, disableLoadingPhrases: false },
    } as unknown as Settings;

    const argv: CliArgs = {
      model: undefined,
      sandbox: undefined,
      sandboxImage: undefined,
      debug: false,
      prompt: undefined,
      promptInteractive: undefined,
      allFiles: false,
      showMemoryUsage: false,
      yolo: false,
      approvalMode: undefined,
      telemetry: undefined,
      telemetryTarget: undefined,
      telemetryOtlpEndpoint: undefined,
      telemetryLogPrompts: undefined,
      telemetryOutfile: undefined,
      allowedMcpServerNames: undefined,
      experimentalAcp: undefined,
      extensions: undefined,
      listExtensions: undefined,
      provider: undefined,
      key: undefined,
      keyfile: undefined,
      baseurl: undefined,
      proxy: undefined,
      includeDirectories: [includeDir],
      allowedTools: undefined,
      checkpointing: undefined,
      profileLoad: undefined,
      loadMemoryFromIncludeDirectories: undefined,
      ideMode: undefined,
      screenReader: undefined,
      useSmartEdit: undefined,
      sessionSummary: undefined,
      promptWords: [],
      set: undefined,
    };

    const config = await loadCliConfig(
      settings,
      [],
      'test-session',
      argv,
      workspaceDir,
    );

    expect(config.getUserMemory()).toContain(contextContent);
    expect(config.getLlxprtMdFileCount()).toBeGreaterThan(0);
  });
});
