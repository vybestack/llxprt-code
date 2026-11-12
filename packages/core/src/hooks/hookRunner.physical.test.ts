/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import { HookRunner } from './hookRunner.js';
import { fixtureHookRuntime } from './__tests__/hook-runtime-fixture.js';
import { HookEventName, HookType, type HookInput } from './types.js';
import type { Config } from '../config/config.js';

describe('HookRunner physical command execution', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('classifies bun stderr exit 2 as blocking with stderr reason', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'hook-physical-'));
    directories.push(directory);
    writeFileSync(
      join(directory, 'stderr_block_hook.ts'),
      "import process from 'node:process';\nprocess.stderr.write('File writing blocked by security policy');\nprocess.exit(2);\n",
    );
    const runtime = fixtureHookRuntime({
      getSanitizationConfig: () => undefined,
    } as Config);
    const runner = new HookRunner(
      runtime.process,
      runtime.isTrustedFolder,
      () => new AbortController().signal,
    );
    const input: HookInput = {
      session_id: 'physical-hook-test',
      transcript_path: join(directory, 'transcript.jsonl'),
      cwd: directory,
      hook_event_name: HookEventName.BeforeTool,
      timestamp: new Date(0).toISOString(),
    };

    const result = await runner.executeHook(
      {
        type: HookType.Command,
        command: 'bun stderr_block_hook.ts',
        timeout: 5000,
      },
      HookEventName.BeforeTool,
      input,
    );

    expect(result.exitCode).toBe(2);
    expect(result.success).toBe(false);
    expect(result.output).toMatchObject({
      decision: 'deny',
      reason: 'File writing blocked by security policy',
    });
  });
});
