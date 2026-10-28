/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterAll, beforeAll } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializePromptSystem } from '@vybestack/llxprt-code-core/core/prompts.js';

/**
 * Points `LLXPRT_PROMPTS_DIR` at a fresh directory for the suite and
 * initializes the prompt system there. Call inside `describe`.
 */
export function useRecordingPrompts(): void {
  let directory: string;
  let previous: string | undefined;
  beforeAll(async () => {
    previous = process.env.LLXPRT_PROMPTS_DIR;
    directory = await mkdtemp(join(tmpdir(), 'recording-caller-prompts-'));
    process.env.LLXPRT_PROMPTS_DIR = directory;
    await initializePromptSystem();
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  });
}
