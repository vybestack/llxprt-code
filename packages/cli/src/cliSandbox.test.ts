/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for the pure helper functions extracted into cliSandbox.ts
 * (#2378 review remediation). These test the OBSERVABLE input→output
 * transformation of each pure helper without touching process spawning or
 * the full sandbox hop.
 */

import { describe, expect, it, afterEach, vi } from 'bun:test';
import * as coreModule from '@vybestack/llxprt-code-core';
import {
  resolveContainerMemoryMB,
  findFirstPositionalArgIndex,
  injectStdinIntoArgs,
  maybeHopIntoSandbox,
  type SandboxHopOptions,
} from './cliSandbox.js';
import { coreEvents, CoreEvent } from '@vybestack/llxprt-code-core';
import { initializeOutputListenersAndFlush } from './session/outputListeners.js';
import {
  registerSyncCleanup,
  __resetCleanupStateForTesting,
} from './utils/cleanup.js';

void vi.mock('./utils/sandbox.js', () => ({
  start_sandbox: vi.fn(async () => 7),
}));
void vi.mock('./config/config.js', () => ({
  loadCliConfig: vi.fn(async () => ({})),
}));

describe('resolveContainerMemoryMB', () => {
  it('returns undefined when no memory env vars are set', () => {
    const oldMem = process.env.LLXPRT_SANDBOX_MEMORY;
    const oldSb = process.env.SANDBOX_MEMORY;
    const oldFlags = process.env.SANDBOX_FLAGS;
    delete process.env.LLXPRT_SANDBOX_MEMORY;
    delete process.env.SANDBOX_MEMORY;
    delete process.env.SANDBOX_FLAGS;

    try {
      expect(resolveContainerMemoryMB()).toBeUndefined();
    } finally {
      if (oldMem !== undefined) process.env.LLXPRT_SANDBOX_MEMORY = oldMem;
      if (oldSb !== undefined) process.env.SANDBOX_MEMORY = oldSb;
      if (oldFlags !== undefined) process.env.SANDBOX_FLAGS = oldFlags;
    }
  });

  it('returns undefined when memory env var is an empty string', () => {
    const oldMem = process.env.LLXPRT_SANDBOX_MEMORY;
    process.env.LLXPRT_SANDBOX_MEMORY = '';

    try {
      expect(resolveContainerMemoryMB()).toBeUndefined();
    } finally {
      if (oldMem !== undefined) process.env.LLXPRT_SANDBOX_MEMORY = oldMem;
      else delete process.env.LLXPRT_SANDBOX_MEMORY;
    }
  });

  it('parses LLXPRT_SANDBOX_MEMORY in human-readable units', () => {
    const oldMem = process.env.LLXPRT_SANDBOX_MEMORY;
    process.env.LLXPRT_SANDBOX_MEMORY = '2g';

    try {
      const result = resolveContainerMemoryMB();
      expect(result).toBe(2048);
    } finally {
      if (oldMem !== undefined) process.env.LLXPRT_SANDBOX_MEMORY = oldMem;
      else delete process.env.LLXPRT_SANDBOX_MEMORY;
    }
  });

  it('parses --memory=value from SANDBOX_FLAGS when memory env vars are absent', () => {
    const oldMem = process.env.LLXPRT_SANDBOX_MEMORY;
    const oldSb = process.env.SANDBOX_MEMORY;
    const oldFlags = process.env.SANDBOX_FLAGS;
    delete process.env.LLXPRT_SANDBOX_MEMORY;
    delete process.env.SANDBOX_MEMORY;
    process.env.SANDBOX_FLAGS = '--cpu-shares=512 --memory=512m';

    try {
      const result = resolveContainerMemoryMB();
      expect(result).toBe(512);
    } finally {
      if (oldMem !== undefined) process.env.LLXPRT_SANDBOX_MEMORY = oldMem;
      if (oldSb !== undefined) process.env.SANDBOX_MEMORY = oldSb;
      if (oldFlags !== undefined) process.env.SANDBOX_FLAGS = oldFlags;
      else delete process.env.SANDBOX_FLAGS;
    }
  });

  it('parses --memory value (space-separated) from SANDBOX_FLAGS', () => {
    const oldMem = process.env.LLXPRT_SANDBOX_MEMORY;
    const oldSb = process.env.SANDBOX_MEMORY;
    const oldFlags = process.env.SANDBOX_FLAGS;
    delete process.env.LLXPRT_SANDBOX_MEMORY;
    delete process.env.SANDBOX_MEMORY;
    process.env.SANDBOX_FLAGS = '--memory 1024m';

    try {
      const result = resolveContainerMemoryMB();
      expect(result).toBe(1024);
    } finally {
      if (oldMem !== undefined) process.env.LLXPRT_SANDBOX_MEMORY = oldMem;
      if (oldSb !== undefined) process.env.SANDBOX_MEMORY = oldSb;
      if (oldFlags !== undefined) process.env.SANDBOX_FLAGS = oldFlags;
      else delete process.env.SANDBOX_FLAGS;
    }
  });
});

describe('findFirstPositionalArgIndex', () => {
  it('returns -1 when there are no positional arguments', () => {
    expect(
      findFirstPositionalArgIndex(['node', 'cli.tsx', '--prompt', 'hello']),
    ).toBe(-1);
  });

  it('returns the index of the first positional argument after node and script', () => {
    expect(
      findFirstPositionalArgIndex(['node', 'cli.tsx', 'write', 'a', 'haiku']),
    ).toBe(2);
  });

  it('skips flags that consume the next value', () => {
    expect(
      findFirstPositionalArgIndex([
        'node',
        'cli.tsx',
        '--prompt',
        'hello',
        'positional',
      ]),
    ).toBe(4);
  });

  it('treats equals-form flags as not consuming the next token', () => {
    expect(
      findFirstPositionalArgIndex([
        'node',
        'cli.tsx',
        '--prompt=hello',
        'positional',
      ]),
    ).toBe(3);
  });

  it('returns -1 when only flags are present starting from index 2', () => {
    expect(
      findFirstPositionalArgIndex(['node', 'cli.tsx', '--flag', '--other']),
    ).toBe(-1);
  });
});

describe('injectStdinIntoArgs', () => {
  it('returns args unchanged when stdinData is empty', () => {
    const args = ['node', 'cli.tsx', '--prompt', 'hello'];
    expect(injectStdinIntoArgs(args, undefined)).toStrictEqual(args);
  });

  it('returns args unchanged when stdinData is empty string', () => {
    const args = ['node', 'cli.tsx', '--prompt', 'hello'];
    expect(injectStdinIntoArgs(args, '')).toStrictEqual(args);
  });

  it('prepends stdin to the --prompt flag value', () => {
    const args = ['node', 'cli.tsx', '--prompt', 'original'];
    const result = injectStdinIntoArgs(args, 'piped data');

    expect(result[2]).toBe('--prompt');
    expect(result[3]).toContain('piped data');
    expect(result[3]).toContain('original');
  });

  it('prepends stdin to the first positional argument when no --prompt flag', () => {
    const args = ['node', 'cli.tsx', 'write', 'a', 'haiku'];
    const result = injectStdinIntoArgs(args, 'piped data');

    expect(result[2]).toContain('piped data');
    expect(result[2]).toContain('write');
    expect(result[3]).toBe('a');
    expect(result[4]).toBe('haiku');
  });

  it('appends stdin as a new positional argument when none exists', () => {
    const args = ['node', 'cli.tsx', '--flag'];
    const result = injectStdinIntoArgs(args, 'piped data');

    expect(result[result.length - 1]).toBe('piped data');
  });

  it('does not mutate the original args array', () => {
    const args = ['node', 'cli.tsx', '--prompt', 'original'];
    const original = [...args];
    injectStdinIntoArgs(args, 'piped data');

    expect(args).toStrictEqual(original);
  });
});

describe('maybeHopIntoSandbox hop-exit stdio flush (#3408)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    coreEvents.removeAllListeners(CoreEvent.Output);
    coreEvents.removeAllListeners(CoreEvent.ConsoleLog);
    __resetCleanupStateForTesting();
  });

  function buildHopOptions(): SandboxHopOptions {
    return {
      config: {
        getSandbox: () => ({ command: 'docker', image: 'test-image' }),
        getDebugMode: () => false,
      } as SandboxHopOptions['config'],
      settings: {
        merged: { ui: { autoConfigureMaxOldSpaceSize: false } },
      } as SandboxHopOptions['settings'],
      argv: {} as SandboxHopOptions['argv'],
      workspaceRoot: '/tmp/ws',
      runtimeSettingsService: {} as SandboxHopOptions['runtimeSettingsService'],
      initialAuthFailed: false,
      readStdin: async () => '',
      hasPipedInput: false,
      bootstrapSelection: null,
    };
  }

  it('flushes the patched-stdio backlog to the fd-direct writer before the hop exit sentinel fires', async () => {
    const originalSandbox = process.env.SANDBOX;
    delete process.env.SANDBOX;

    // Mirror cli.tsx setupProcessLifecycle: patch stdio and register the
    // sync-cleanup flush that runExitCleanup drains on the hop exit path.
    const cleanupStdio = coreModule.patchStdio();
    registerSyncCleanup(() => {
      initializeOutputListenersAndFlush();
      cleanupStdio();
    });

    // The marker written through the patched stream is buffered (no Output
    // listener yet); it must reach the fd-direct writer when runExitCleanup
    // drains the backlog. The order array pins flush-before-exit.
    const order: string[] = [];
    const writeSpy = vi
      .spyOn(coreModule, 'writeToStderr')
      .mockImplementation((chunk: unknown) => {
        const text = String(chunk);
        if (text.includes('HOP-EXIT-MARKER')) {
          order.push('flush');
        }
        return true;
      });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      order.push('exit');
      throw new Error('exit sentinel');
    }) as typeof process.exit);

    process.stderr.write('HOP-EXIT-MARKER\n');

    // The exit sentinel throws out of the hop, which is the only way to observe
    // the call without terminating the runner.
    await expect(maybeHopIntoSandbox(buildHopOptions())).rejects.toThrow(
      'exit sentinel',
    );

    let exitCode: number | undefined;
    try {
      exitCode = exitSpy.mock.calls[0]?.[0] as number | undefined;
    } finally {
      exitSpy.mockRestore();
      writeSpy.mockRestore();
    }

    expect(exitCode).toBe(7);
    // The buffered marker reached the fd-direct writer, and it did so before
    // the hop-exit sentinel fired (runExitCleanup is awaited first).
    expect(order).toStrictEqual(['flush', 'exit']);

    if (originalSandbox === undefined) {
      delete process.env.SANDBOX;
    } else {
      process.env.SANDBOX = originalSandbox;
    }

    coreEvents.removeAllListeners(CoreEvent.Output);
    coreEvents.removeAllListeners(CoreEvent.ConsoleLog);
    __resetCleanupStateForTesting();
    cleanupStdio();
  });
});
