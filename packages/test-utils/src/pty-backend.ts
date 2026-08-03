/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Runtime-appropriate PTY spawning for the interactive test harness.
 *
 * Under Bun on POSIX, `@lydell/node-pty` silently hangs: `spawn()` returns a
 * valid pid but `onData`/`onExit` never fire (oven-sh/bun#25822 — Bun's
 * `tty.ReadStream` hits EAGAIN on the non-blocking PTY master fd). Every
 * interactive test would therefore time out once the test runner is Bun.
 * `Bun.spawn({ terminal })` has no such problem, so it is used instead.
 *
 * The production shell tool solves the same problem with its own adapter in
 * `@vybestack/llxprt-code-core`. That adapter cannot be reused here: `core`
 * already dev-depends on this package, so importing `core` from `test-utils`
 * would close a dependency cycle. This module deliberately implements only the
 * handful of PTY operations the interactive harness performs, rather than
 * `core`'s full `IPty` contract.
 */

const utf8Decoder = (): TextDecoder => new TextDecoder('utf-8');

/** Exit notification shape, matching node-pty's `onExit` payload. */
export interface TestPtyExit {
  readonly exitCode: number;
}

/** The subset of node-pty's `IPty` that the interactive harness uses. */
export interface TestPtyProcess {
  readonly pid: number;
  write(data: string): void;
  kill(signal?: string): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: TestPtyExit) => void): void;
}

export interface TestPtySpawnOptions {
  readonly name: string;
  readonly cols: number;
  readonly rows: number;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
}

/** Minimal ambient shape of the Bun globals used below. */
interface BunTerminalHandle {
  write(data: string): void;
  close(): void;
}

interface BunSubprocess {
  readonly pid: number;
  readonly exited: Promise<number | null>;
  readonly terminal: BunTerminalHandle;
  kill(signal?: string | number): void;
}

interface BunSpawnGlobal {
  spawn(
    command: readonly string[],
    options: {
      cwd: string;
      env: Record<string, string>;
      terminal: {
        cols: number;
        rows: number;
        name: string;
        data(terminal: BunTerminalHandle, chunk: Uint8Array): void;
      };
    },
  ): BunSubprocess;
}

/**
 * True when the current runtime is Bun on a POSIX platform, the exact
 * combination where `@lydell/node-pty` stops delivering PTY events.
 */
export function shouldUseBunTerminal(
  runtime: { readonly bun?: string } = process.versions,
  platform: string = process.platform,
): boolean {
  return typeof runtime.bun === 'string' && platform !== 'win32';
}

function stringOnlyEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function spawnBunTerminal(
  file: string,
  args: readonly string[],
  options: TestPtySpawnOptions,
): TestPtyProcess {
  const dataListeners: Array<(data: string) => void> = [];
  const exitListeners: Array<(event: TestPtyExit) => void> = [];
  const decoder = utf8Decoder();

  const subprocess = (Bun as unknown as BunSpawnGlobal).spawn(
    [file, ...args],
    {
      cwd: options.cwd,
      env: stringOnlyEnv(options.env),
      terminal: {
        cols: options.cols,
        rows: options.rows,
        name: options.name,
        data: (_terminal, chunk) => {
          const text = decoder.decode(chunk, { stream: true });
          if (text === '') {
            return;
          }
          for (const listener of dataListeners) {
            listener(text);
          }
        },
      },
    },
  );

  void subprocess.exited.then((code) => {
    // Match node-pty: dispatch once, to whoever is subscribed at that moment.
    // Callers already account for a late subscription never firing.
    const exitCode = code ?? 0;
    for (const listener of exitListeners.splice(0)) {
      listener({ exitCode });
    }
  });

  return {
    get pid() {
      return subprocess.pid;
    },
    write: (data) => subprocess.terminal.write(data),
    kill: (signal) => subprocess.kill(signal),
    onData: (listener) => {
      dataListeners.push(listener);
    },
    onExit: (listener) => {
      exitListeners.push(listener);
    },
  };
}

/**
 * Spawns `file` under a PTY using whichever backend works on this runtime.
 */
export async function spawnTestPty(
  file: string,
  args: readonly string[],
  options: TestPtySpawnOptions,
): Promise<TestPtyProcess> {
  if (shouldUseBunTerminal()) {
    return spawnBunTerminal(file, args, options);
  }
  const pty = await import('@lydell/node-pty');
  const child = pty.spawn(file, [...args], {
    name: options.name,
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: stringOnlyEnv(options.env),
  });
  return {
    get pid() {
      return child.pid;
    },
    write: (data) => child.write(data),
    kill: (signal) => child.kill(signal),
    onData: (listener) => {
      child.onData(listener);
    },
    onExit: (listener) => {
      child.onExit(({ exitCode }) => listener({ exitCode }));
    },
  };
}
