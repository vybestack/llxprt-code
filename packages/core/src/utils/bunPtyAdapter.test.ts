/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { createBunPty } from './bunPtyAdapter.js';
import { isBunPosix } from './runtime.js';

/**
 * End-to-end behavioral tests for the Bun.Terminal PTY adapter.
 *
 * These exercise the real PTY seam (no mocks): a real shell process is spawned
 * via Bun.spawn({ terminal }), and we assert the observable contract consumers
 * depend on — pid, streamed data, real exit code, write, resize, kill.
 *
 * They only run under Bun+POSIX because the adapter wraps Bun.Terminal, which
 * is POSIX-only and unavailable under Node.
 */

interface MockBunTerminal {
  write: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface MockBunTerminalOptions {
  cols: number;
  rows: number;
  name: string;
  data(terminal: MockBunTerminal, chunk: Uint8Array): void;
}

interface MockBunSpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  terminal: MockBunTerminalOptions;
}

interface CapturedBunSpawn {
  getOptions(): MockBunSpawnOptions;
}

interface MockBunSubprocess {
  pid: number;
  exited: Promise<number | null>;
  terminal: MockBunTerminal;
  kill: ReturnType<typeof vi.fn>;
}

function createMockBunSubprocess(
  pid: number,
  exited: Promise<number | null> = new Promise<number | null>(() => {}),
): MockBunSubprocess {
  return {
    pid,
    exited,
    terminal: {
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
    },
    kill: vi.fn(),
  };
}

function stubBunSpawn(subprocess: MockBunSubprocess): ReturnType<typeof vi.fn> {
  const spawn = vi.fn().mockReturnValue(subprocess);
  vi.stubGlobal('Bun', { spawn });
  return spawn;
}

function stubBunSpawnWithOptions(
  subprocess: MockBunSubprocess,
): CapturedBunSpawn {
  let capturedOptions: MockBunSpawnOptions | undefined;
  const spawn = vi.fn(
    (_args: string[], options: MockBunSpawnOptions): MockBunSubprocess => {
      capturedOptions = options;
      return subprocess;
    },
  );
  vi.stubGlobal('Bun', { spawn });
  return {
    getOptions(): MockBunSpawnOptions {
      if (!capturedOptions) {
        throw new Error('Bun.spawn was not called');
      }
      return capturedOptions;
    },
  };
}

describe('Bun PTY adapter spawn options', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('passes cwd and sanitized environment to Bun.spawn', () => {
    const subprocess = createMockBunSubprocess(123);
    const spawn = stubBunSpawn(subprocess);

    createBunPty('/bin/bash', ['-lc', 'pwd && printf "$KEEP"'], {
      cwd: '/tmp/bun-pty-cwd',
      cols: 120,
      rows: 40,
      env: { KEEP: 'present', DROP: undefined },
      name: 'xterm-256color',
    });

    expect(spawn).toHaveBeenCalledWith(
      ['/bin/bash', '-lc', 'pwd && printf "$KEEP"'],
      {
        cwd: '/tmp/bun-pty-cwd',
        env: { KEEP: 'present' },
        terminal: expect.objectContaining({
          cols: 120,
          rows: 40,
          name: 'xterm-256color',
        }),
      },
    );
  });

  it('fans out terminal data and isolates listener failures', () => {
    const subprocess = createMockBunSubprocess(124);
    const { getOptions } = stubBunSpawnWithOptions(subprocess);
    const pty = createBunPty('/bin/bash', ['-lc', 'printf data'], {});
    const throwingListener = vi.fn(() => {
      throw new Error('listener failed');
    });
    const received: string[] = [];

    pty.onData(throwingListener);
    pty.onData((chunk) => {
      received.push(chunk);
    });

    getOptions().terminal.data(
      subprocess.terminal,
      new TextEncoder().encode('decoded-data'),
    );

    expect(throwingListener).toHaveBeenCalledWith('decoded-data');
    expect(received).toStrictEqual(['decoded-data']);
  });

  it('flushes decoder tails after listener failures before reporting exit', async () => {
    let resolveExit!: (exitCode: number) => void;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const subprocess = createMockBunSubprocess(125, exited);
    const { getOptions } = stubBunSpawnWithOptions(subprocess);
    const pty = createBunPty('/bin/bash', ['-lc', 'printf tail'], {});
    const received: string[] = [];

    pty.onData(() => {
      throw new Error('listener failed');
    });
    pty.onData((chunk) => {
      received.push(chunk);
    });
    getOptions().terminal.data(
      subprocess.terminal,
      // Incomplete 3-byte UTF-8 sequence; decoder flush emits U+FFFD.
      new Uint8Array([0xe2, 0x82]),
    );

    const exit = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );
    resolveExit(0);

    await expect(exit).resolves.toStrictEqual({ exitCode: 0 });
    expect(received.join('')).toBe('\ufffd');
  });

  it('uses the subprocess terminal immediately for early writes and resizes', () => {
    const subprocess = createMockBunSubprocess(126);
    stubBunSpawn(subprocess);

    const pty = createBunPty('/bin/bash', ['-lc', 'cat'], {});

    pty.write('early input\n');
    pty.resize(100, 30);

    expect(subprocess.terminal.write).toHaveBeenCalledWith('early input\n');
    expect(subprocess.terminal.resize).toHaveBeenCalledWith(100, 30);
    expect(pty.cols).toBe(100);
    expect(pty.rows).toBe(30);
  });

  it('ignores invalid resize dimensions without corrupting reported size', () => {
    const subprocess = createMockBunSubprocess(137);
    stubBunSpawn(subprocess);
    const pty = createBunPty('/bin/bash', ['-lc', 'cat'], {});

    pty.resize(100, 30);
    subprocess.terminal.resize.mockClear();
    pty.resize(Number.NaN, 25);
    pty.resize(120, 0);
    pty.resize(-1, 10);

    expect(subprocess.terminal.resize).not.toHaveBeenCalled();
    expect(pty.cols).toBe(100);
    expect(pty.rows).toBe(30);
  });

  it('ignores data that arrives after decoder finalization on exit', async () => {
    let resolveExit!: (exitCode: number) => void;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const subprocess = createMockBunSubprocess(139, exited);
    const { getOptions } = stubBunSpawnWithOptions(subprocess);
    const pty = createBunPty('/bin/bash', ['-lc', 'printf done'], {});
    const received: string[] = [];
    const exit = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );

    pty.onData((chunk) => {
      received.push(chunk);
    });
    resolveExit(0);

    await expect(exit).resolves.toStrictEqual({ exitCode: 0 });
    getOptions().terminal.data(
      subprocess.terminal,
      new TextEncoder().encode('late'),
    );

    expect(received).toStrictEqual([]);
  });

  it('ignores data listeners registered after decoder finalization', async () => {
    let resolveExit!: (exitCode: number) => void;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const subprocess = createMockBunSubprocess(140, exited);
    const { getOptions } = stubBunSpawnWithOptions(subprocess);
    const pty = createBunPty('/bin/bash', ['-lc', 'printf done'], {});
    const received: string[] = [];
    const exit = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );

    resolveExit(0);
    await expect(exit).resolves.toStrictEqual({ exitCode: 0 });
    const disposable = pty.onData((chunk) => {
      received.push(chunk);
    });

    getOptions().terminal.data(
      subprocess.terminal,
      new TextEncoder().encode('late'),
    );
    disposable.dispose();

    expect(received).toStrictEqual([]);
  });
  it('reports a signal when Bun encodes signal termination in the exit code', async () => {
    let resolveExit!: (exitCode: number) => void;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    stubBunSpawn(createMockBunSubprocess(127, exited));

    const pty = createBunPty('/bin/bash', ['-lc', 'sleep 30'], {});
    const exit = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );

    resolveExit(137);

    await expect(exit).resolves.toStrictEqual({ exitCode: 137, signal: 9 });
  });

  it('does not report a signal for boundary exit code 128', async () => {
    let resolveExit!: (exitCode: number) => void;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    stubBunSpawn(createMockBunSubprocess(135, exited));

    const pty = createBunPty('/bin/bash', ['-lc', 'exit 128'], {});
    const exit = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );

    resolveExit(128);

    await expect(exit).resolves.toStrictEqual({ exitCode: 128 });
  });

  it('does not report a signal for boundary exit code 160', async () => {
    let resolveExit!: (exitCode: number) => void;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    stubBunSpawn(createMockBunSubprocess(136, exited));

    const pty = createBunPty('/bin/bash', ['-lc', 'exit 160'], {});
    const exit = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );

    resolveExit(160);

    await expect(exit).resolves.toStrictEqual({ exitCode: 160 });
  });
  it('normalizes negative Bun signal exits to shell-style exit codes', async () => {
    let resolveExit!: (exitCode: number) => void;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    stubBunSpawn(createMockBunSubprocess(128, exited));

    const pty = createBunPty('/bin/bash', ['-lc', 'sleep 30'], {});
    const exit = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );

    resolveExit(-9);

    await expect(exit).resolves.toStrictEqual({ exitCode: 137, signal: 9 });
  });

  it('clamps oversized Bun exit codes to the POSIX byte range', async () => {
    const exited = Promise.resolve(-200);
    stubBunSpawn(createMockBunSubprocess(129, exited));

    const pty = createBunPty('/bin/bash', ['-lc', 'sleep 30'], {});
    const exit = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );

    await expect(exit).resolves.toStrictEqual({ exitCode: 255 });
  });

  it('still dispatches an exit event when Bun reports an exit failure', async () => {
    const exited = new Promise<number>((_resolve, reject) => {
      queueMicrotask(() => reject({ exitCode: 5 }));
    });
    stubBunSpawn(createMockBunSubprocess(129, exited));

    const pty = createBunPty('/bin/bash', ['-lc', 'exit 5'], {});
    const exit = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );

    await expect(exit).resolves.toStrictEqual({ exitCode: 5 });
  });

  it('normalizes non-Error exit promise rejections without exitCode to a generic failure', async () => {
    const exited = new Promise<number>((_resolve, reject) => {
      queueMicrotask(() => reject('closed'));
    });
    stubBunSpawn(createMockBunSubprocess(137, exited));

    const pty = createBunPty('/bin/bash', ['-lc', 'exit'], {});
    const exit = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );

    await expect(exit).resolves.toStrictEqual({ exitCode: 1 });
  });

  it('normalizes a null Bun exit status to a generic failure', async () => {
    let resolveExit!: (exitCode: number | null) => void;
    const exited = new Promise<number | null>((resolve) => {
      resolveExit = resolve;
    });
    stubBunSpawn(createMockBunSubprocess(130, exited));

    const pty = createBunPty('/bin/bash', ['-lc', 'exit'], {});
    const exit = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );

    resolveExit(null);

    await expect(exit).resolves.toStrictEqual({ exitCode: 1 });
  });

  it('replays exit events to listeners registered after process exit', async () => {
    let resolveExit!: (exitCode: number) => void;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    stubBunSpawn(createMockBunSubprocess(131, exited));

    const pty = createBunPty('/bin/bash', ['-lc', 'true'], {});
    resolveExit(0);

    await new Promise<void>((resolve, reject) => {
      pty.onExit((event) => {
        try {
          expect(event).toStrictEqual({ exitCode: 0 });
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });

    const replayedExit = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );

    await expect(replayedExit).resolves.toStrictEqual({ exitCode: 0 });
  });

  it('reports a fallback exit when kill leaves exited pending', async () => {
    vi.useFakeTimers();
    const subprocess = createMockBunSubprocess(132);
    stubBunSpawn(subprocess);
    const pty = createBunPty('/bin/bash', ['-lc', 'sleep 30'], {});
    const exit = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );

    try {
      pty.kill('SIGTERM');
      await vi.advanceTimersByTimeAsync(200);

      await expect(exit).resolves.toStrictEqual({ exitCode: 143, signal: 15 });
      expect(subprocess.kill).toHaveBeenCalledWith('SIGTERM');
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults kill to SIGTERM and tolerates writes after close', async () => {
    vi.useFakeTimers();
    const subprocess = createMockBunSubprocess(133);
    subprocess.terminal.write.mockImplementation(() => {
      throw new Error('closed');
    });
    subprocess.terminal.resize.mockImplementation(() => {
      throw new Error('closed');
    });
    stubBunSpawn(subprocess);
    const pty = createBunPty('/bin/bash', ['-lc', 'sleep 30'], {});
    const exit = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );

    try {
      pty.kill();
      expect(() => pty.write('ignored')).not.toThrow();
      expect(() => pty.resize(90, 25)).not.toThrow();
      await vi.advanceTimersByTimeAsync(200);

      expect(subprocess.kill).toHaveBeenCalledWith('SIGTERM');
      await expect(exit).resolves.toStrictEqual({ exitCode: 143, signal: 15 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('escalates destroy to SIGKILL after a prior SIGTERM kill fallback was armed', async () => {
    vi.useFakeTimers();
    const subprocess = createMockBunSubprocess(138);
    stubBunSpawn(subprocess);
    const pty = createBunPty('/bin/bash', ['-lc', 'sleep 30'], {});
    const exit = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );

    try {
      pty.kill('SIGTERM');
      pty.destroy();
      await vi.advanceTimersByTimeAsync(200);

      expect(subprocess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(subprocess.kill).toHaveBeenCalledWith('SIGKILL');
      await expect(exit).resolves.toStrictEqual({ exitCode: 137, signal: 9 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes decoder tail before fallback exit after kill leaves exited pending', async () => {
    vi.useFakeTimers();
    const subprocess = createMockBunSubprocess(141);
    const { getOptions } = stubBunSpawnWithOptions(subprocess);
    const pty = createBunPty('/bin/bash', ['-lc', 'sleep 30'], {});
    const received: string[] = [];
    const exit = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );
    pty.onData((chunk) => {
      received.push(chunk);
    });
    getOptions().terminal.data(
      subprocess.terminal,
      new Uint8Array([0xe2, 0x82]),
    );

    try {
      pty.kill('SIGTERM');
      await vi.advanceTimersByTimeAsync(200);

      await expect(exit).resolves.toStrictEqual({ exitCode: 143, signal: 15 });
      expect(received.join('')).toBe('\ufffd');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a SIGKILL fallback exit when destroy leaves exited pending', async () => {
    vi.useFakeTimers();
    const subprocess = createMockBunSubprocess(134);
    stubBunSpawn(subprocess);
    const pty = createBunPty('/bin/bash', ['-lc', 'sleep 30'], {});
    const exit = new Promise<{ exitCode: number; signal?: number }>(
      (resolve) => {
        pty.onExit(resolve);
      },
    );

    try {
      pty.destroy();
      await vi.advanceTimersByTimeAsync(200);

      expect(subprocess.kill).toHaveBeenCalledWith('SIGKILL');
      expect(subprocess.terminal.close).toHaveBeenCalledTimes(1);
      await expect(exit).resolves.toStrictEqual({ exitCode: 137, signal: 9 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe.skipIf(!isBunPosix())('Bun PTY adapter (Bun.Terminal)', () => {
  const spawned: Array<{ kill: () => void }> = [];

  afterEach(() => {
    for (const pty of spawned) {
      try {
        pty.kill();
      } catch {
        // Best-effort cleanup for failed real PTY tests.
      }
    }
    spawned.length = 0;
  });

  it('emits a valid pid and streams command output via onData', async () => {
    const pty = createBunPty('/bin/bash', ['-lc', 'echo bun-adapter-ok'], {
      cols: 80,
      rows: 24,
      name: 'xterm-256color',
    });
    spawned.push(pty);

    expect(typeof pty.pid).toBe('number');
    expect(pty.pid).toBeGreaterThan(0);

    const output = await new Promise<string>((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error('onData timeout')), 5000);
      pty.onData((chunk) => {
        buf += chunk;
      });
      pty.onExit(() => {
        clearTimeout(timer);
        resolve(buf);
      });
    });

    expect(output).toContain('bun-adapter-ok');
  });

  it('reports the real process exit code via onExit, not terminal status', async () => {
    const pty = createBunPty('/bin/bash', ['-lc', 'exit 42'], {
      cols: 80,
      rows: 24,
    });
    spawned.push(pty);

    const exit = await new Promise<{ exitCode: number; signal?: number }>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('onExit timeout')),
          5000,
        );
        pty.onExit((e) => {
          clearTimeout(timer);
          resolve(e);
        });
      },
    );

    expect(exit.exitCode).toBe(42);
  });

  it('allows writing input to the shell stdin', async () => {
    const pty = createBunPty(
      '/bin/bash',
      ['-lc', 'IFS= read -r line; printf "back:%s\\n" "$line"'],
      {
        cols: 80,
        rows: 24,
      },
    );
    spawned.push(pty);

    const output = await new Promise<string>((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(
        () => reject(new Error('write test timeout')),
        5000,
      );
      pty.onData((chunk) => {
        buf += chunk;
        if (buf.includes('back:echo-written-back')) {
          clearTimeout(timer);
          resolve(buf);
        }
      });
      pty.onExit(() => {
        clearTimeout(timer);
        resolve(buf);
      });
      pty.write('echo-written-back\n');
    });

    expect(output).toContain('back:echo-written-back');
  });

  it('resizes the terminal without error', () => {
    const pty = createBunPty('/bin/bash', ['-lc', 'sleep 0.2'], {
      cols: 80,
      rows: 24,
    });
    spawned.push(pty);

    expect(() => pty.resize(120, 40)).not.toThrow();
    pty.kill();
  });

  it('supports kill to terminate the process', async () => {
    const pty = createBunPty('/bin/bash', ['-lc', 'sleep 30'], {
      cols: 80,
      rows: 24,
    });
    spawned.push(pty);

    const exit = await new Promise<{ exitCode: number; signal?: number }>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('kill did not trigger onExit')),
          5000,
        );
        pty.onExit((e) => {
          clearTimeout(timer);
          resolve(e);
        });
        pty.kill('SIGKILL');
      },
    );

    expect(exit.exitCode).toBe(137);
    expect(exit.signal).toBe(9);
  });

  it('returns disposable subscriptions from onData and onExit', () => {
    const pty = createBunPty('/bin/bash', ['-lc', 'sleep 0.1'], {
      cols: 80,
      rows: 24,
    });
    spawned.push(pty);

    const dataSub = pty.onData(() => {});
    const exitSub = pty.onExit(() => {});
    try {
      expect(typeof dataSub.dispose).toBe('function');
      expect(typeof exitSub.dispose).toBe('function');
      expect(() => dataSub.dispose()).not.toThrow();
      expect(() => exitSub.dispose()).not.toThrow();
    } finally {
      pty.kill();
    }
  });
});
