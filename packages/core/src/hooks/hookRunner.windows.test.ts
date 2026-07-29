/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { HookRunner } from './hookRunner.js';
import { HookEventName, HookType, type HookInput } from './types.js';
import type { Config } from '../config/config.js';

const input: HookInput = {
  session_id: 'session-id',
  transcript_path: 'transcript.jsonl',
  cwd: process.cwd(),
  hook_event_name: HookEventName.BeforeTool,
  timestamp: new Date(0).toISOString(),
};

function createRunner(): HookRunner {
  return new HookRunner({
    getSanitizationConfig: () => undefined,
  } as Config);
}

async function execute(command: string) {
  return createRunner().executeHook(
    { type: HookType.Command, command },
    HookEventName.BeforeTool,
    input,
  );
}

describe.runIf(process.platform === 'win32')(
  'HookRunner PowerShell exit propagation',
  () => {
    it('preserves a final native exit code 2', async () => {
      const result = await execute("cmd /c 'exit 2'");
      expect(result.exitCode).toBe(2);
      expect(result.success).toBe(false);
    });

    it('maps a final PowerShell failure to exit code 1', async () => {
      const result = await execute("Write-Error 'hook failed'");
      expect(result.exitCode).toBe(1);
      expect(result.success).toBe(false);
    });

    it('ignores stale native failure after a successful final command', async () => {
      const result = await execute("cmd /c 'exit 2'; Write-Output 'recovered'");
      expect(result.exitCode).toBe(0);
      expect(result.success).toBe(true);
    });

    it('reports a successful native command', async () => {
      const result = await execute("cmd /c 'exit 0'");
      expect(result.exitCode).toBe(0);
      expect(result.success).toBe(true);
    });
  },
);
