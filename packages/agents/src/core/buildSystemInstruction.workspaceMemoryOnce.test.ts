/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single-send invariant for workspace memory (issue #3135).
 *
 * Two channels can carry the workspace LLXPRT.md hierarchy into a request: the
 * environment-context block (Config.getEnvironmentMemory) and the user-memory
 * channel (Config.getGlobalMemory or Config.getUserMemory). Which branch each
 * takes is decided by the JIT-context predicate, so "exactly once" holds only
 * while there is a single predicate.
 *
 * Nothing in the memory path is substituted: a real LLXPRT.md on disk, a real
 * Config, a real ContextManager, real memory discovery, and the real
 * getEnvironmentContext + buildSystemInstruction. The marker literal exists
 * only on the input side; every assertion is a derived occurrence count.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { initializeTestConfig } from '@vybestack/llxprt-code-core/test-utils/config.js';
import { getEnvironmentContext } from '@vybestack/llxprt-code-core/utils/environmentContext.js';
import { loadServerHierarchicalMemory } from '@vybestack/llxprt-code-core/utils/memoryDiscovery.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { buildSystemInstruction } from './ChatSessionFactory.js';

// A literal, not an import: the provider-agnostic naming regression suite
// forbids provider-prefixed identifiers outside provider boundaries.
const MODEL = 'gemini-2.5-flash';

interface Workspace {
  readonly dir: string;
  readonly marker: string;
}

const tempDirs: string[] = [];
const openConfigs: Config[] = [];

function createWorkspace(): Workspace {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-jit-once-')),
  );
  tempDirs.push(dir);
  // Unique per workspace so the developer's real global memory, which the real
  // loaders also read, can never contribute an occurrence.
  const marker = `WORKSPACE_MEMORY_${randomUUID().replace(/-/g, '')}`;
  fs.writeFileSync(
    path.join(dir, 'LLXPRT.md'),
    `# Workspace instructions\n\n${marker}\n`,
    'utf8',
  );
  return { dir, marker };
}

function occurrencesOf(haystack: string, token: string): number {
  return haystack.split(token).length - 1;
}

async function buildWorkspaceConfig(
  workspace: Workspace,
  options: {
    readonly jitContextEnabled: boolean;
    readonly settingsJitContextEnabled?: boolean;
  },
): Promise<Config> {
  const settingsService = new SettingsService();
  if (options.settingsJitContextEnabled !== undefined) {
    // No production code writes this key. Supplying it proves the predicate
    // cannot be steered by it; before issue #3135 a second predicate read it,
    // which is how the two predicates could disagree.
    settingsService.set('jitContextEnabled', options.settingsJitContextEnabled);
  }

  const config = new Config({
    sessionId: `jit-once-${randomUUID()}`,
    model: MODEL,
    targetDir: workspace.dir,
    cwd: workspace.dir,
    debugMode: false,
    jitContextEnabled: options.jitContextEnabled,
    settingsService,
  });
  openConfigs.push(config);
  await initializeTestConfig(config);

  if (!options.jitContextEnabled) {
    // The production non-JIT path: eagerly load the hierarchy and push it onto
    // Config, as environmentLoader.resolveMemoryContent and
    // memoryCommand.refreshMemoryContent do in the CLI.
    const eager = await loadServerHierarchicalMemory(
      config.getWorkingDir(),
      [],
      config.getDebugMode(),
      config.getFileService(),
      config.getExtensions(),
      true,
    );
    config.setUserMemory(eager.memoryContent);
    config.setLlxprtMdFileCount(eager.fileCount);
    config.setLlxprtMdFilePaths(eager.filePaths);
  }

  return config;
}

interface AssembledRequest {
  readonly environmentContext: string;
  readonly promptBody: string;
  readonly full: string;
}

/**
 * Assembles the system instruction the way ChatSessionFactory.createChatSession
 * does, then splits it back into its two memory-carrying channels.
 */
async function assembleRequest(config: Config): Promise<AssembledRequest> {
  const envParts = await getEnvironmentContext(config);
  const environmentContext = envParts.map((part) => part.text).join('\n');
  const full = await buildSystemInstruction(
    config,
    [],
    envParts,
    undefined,
    MODEL,
  );
  return {
    environmentContext,
    promptBody: full.slice(environmentContext.length),
    full,
  };
}

interface ChannelBreakdown {
  readonly environmentIsPrefix: boolean;
  readonly environmentOccurrences: number;
  readonly promptBodyOccurrences: number;
}

function breakDownChannels(
  assembled: AssembledRequest,
  marker: string,
): ChannelBreakdown {
  return {
    environmentIsPrefix: assembled.full.startsWith(
      assembled.environmentContext,
    ),
    environmentOccurrences: occurrencesOf(assembled.environmentContext, marker),
    promptBodyOccurrences: occurrencesOf(assembled.promptBody, marker),
  };
}

interface Row {
  readonly name: string;
  readonly jitContextEnabled: boolean;
  readonly settingsJitContextEnabled?: boolean;
}

const ROWS: Row[] = [
  {
    name: 'JIT context enabled',
    jitContextEnabled: true,
  },
  {
    name: 'JIT context disabled',
    jitContextEnabled: false,
  },
  {
    name: 'JIT context enabled with a conflicting settings-service value',
    jitContextEnabled: true,
    settingsJitContextEnabled: false,
  },
  {
    name: 'JIT context disabled with a conflicting settings-service value',
    jitContextEnabled: false,
    settingsJitContextEnabled: true,
  },
];

describe('assembled system instruction carries workspace memory exactly once (issue #3135)', () => {
  let originalPromptsDir: string | undefined;
  let promptsDir: string;

  beforeAll(async () => {
    originalPromptsDir = process.env.LLXPRT_PROMPTS_DIR;
    promptsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-jit-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = promptsDir;
    await initializePromptSystem();
  });

  afterAll(() => {
    if (originalPromptsDir === undefined) {
      delete process.env.LLXPRT_PROMPTS_DIR;
    } else {
      process.env.LLXPRT_PROMPTS_DIR = originalPromptsDir;
    }
    fs.rmSync(promptsDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    const configs = openConfigs.splice(0, openConfigs.length);
    await Promise.all(configs.map((config) => config.dispose()));
    const dirs = tempDirs.splice(0, tempDirs.length);
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(ROWS)('$name', async (row) => {
    const workspace = createWorkspace();
    const config = await buildWorkspaceConfig(workspace, row);

    const assembled = await assembleRequest(config);

    // Two sends means the hierarchy is paid for in every request; zero means
    // the workspace instructions never reach the model.
    expect(occurrencesOf(assembled.full, workspace.marker)).toBe(1);
  });

  it('carries the workspace hierarchy in the environment channel only, under JIT', async () => {
    const workspace = createWorkspace();
    const config = await buildWorkspaceConfig(workspace, {
      jitContextEnabled: true,
    });

    const assembled = await assembleRequest(config);

    expect(breakDownChannels(assembled, workspace.marker)).toStrictEqual({
      environmentIsPrefix: true,
      environmentOccurrences: 1,
      promptBodyOccurrences: 0,
    });
  });

  it('carries the workspace hierarchy in the user-memory channel only, without JIT', async () => {
    const workspace = createWorkspace();
    const config = await buildWorkspaceConfig(workspace, {
      jitContextEnabled: false,
    });

    const assembled = await assembleRequest(config);

    expect(breakDownChannels(assembled, workspace.marker)).toStrictEqual({
      environmentIsPrefix: true,
      environmentOccurrences: 0,
      promptBodyOccurrences: 1,
    });
  });
});
