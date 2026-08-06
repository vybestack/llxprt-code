/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'bun:test';
import { spawn } from 'node:child_process';
import { HookRunner } from './hookRunner.js';
import {
  HookEventName,
  HookType,
  type HookConfig,
  type HookInput,
} from './types.js';
import type { Config } from '../config/config.js';

vi.mock('node:child_process', async () => {
  const actual =
    await vi.importActual<typeof import('node:child_process')>(
      'node:child_process',
    );
  return { ...actual, spawn: vi.fn() };
});

const mockInput: HookInput = {
  session_id: 'session-id',
  transcript_path: 'transcript.jsonl',
  cwd: process.cwd(),
  hook_event_name: HookEventName.BeforeTool,
  timestamp: new Date(0).toISOString(),
};

const commandConfig: HookConfig = {
  type: HookType.Command,
  command: './hooks/test.sh',
  timeout: 5000,
};

interface MockChildProcess {
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  stdout: { on: ReturnType<typeof vi.fn> };
  stderr: { on: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
}

function createMockSpawn(): MockChildProcess {
  return {
    stdin: { write: vi.fn(), end: vi.fn() },
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    killed: false,
  };
}

describe('HookRunner Windows console isolation (Issue #2548)', () => {
  let mockSpawnObj: MockChildProcess;

  beforeEach(() => {
    mockSpawnObj = createMockSpawn();
    // The spawn mock is created once by the module factory, so its recorded
    // calls survive across tests. Clear them so each test only observes the
    // spawn invocation it triggered itself.
    vi.mocked(spawn).mockClear();
    vi.mocked(spawn).mockReturnValue(
      mockSpawnObj as unknown as ReturnType<typeof spawn>,
    );

    mockSpawnObj.on.mockImplementation(
      (event: string, callback: (code: number) => void) => {
        if (event === 'close') {
          setTimeout(() => callback(0), 10);
        }
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should spawn with windowsHide=true on Windows to isolate console', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });

    const runner = new HookRunner({
      getSanitizationConfig: () => undefined,
    } as Config);

    try {
      await runner.executeHook(
        commandConfig,
        HookEventName.BeforeTool,
        mockInput,
      );

      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          windowsHide: true,
          shell: false,
        }),
      );
    } finally {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it('should not set windowsHide on non-Windows platforms and keep shell disabled', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true,
    });

    const runner = new HookRunner({
      getSanitizationConfig: () => undefined,
    } as Config);

    try {
      await runner.executeHook(
        commandConfig,
        HookEventName.BeforeTool,
        mockInput,
      );

      const spawnOptions = vi.mocked(spawn).mock.calls[0][2];
      expect(spawnOptions).toBeDefined();
      expect(spawnOptions.shell).toBe(false);
      expect(spawnOptions.windowsHide).toBeUndefined();
    } finally {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        configurable: true,
      });
    }
  });
});
