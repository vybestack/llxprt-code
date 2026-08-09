/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #3176, finding D7 — real proof that passing `coreMemory` explicitly
 * to `getCoreSystemPromptAsync` SKIPS the per-call `.LLXPRT_SYSTEM` disk read
 * in `resolveEffectiveMemories`.
 *
 * The companion tests in `clientLlmUtilities.test.ts` (T6/T7) prove the
 * wiring against a MOCK of `getCoreSystemPromptAsync`. This file proves the
 * real mechanism by driving the UNMOCKED `getCoreSystemPromptAsync` with a
 * real on-disk core-memory fixture:
 *
 *   - Case A: `coreMemory` is explicitly passed → the prompt contains the
 *     in-memory sentinel and NOT the on-disk sentinel (proving the disk
 *     fallback did not fire).
 *   - Case B: `coreMemory` is omitted → the on-disk sentinel DOES appear
 *     (proving the disk fixture is real and Case A's assertion is not
 *     vacuous).
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import process from 'node:process';
import { getCoreSystemPromptAsync, initializePromptSystem } from './prompts.js';

const ON_DISK_SENTINEL = 'REAL_ON_DISK_CORE_SENTINEL_3176';
const IN_MEMORY_SENTINEL = 'REAL_IN_MEMORY_CORE_SENTINEL_3176';

const TEST_PROVIDER = 'test-provider';
const TEST_MODEL = 'test-model';

describe('Core memory disk-skip (issue #3176, D7) — real getCoreSystemPromptAsync', () => {
  let tempCwd: string;
  let tempPromptsDir: string;
  let originalCwd: string;
  let originalPromptsDir: string | undefined;

  beforeAll(async () => {
    originalCwd = process.cwd();
    originalPromptsDir = process.env.LLXPRT_PROMPTS_DIR;

    // --- Real on-disk core-memory fixture ---
    // loadCoreMemoryContent reads <cwd>/.llxprt/.LLXPRT_SYSTEM.
    tempCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-d7-disk-cwd-'));
    const coreMemoryDir = path.join(tempCwd, '.llxprt');
    fs.mkdirSync(coreMemoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(coreMemoryDir, '.LLXPRT_SYSTEM'),
      ON_DISK_SENTINEL,
    );

    // --- Real prompt templates ---
    tempPromptsDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'llxprt-d7-prompts-'),
    );
    process.env.LLXPRT_PROMPTS_DIR = tempPromptsDir;

    // Change cwd so loadCoreMemoryContent(process.cwd()) reads our fixture.
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

  // Case A — the real proof
  it('skips the on-disk read when coreMemory is explicitly passed (D7)', async () => {
    const prompt = await getCoreSystemPromptAsync({
      provider: TEST_PROVIDER,
      model: TEST_MODEL,
      coreMemory: IN_MEMORY_SENTINEL,
    });

    // The in-memory value reached the prompt …
    expect(prompt).toContain(IN_MEMORY_SENTINEL);
    // … and the disk fallback did NOT fire (the on-disk sentinel is absent).
    expect(prompt).not.toContain(ON_DISK_SENTINEL);
  });

  // Case B — proves the disk fixture is real and Case A is not vacuous
  it('reads from disk when coreMemory is omitted (proving the fixture is real)', async () => {
    const prompt = await getCoreSystemPromptAsync({
      provider: TEST_PROVIDER,
      model: TEST_MODEL,
    });

    // The on-disk sentinel MUST appear, proving resolveEffectiveMemories
    // actually read the fixture file — making Case A's "not toContain"
    // assertion meaningful rather than vacuously true.
    expect(prompt).toContain(ON_DISK_SENTINEL);
  });
});
