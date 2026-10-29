/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { CredentialAuthority } from '@vybestack/llxprt-code-providers/auth.js';
import {
  AgentProfilePreflight,
  type AgentActivationOperation,
} from '@vybestack/llxprt-code-agents';

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  DEFAULT_CONTEXT_FILENAME,
  setLlxprtMdFilename,
} from '@vybestack/llxprt-code-core';
import { type CliArgs } from './cliArgParser.js';
import type { Settings } from './settings.js';
import { loadCliConfigWithPreflight } from '../__tests__/load-cli-config-fixture.js';
import { transferActivation } from '../__tests__/startup-activation-fixture.js';
import { openRouteBPreflight } from '../../../agents/src/api/__tests__/helpers/route-b-preflight.js';
import { useFakeResponsesReplay } from '../../../agents/src/api/__tests__/helpers/fake-responses-replay.js';

const actual = { ...(await import('@vybestack/llxprt-code-core')) };
void vi.mock('@vybestack/llxprt-code-core', () => ({
  ...actual,
  isRipgrepAvailable: vi.fn().mockResolvedValue(true),
}));

describe('loadCliConfig memory discovery', () => {
  useFakeResponsesReplay('plain-text.jsonl');
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
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  function createSettings(contextFileName: string): Settings {
    return {
      includeDirectories: [] as string[],
      loadMemoryFromIncludeDirectories: false,
      folderTrust: false,
      telemetry: { enabled: false },
      accessibility: { screenReader: false, enableLoadingPhrases: true },
      ui: {
        contextFileName,
        memoryDiscoveryMaxDirs: 200,
      },
      experimental: {
        jitContext: false,
      },
    } as unknown as Settings;
  }

  function createArgv(): CliArgs {
    return {
      model: undefined,
      sandbox: undefined,
      sandboxImage: undefined,
      sandboxEngine: undefined,
      sandboxProfileLoad: undefined,
      debug: false,
      prompt: undefined,
      promptInteractive: undefined,
      outputFormat: undefined,

      showMemoryUsage: false,
      yolo: false,
      approvalMode: undefined,
      telemetry: undefined,
      telemetryLogPrompts: undefined,
      telemetryOutfile: undefined,
      allowedMcpServerNames: undefined,
      experimentalAcp: undefined,
      experimentalUi: undefined,
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
      sessionSummary: undefined,
      dumponerror: undefined,
      promptWords: [],
      set: undefined,
      query: undefined,
      continue: undefined,
      nobrowser: undefined,
      listSessions: undefined,
      deleteSession: undefined,
      imageInput: undefined,
      imageOutput: undefined,
      imagePrompt: undefined,
      quiet: undefined,
    };
  }

  it('loads CLI-declared include context when the settings include-memory flag is disabled', async () => {
    const contextFileName = 'AGENTS.md';
    const contextContent = '# Guidance\nAlways follow agent instructions.';
    const includedContextPath = path.join(includeDir, contextFileName);
    await fs.writeFile(includedContextPath, contextContent, 'utf-8');

    const settings = createSettings(contextFileName);

    const argv = createArgv();

    const { ExtensionEnablementManager, ExtensionStorage } = await import(
      './extension.js'
    );
    let operation: AgentActivationOperation | undefined;
    let preflight: AgentProfilePreflight | undefined;
    const config = await loadCliConfigWithPreflight({
      settings,
      extensions: [],
      extensionEnablementManager: new ExtensionEnablementManager(
        ExtensionStorage.getUserExtensionsDir(),
      ),
      sessionId: 'test-session',
      argv,
      cwd: workspaceDir,
      authority: new CredentialAuthority(),
      onActivationBootstrapReady: (owner) => {
        operation = owner;
      },
      onPreflightReady: (owner) => {
        preflight = owner;
      },
    });

    if (operation === undefined || preflight === undefined)
      throw new Error('Missing retained CLI activation root');
    const intent = { provider: 'fake', model: 'fake-model' };
    const activation = await operation.preflight(intent);
    if (activation.token === undefined)
      throw new Error('Missing foreground receipt');
    const agent = await AgentProfilePreflight.createForegroundAgent(
      preflight,
      activation.token,
      intent,
      {},
    );
    try {
      expect(agent.memory.getMemory()).toContain(contextContent);
      expect(agent.memory.getFileCount()).toBeGreaterThan(0);
      expect(config.getProvidedInstructions()).toBe('');
    } finally {
      await agent.dispose();
    }
  });

  it('releases the CLI-created workspace memory exactly once when the activation is disposed', async () => {
    const route = await openRouteBPreflight();
    try {
      const memory = route.memory;
      await route.prepare();
      const operation = transferActivation(route.preflight);
      const originalDispose = memory.dispose.bind(memory);
      let memoryDisposals = 0;
      memory.dispose = () => {
        memoryDisposals += 1;
        return originalDispose();
      };

      await Promise.all([operation.dispose(), operation.dispose()]);

      expect(memoryDisposals).toBe(1);
      expect(() => memory.operations.snapshot()).toThrow(
        'Instructions are disposed',
      );
    } finally {
      await route.close();
    }
  });
});
