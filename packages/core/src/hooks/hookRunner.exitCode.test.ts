/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { HookRunner } from './hookRunner.js';
import {
  DefaultHookOutput,
  HookEventName,
  HookType,
  type HookInput,
  type HookOutput,
} from './types.js';
import type { Config } from '../config/config.js';

const input: HookInput = {
  session_id: 'session-id',
  transcript_path: 'transcript.jsonl',
  cwd: process.cwd(),
  hook_event_name: HookEventName.BeforeTool,
  timestamp: new Date(0).toISOString(),
};

async function execute(command: string) {
  const runner = new HookRunner({
    getSanitizationConfig: () => undefined,
  } as Config);
  return runner.executeHook(
    { type: HookType.Command, command },
    HookEventName.BeforeTool,
    input,
  );
}

function isBlockingDecision(output: HookOutput | undefined): boolean {
  return new DefaultHookOutput(output ?? {}).isBlockingDecision();
}

describe('HookRunner exit code semantics', () => {
  it('denies with a default reason when a hook exits 2 without writing to stderr', async () => {
    const result = await execute('node -e "process.exit(2)"');

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.output).toStrictEqual({
      decision: 'deny',
      reason: 'Hook exited with code 2 without an error message',
    });
  });

  it('denies with the stderr text when a hook exits 2 after writing to stderr', async () => {
    const result = await execute(
      'node -e "process.stderr.write(\'denied by policy\'); process.exit(2)"',
    );

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.output).toStrictEqual({
      decision: 'deny',
      reason: 'denied by policy',
    });
  });

  it('produces no decision when a hook exits 1 without writing to stderr', async () => {
    const result = await execute('node -e "process.exit(1)"');

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toBeUndefined();
  });

  it('warns without blocking when a hook exits 1 after writing to stderr', async () => {
    const result = await execute(
      'node -e "process.stderr.write(\'hook broke\'); process.exit(1)"',
    );

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.output).toStrictEqual({
      decision: 'allow',
      systemMessage: 'Warning: hook broke',
    });
    expect(isBlockingDecision(result.output)).toBe(false);
  });

  it('produces no output when a hook exits 0 without writing anything', async () => {
    const result = await execute('node -e "process.exit(0)"');

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toBeUndefined();
  });

  it('keeps plain stdout as a system message when a hook exits 0', async () => {
    const result = await execute(
      'node -e "process.stdout.write(\'all good\')"',
    );

    expect(result.success).toBe(true);
    expect(result.output).toStrictEqual({
      decision: 'allow',
      systemMessage: 'all good',
    });
  });
});
