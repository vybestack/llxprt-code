/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  initializeTestMcpRuntime,
  type TestMcpRuntime,
} from '@vybestack/llxprt-code-test-utils/core/config.js';
import { afterEach } from 'bun:test';

/**
 * Issue #3176, finding D7/C — real auxiliary-path test proving the
 * config-scoped core-memory snapshot cache in `clientLlmUtilities.ts`.
 *
 * When JIT context is disabled (`config.getCoreMemory()` returns
 * `undefined`), the auxiliary path must load `.LLXPRT_SYSTEM` from disk at
 * most ONCE per Config lifetime, caching the result (including the empty
 * string) so subsequent auxiliary calls reuse the snapshot without
 * re-reading the disk.
 *
 * This test does NOT mock `getCoreSystemPromptAsync` or
 * `loadCoreMemoryContent` — it writes real `.LLXPRT_SYSTEM` fixtures,
 * calls the real `generateJson` auxiliary path twice, and proves the
 * second call uses the first call's snapshot even after the disk fixture
 * is changed.
 *
 * Module mocks are process-wide, so this file must be run separately from
 * other tests that do not mock `clientToolGovernance.js`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import process from 'node:process';
import { generateJson } from './clientLlmUtilities.js';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { createConfigParams } from './chatSession-runtime-helpers.js';
import type { BaseLLMClient } from './baseLlmClient.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

// Mock only the tool-governance layer (not under test) to avoid needing a
// full ToolRegistry. The prompts module is NOT mocked.
void vi.mock('./clientToolGovernance.js', () => ({
  getEnabledToolNamesForPrompt: () => [],
  shouldIncludeSubagentDelegationForConfig: async () => false,
}));

const FIRST_SENTINEL = 'D7_CACHE_FIRST_SNAPSHOT';
const SECOND_SENTINEL = 'D7_CACHE_SECOND_SNAPSHOT';
const TEST_MODEL = 'test-model-d7';

function createTextContent(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function createCapturingBaseLlmClient(captured: string[]): BaseLLMClient {
  return {
    generateJson: async (opts: {
      systemInstruction?: string;
    }): Promise<Record<string, unknown>> => {
      captured.push(opts.systemInstruction ?? '');
      return { ok: true };
    },
  } as unknown as BaseLLMClient;
}

describe('Auxiliary core-memory snapshot cache (issue #3176, D7)', () => {
  let tempCwd: string;
  let tempPromptsDir: string;
  let originalCwd: string;
  let originalPromptsDir: string | undefined;
  let coreMemoryPath: string;

  const roots: TestMcpRuntime[] = [];
  let owners: readonly SessionSettingsOwner[] = [];
  afterEach(async () => {
    for (const owner of owners) await owner.dispose();
    owners = [];
    const results = await Promise.allSettled(
      roots.splice(0).map((root) => root.dispose()),
    );
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0)
      throw new AggregateError(failures, 'Instruction fixture cleanup failed');
  });
  beforeAll(async () => {
    originalCwd = process.cwd();
    originalPromptsDir = process.env.LLXPRT_PROMPTS_DIR;

    tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-d7-cache-'));
    const coreMemoryDir = path.join(tempCwd, '.llxprt');
    fs.mkdirSync(coreMemoryDir, { recursive: true });
    coreMemoryPath = path.join(coreMemoryDir, '.LLXPRT_SYSTEM');
    fs.writeFileSync(coreMemoryPath, FIRST_SENTINEL);

    tempPromptsDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'llxprt-d7-cache-prompts-'),
    );
    process.env.LLXPRT_PROMPTS_DIR = tempPromptsDir;

    process.chdir(tempCwd);
    await initializePromptSystem();
  });

  afterAll(() => {
    process.chdir(originalCwd);
    if (tempCwd && fs.existsSync(tempCwd)) {
      fs.rmSync(tempCwd, { recursive: true, force: true });
    }
    if (tempPromptsDir && fs.existsSync(tempPromptsDir)) {
      fs.rmSync(tempPromptsDir, { recursive: true, force: true });
    }
    if (originalPromptsDir === undefined) {
      delete process.env.LLXPRT_PROMPTS_DIR;
    } else {
      process.env.LLXPRT_PROMPTS_DIR = originalPromptsDir;
    }
  });

  it('retains the workspace snapshot until explicit refresh', async () => {
    const settings = new SettingsService();
    settings.set('model', TEST_MODEL);
    const owner = new SessionSettingsOwner(settings);
    owners = [...owners, owner];
    const promptPolicy = owner.readRuntimePolicy().promptPolicy;
    if (promptPolicy === undefined)
      throw new Error('Expected owner prompt policy');
    const config = new Config({
      ...createConfigParams(settings),
      targetDir: tempCwd,
    });

    // With JIT disabled, getCoreMemory() returns undefined, so the
    // auxiliary path must fall back to the disk snapshot cache.
    const root = await initializeTestMcpRuntime(config);
    roots.push(root);

    const captured: string[] = [];
    const baseLlmClient = createCapturingBaseLlmClient(captured);

    // First call — reads disk, caches snapshot containing FIRST_SENTINEL.
    await generateJson(
      config,
      () => undefined,
      {} as ContentGenerator,
      baseLlmClient,
      [createTextContent('next_speaker check')],
      { type: 'object' },
      new AbortController().signal,
      TEST_MODEL,
      {},
      'core-memory-cache-test',
      undefined,
      [],
      root.workspaceMemory.operations,
      promptPolicy,
    );
    expect(captured).toHaveLength(1);
    expect(captured[0]).toContain(FIRST_SENTINEL);

    // Change the disk fixture AFTER the first call.
    fs.writeFileSync(coreMemoryPath, SECOND_SENTINEL);

    // Second call — must use the CACHED snapshot (FIRST_SENTINEL), not the
    // new disk content (SECOND_SENTINEL).
    await generateJson(
      config,
      () => undefined,
      {} as ContentGenerator,
      baseLlmClient,
      [createTextContent('next_speaker check')],
      { type: 'object' },
      new AbortController().signal,
      TEST_MODEL,
      {},
      'core-memory-cache-test',
      undefined,
      [],
      root.workspaceMemory.operations,
      promptPolicy,
    );
    expect(captured).toHaveLength(2);
    expect(captured[1]).toContain(FIRST_SENTINEL);
    expect(captured[1]).not.toContain(SECOND_SENTINEL);
  });

  it('retains the empty workspace snapshot until explicit refresh', async () => {
    // Remove the disk fixture entirely.
    fs.unlinkSync(coreMemoryPath);

    const settings = new SettingsService();
    settings.set('model', TEST_MODEL);
    const owner = new SessionSettingsOwner(settings);
    owners = [...owners, owner];
    const promptPolicy = owner.readRuntimePolicy().promptPolicy;
    if (promptPolicy === undefined)
      throw new Error('Expected owner prompt policy');
    const config = new Config({
      ...createConfigParams(settings),
      targetDir: tempCwd,
    });
    const root = await initializeTestMcpRuntime(config);
    roots.push(root);

    const captured: string[] = [];
    const baseLlmClient = createCapturingBaseLlmClient(captured);

    // First call — disk is empty, snapshot is ''.
    await generateJson(
      config,
      () => undefined,
      {} as ContentGenerator,
      baseLlmClient,
      [createTextContent('next_speaker check')],
      { type: 'object' },
      new AbortController().signal,
      TEST_MODEL,
      {},
      'core-memory-cache-test',
      undefined,
      [],
      root.workspaceMemory.operations,
      promptPolicy,
    );
    expect(captured).toHaveLength(1);

    // Write a sentinel AFTER the first call.
    fs.writeFileSync(coreMemoryPath, SECOND_SENTINEL);

    // Second call — must still use the cached empty snapshot, NOT the
    // newly-written sentinel.
    await generateJson(
      config,
      () => undefined,
      {} as ContentGenerator,
      baseLlmClient,
      [createTextContent('next_speaker check')],
      { type: 'object' },
      new AbortController().signal,
      TEST_MODEL,
      {},
      'core-memory-cache-test',
      undefined,
      [],
      root.workspaceMemory.operations,
      promptPolicy,
    );
    expect(captured).toHaveLength(2);
    expect(captured[1]).not.toContain(SECOND_SENTINEL);
  });
});
