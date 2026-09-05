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

import {
  describe,
  expect,
  it,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from 'bun:test';
import * as coreModule from '@vybestack/llxprt-code-core';
import {
  resolveContainerMemoryMB,
  findFirstPositionalArgIndex,
  injectStdinIntoArgs,
  maybeHopIntoSandbox,
  type SandboxHopOptions,
} from './cliSandbox.js';
import { start_sandbox } from './utils/sandbox.js';
import {
  auditLog,
  resetAuditLogStateForTesting,
} from '@vybestack/llxprt-code-providers/auth.js';
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

function restoreEnvironmentVariable(
  name: 'LLXPRT_SANDBOX_MEMORY' | 'SANDBOX_MEMORY' | 'SANDBOX_FLAGS',
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

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
      restoreEnvironmentVariable('LLXPRT_SANDBOX_MEMORY', oldMem);
      restoreEnvironmentVariable('SANDBOX_MEMORY', oldSb);
      restoreEnvironmentVariable('SANDBOX_FLAGS', oldFlags);
    }
  });

  it('returns undefined when memory env var is an empty string', () => {
    const oldMem = process.env.LLXPRT_SANDBOX_MEMORY;
    process.env.LLXPRT_SANDBOX_MEMORY = '';

    try {
      expect(resolveContainerMemoryMB()).toBeUndefined();
    } finally {
      restoreEnvironmentVariable('LLXPRT_SANDBOX_MEMORY', oldMem);
    }
  });

  it('parses LLXPRT_SANDBOX_MEMORY in human-readable units', () => {
    const oldMem = process.env.LLXPRT_SANDBOX_MEMORY;
    process.env.LLXPRT_SANDBOX_MEMORY = '2g';

    try {
      const result = resolveContainerMemoryMB();
      expect(result).toBe(2048);
    } finally {
      restoreEnvironmentVariable('LLXPRT_SANDBOX_MEMORY', oldMem);
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
      restoreEnvironmentVariable('LLXPRT_SANDBOX_MEMORY', oldMem);
      restoreEnvironmentVariable('SANDBOX_MEMORY', oldSb);
      restoreEnvironmentVariable('SANDBOX_FLAGS', oldFlags);
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
      restoreEnvironmentVariable('LLXPRT_SANDBOX_MEMORY', oldMem);
      restoreEnvironmentVariable('SANDBOX_MEMORY', oldSb);
      restoreEnvironmentVariable('SANDBOX_FLAGS', oldFlags);
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

function buildHopOptions(
  interactive = false,
  argv: SandboxHopOptions['argv'] = {} as SandboxHopOptions['argv'],
): SandboxHopOptions {
  return {
    config: {
      getSandbox: () => ({ command: 'docker', image: 'test-image' }),
      getDebugMode: () => false,
      isInteractive: () => interactive,
    } as SandboxHopOptions['config'],
    settings: {
      merged: { ui: { autoConfigureMaxOldSpaceSize: false } },
    } as SandboxHopOptions['settings'],
    argv,
    workspaceRoot: '/tmp/ws',
    runtimeSettingsService: {} as SandboxHopOptions['runtimeSettingsService'],
    initialAuthFailed: false,
    readStdin: async () => '',
    hasPipedInput: false,
    bootstrapSelection: null,
  };
}

/** A minimal direct-image invocation on a TTY: image flags, no prompt. */
function imageModeArgv(): SandboxHopOptions['argv'] {
  return {
    imagePrompt: 'a watercolor capybara',
    imageOutput: 'capybara.png',
  } as SandboxHopOptions['argv'];
}

/**
 * Ensures the SANDBOX env var is absent for each test in the describe and
 * restores the saved value afterwards, so hop tests exercise the hop path
 * regardless of the environment the runner provides. One registered
 * lifecycle instead of a save/delete/restore block inside every test.
 */
function useUnsetSandboxEnv(): void {
  const previous = process.env.SANDBOX;
  beforeEach(() => {
    delete process.env.SANDBOX;
  });
  afterEach(() => {
    if (previous === undefined) {
      delete process.env.SANDBOX;
    } else {
      process.env.SANDBOX = previous;
    }
  });
}

/**
 * Resets audit-log routing state — terminal ownership, the deferred buffer
 * and its overflow counter — before AND after every test. An afterEach-only
 * reset cannot clear records buffered while ownership is already released,
 * and cannot protect a block that enters dirty; the beforeEach half closes
 * both gaps.
 */
function useAuditLogStateReset(): void {
  beforeEach(() => {
    resetAuditLogStateForTesting();
  });
  afterEach(() => {
    resetAuditLogStateForTesting();
  });
}

/** Type guard for a valid Node buffer encoding name. */
function isBufferEncoding(value: unknown): value is BufferEncoding {
  return typeof value === 'string' && Buffer.isEncoding(value);
}

/**
 * Decodes one stderr write chunk into text. Byte chunks must be decoded,
 * not stringified: String(Uint8Array) yields "[object Uint8Array]", which
 * would let a broken implementation pass assertions like
 * expect(stderr).toBe('').
 */
function decodeStderrChunk(
  chunk: string | Uint8Array,
  encoding: unknown,
): string {
  if (typeof chunk === 'string') {
    return chunk;
  }
  return Buffer.from(chunk).toString(
    isBufferEncoding(encoding) ? encoding : 'utf8',
  );
}

/**
 * Installs a stderr collector that records every byte written while it is
 * active, keeping the bytes off the runner's own output. The stream is an
 * external sink being observed, not the unit under test.
 */
function collectStderr(): { captured: () => string; restore: () => void } {
  const chunks: string[] = [];
  const writeSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation((chunk: string | Uint8Array, ...rest: unknown[]) => {
      chunks.push(decodeStderrChunk(chunk, rest[0]));
      return true;
    });
  return {
    captured: () => chunks.join(''),
    restore: () => writeSpy.mockRestore(),
  };
}

/**
 * Drives a real INFO audit record and returns the stderr bytes it produced:
 * empty while a TUI owns the terminal, the JSON line otherwise. INFO is the
 * probe severity because it is never buffered, so the observed bytes are
 * exactly the bytes the routing decision produced at that moment.
 */
function auditInfoStderr(op: string): string {
  const collector = collectStderr();
  try {
    auditLog('INFO', 99, op);
  } finally {
    collector.restore();
  }
  return collector.captured();
}

/** Number of times needle appears in haystack, without regex escaping. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('maybeHopIntoSandbox hop-exit stdio flush (#3408)', () => {
  useUnsetSandboxEnv();

  afterEach(() => {
    vi.restoreAllMocks();
    coreEvents.removeAllListeners(CoreEvent.Output);
    coreEvents.removeAllListeners(CoreEvent.ConsoleLog);
    __resetCleanupStateForTesting();
  });

  it('flushes the patched-stdio backlog to the fd-direct writer before the hop exit sentinel fires', async () => {
    // Mirror cli.tsx setupProcessLifecycle: patch stdio and register the
    // sync-cleanup flush that runExitCleanup drains on the hop exit path.
    const cleanupStdio = coreModule.patchStdio();

    // A failing assertion must not leave the stdio patch installed for the
    // rest of the file, so every restore runs in the finally block.
    try {
      registerSyncCleanup(() => {
        initializeOutputListenersAndFlush();
        cleanupStdio();
      });

      // The marker written through the patched stream is buffered (no Output
      // listener yet); it must reach the fd-direct writer when runExitCleanup
      // drains the backlog. The order array pins flush-before-exit.
      const order: string[] = [];
      vi.spyOn(coreModule, 'writeToStderr').mockImplementation(
        (chunk: unknown) => {
          if (String(chunk).includes('HOP-EXIT-MARKER')) {
            order.push('flush');
          }
          return true;
        },
      );
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        order.push('exit');
        throw new Error('exit sentinel');
      }) as typeof process.exit);

      process.stderr.write('HOP-EXIT-MARKER\n');

      // The exit sentinel throws out of the hop, which is the only way to
      // observe the call without terminating the runner.
      await expect(maybeHopIntoSandbox(buildHopOptions())).rejects.toThrow(
        'exit sentinel',
      );

      expect(exitSpy.mock.calls[0]?.[0]).toBe(7);
      // The buffered marker reached the fd-direct writer, and it did so before
      // the hop-exit sentinel fired (runExitCleanup is awaited first).
      expect(order).toStrictEqual(['flush', 'exit']);
    } finally {
      // Restores the spies (including process.exit) before anything else.
      vi.restoreAllMocks();
      cleanupStdio();
    }
  });
});

describe('maybeHopIntoSandbox TUI terminal ownership (#3490)', () => {
  const startSandboxMock = start_sandbox as Mock<typeof start_sandbox>;
  useUnsetSandboxEnv();
  useAuditLogStateReset();

  /**
   * Stubs start_sandbox to drive a real INFO audit record mid-hop and
   * capture the stderr bytes it produced. Where those bytes went is the
   * observable routing the ownership flag exists for: empty while a TUI
   * owns the terminal, the JSON record otherwise.
   */
  function stubSandboxWithAuditProbe(): { stderrDuringHop: string } {
    const probe = { stderrDuringHop: '' };
    startSandboxMock.mockImplementation(async () => {
      probe.stderrDuringHop = auditInfoStderr('hop_probe');
      return 7;
    });
    return probe;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    // The file-level factory default; other describes in this file depend
    // on exit code 7.
    startSandboxMock.mockImplementation(async () => 7);
    __resetCleanupStateForTesting();
  });

  it('routes audit bytes away from stderr for an interactive hop and restores default routing afterwards', async () => {
    const probe = stubSandboxWithAuditProbe();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit sentinel');
    }) as typeof process.exit);

    await expect(maybeHopIntoSandbox(buildHopOptions(true))).rejects.toThrow(
      'exit sentinel',
    );

    expect(exitSpy.mock.calls[0]?.[0]).toBe(7);
    // The sandbox TUI owned the terminal for the whole hop, so the live
    // proxy's INFO record produced zero stderr bytes...
    expect(probe.stderrDuringHop).toBe('');
    // ...and once the hop settled, default stderr routing was back.
    expect(auditInfoStderr('post_hop_probe')).toContain(
      '"op":"post_hop_probe"',
    );
  });

  it('keeps audit records on stderr for a non-interactive hop', async () => {
    const probe = stubSandboxWithAuditProbe();
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit sentinel');
    }) as typeof process.exit);

    await expect(maybeHopIntoSandbox(buildHopOptions(false))).rejects.toThrow(
      'exit sentinel',
    );

    // Default mode: the audit record still reaches stderr byte for byte,
    // during the hop and after it.
    expect(probe.stderrDuringHop).toContain('"op":"hop_probe"');
    expect(auditInfoStderr('post_hop_probe')).toContain(
      '"op":"post_hop_probe"',
    );
  });

  it('does not claim the terminal for an interactive direct-image invocation that never mounts Ink', async () => {
    const probe = stubSandboxWithAuditProbe();
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit sentinel');
    }) as typeof process.exit);

    await expect(
      maybeHopIntoSandbox(buildHopOptions(true, imageModeArgv())),
    ).rejects.toThrow('exit sentinel');

    // Direct image mode dispatches after the hop without mounting a TUI, so
    // the audit record keeps its default stderr routing throughout.
    expect(probe.stderrDuringHop).toContain('"op":"hop_probe"');
  });

  it('restores default audit routing when start_sandbox rejects', async () => {
    const stderrInsideRejectedHop = { value: '' };
    startSandboxMock.mockImplementation(async () => {
      stderrInsideRejectedHop.value = auditInfoStderr('rejection_probe');
      throw new Error('sandbox boom');
    });

    await expect(maybeHopIntoSandbox(buildHopOptions(true))).rejects.toThrow(
      'sandbox boom',
    );

    // The claim was live right up to the failure (the INFO record produced
    // zero stderr bytes)...
    expect(stderrInsideRejectedHop.value).toBe('');
    // ...and the rejection path released it (default stderr routing back).
    expect(auditInfoStderr('post_rejection_probe')).toContain(
      '"op":"post_rejection_probe"',
    );
  });

  it('flushes WARN and ERROR records deferred during an interactive hop to stderr exactly once', async () => {
    startSandboxMock.mockImplementation(async () => {
      auditLog('WARN', 98, 'hop_warn');
      auditLog('ERROR', 98, 'hop_error');
      return 7;
    });
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit sentinel');
    }) as typeof process.exit);

    // The collector spans the whole hop: ownership defers both records, and
    // the release in the hop's finally is the only thing that may write.
    const collector = collectStderr();
    let stderrAfterHop = '';
    try {
      await expect(maybeHopIntoSandbox(buildHopOptions(true))).rejects.toThrow(
        'exit sentinel',
      );
    } finally {
      stderrAfterHop = collector.captured();
      collector.restore();
    }

    // The host has no feedback subscriber during the hop, so the operator's
    // copy is exactly the two deferred records, in order, once each.
    expect(occurrences(stderrAfterHop, '"component":"credential-proxy"')).toBe(
      2,
    );
    expect(occurrences(stderrAfterHop, '"op":"hop_warn"')).toBe(1);
    expect(occurrences(stderrAfterHop, '"op":"hop_error"')).toBe(1);
    expect(stderrAfterHop.indexOf('"op":"hop_warn"')).toBeLessThan(
      stderrAfterHop.indexOf('"op":"hop_error"'),
    );
  });
});
