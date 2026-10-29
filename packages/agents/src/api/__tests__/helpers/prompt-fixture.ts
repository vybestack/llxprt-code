/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-storage';

const fixturePrompts = join(Storage.getGlobalConfigDir(), 'behavioral-prompts');

export function usePromptFixture(): void {
  let previous: string | undefined;
  beforeEach(async () => {
    previous = process.env.LLXPRT_PROMPTS_DIR;
    await mkdir(join(fixturePrompts, 'core'), { recursive: true });
    await writeFile(
      join(fixturePrompts, 'core', 'default.md'),
      'Test core prompt.',
    );
    process.env.LLXPRT_PROMPTS_DIR = fixturePrompts;
  });
  afterEach(async () => {
    if (previous === undefined) delete process.env.LLXPRT_PROMPTS_DIR;
    else process.env.LLXPRT_PROMPTS_DIR = previous;
    await rm(fixturePrompts, { recursive: true, force: true });
  });
}
