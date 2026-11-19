/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Process-level lifecycle of the real ACP server (`llxprt --experimental-acp`)
 * started as a child process. The model is the replay-only `fake` provider
 * (`LLXPRT_FAKE_RESPONSES`), so no network or credentials are involved. The
 * scripted model asks for a shell tool call that runs far longer than any
 * bound asserted here; the exit bound therefore cannot be met by waiting for
 * the tool call to finish.
 *
 * The server is started with a preload that keeps its event loop busy, like a
 * provider connection or MCP transport that is still open when the ACP
 * connection ends. Ending the process must not depend on every such handle
 * being released.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import * as acp from '@agentclientprotocol/sdk';
import { afterEach, describe, expect, it } from 'bun:test';

const HOLD_EVENT_LOOP_OPEN = join(
  dirname(fileURLToPath(import.meta.url)),
  '__tests__',
  'hold-event-loop-open.preload.ts',
);
const CLI_ENTRY = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'cli',
  'index.ts',
);

/** Length of the scripted tool call; far above every other bound here. */
const TOOL_CALL_SECONDS = 117;
/** Time the server gets to stop after the client side is gone. */
const EXIT_BOUND_MS = 20_000;
const STARTUP_BOUND_MS = 90_000;
const TOOL_TERMINATION_BOUND_MS = 5_000;
const TEST_TIMEOUT_MS = STARTUP_BOUND_MS + EXIT_BOUND_MS + 60_000;

interface ExitRecord {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface RunningServer {
  readonly child: ChildProcess;
  readonly exited: Promise<ExitRecord>;
  readonly toolPid: number;
  readonly stderr: () => string;
  /** Closes both pipes the way a killed client does. */
  readonly disconnectClient: () => void;
}

/** Quotes a value as one POSIX shell word, including embedded single quotes. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Signals one process, or with `group` the process group it leads. Refuses
 * any pid that is not a positive integer above 1, so a bad value can never
 * become `kill(0)` (this runner's group) or `kill(-1)` (every process the
 * user owns).
 */
function killQuietly(
  pid: number,
  signal: NodeJS.Signals,
  { group = false }: { group?: boolean } = {},
): void {
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  try {
    process.kill(group ? -pid : pid, signal);
  } catch {
    // Already gone.
  }
}

async function readToolPid(pidFile: string): Promise<number | undefined> {
  try {
    const pid = Number.parseInt((await readFile(pidFile, 'utf8')).trim(), 10);
    return Number.isSafeInteger(pid) && pid > 1 ? pid : undefined;
  } catch {
    return undefined;
  }
}

async function waitFor<T>(
  describeWait: string,
  timeoutMs: number,
  probe: () => Promise<T | undefined>,
  failure: () => string = () => '',
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${describeWait}. ${failure()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Resolves with the server's exit, or fails if it is still running at the bound. */
async function exitWithinBound(
  server: RunningServer,
  trigger: string,
): Promise<ExitRecord> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<'still-running'>((resolve) => {
    timer = setTimeout(() => resolve('still-running'), EXIT_BOUND_MS);
  });
  const outcome = await Promise.race([server.exited, bound]).finally(() =>
    clearTimeout(timer),
  );
  if (outcome === 'still-running') {
    throw new Error(
      `Server still running ${EXIT_BOUND_MS} ms after ${trigger}. Stderr: ${server.stderr()}`,
    );
  }
  return outcome;
}

async function toolCallTerminated(server: RunningServer): Promise<boolean> {
  try {
    await waitFor(
      'the tool call process to be terminated',
      TOOL_TERMINATION_BOUND_MS,
      async () => (isAlive(server.toolPid) ? undefined : true),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts the real CLI as an ACP server, creates a session and sends a prompt
 * whose scripted reply is one long shell tool call. Resolves once the tool
 * call's process has started (it records its own pid). The returned cleanup
 * reaps anything a failing run leaves behind.
 */
async function startServerWithRunningToolCall(
  cleanups: Array<() => Promise<void>>,
): Promise<RunningServer> {
  // The space and the quote keep the tool call's shell quoting under test.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "zed lifecycle '-")),
  );
  const workspace = join(root, 'workspace');
  const pidFile = join(root, 'tool.pid');
  const responses = join(root, 'responses.jsonl');
  await mkdir(workspace);
  const command = `echo $$ > ${shellQuote(pidFile)} && exec sleep ${TOOL_CALL_SECONDS}`;
  await writeFile(
    responses,
    [
      {
        chunks: [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'call_long_running',
                name: 'run_shell_command',
                parameters: { command, description: 'Long running command' },
              },
            ],
          },
        ],
      },
      {
        chunks: [
          { speaker: 'ai', blocks: [{ type: 'text', text: 'Command done.' }] },
        ],
      },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n') + '\n',
  );

  const child = spawn(
    process.execPath,
    [
      '--preload',
      HOLD_EVENT_LOOP_OPEN,
      CLI_ENTRY,
      '--experimental-acp',
      '--yolo',
      '--ide-mode',
      'disable',
      '--provider',
      'fake',
      '--model',
      'fake-model',
    ],
    {
      cwd: workspace,
      // Own process group so cleanup can reap anything a failing run leaves.
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        HOME: join(root, 'home'),
        NO_BROWSER: 'true',
        LLXPRT_NO_BROWSER_AUTH: 'true',
        CI: 'true',
        LLXPRT_CONFIG_HOME: join(root, 'config'),
        LLXPRT_DATA_HOME: join(root, 'data'),
        LLXPRT_CACHE_HOME: join(root, 'cache'),
        LLXPRT_LOG_HOME: join(root, 'log'),
        LLXPRT_FAKE_RESPONSES: responses,
      },
    },
  );
  cleanups.push(async () => {
    if (child.pid !== undefined) {
      killQuietly(child.pid, 'SIGKILL', { group: true });
    }
    const leftover = await readToolPid(pidFile);
    if (leftover !== undefined && isAlive(leftover)) {
      killQuietly(leftover, 'SIGKILL');
    }
    await rm(root, { recursive: true, force: true });
  });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = new Promise<ExitRecord>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  const client = new acp.ClientSideConnection(
    () => ({
      requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
      sessionUpdate: async () => {},
    }),
    acp.ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ),
  );
  await Promise.race([
    client.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    }),
    exited.then(() => {
      throw new Error(`ACP server exited during startup. ${stderr}`);
    }),
  ]);
  const session = await client.newSession({ cwd: workspace, mcpServers: [] });
  // The turn never completes: the connection is closed under it.
  client
    .prompt({
      sessionId: session.sessionId,
      prompt: [{ type: 'text', text: 'Run the long command.' }],
    })
    .catch(() => {});

  const toolPid = await waitFor(
    'the scripted tool call to start',
    STARTUP_BOUND_MS,
    () => readToolPid(pidFile),
    () => `Server stderr: ${stderr}`,
  );

  return {
    child,
    exited,
    toolPid,
    stderr: () => stderr,
    disconnectClient: () => {
      child.stdin.destroy();
      child.stdout.destroy();
    },
  };
}

describe('ACP server process lifecycle', () => {
  // The cases rely on `$$`, `exec sleep` and POSIX signals.
  describe.skipIf(process.platform === 'win32')('on a POSIX host', () => {
    const cleanups: Array<() => Promise<void>> = [];

    afterEach(async () => {
      for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    });

    it(
      'exits within a bound after SIGTERM when the client disconnected during a tool call',
      async () => {
        const server = await startServerWithRunningToolCall(cleanups);
        expect(isAlive(server.toolPid)).toBe(true);
        server.disconnectClient();
        server.child.kill('SIGTERM');

        const exit = await exitWithinBound(server, 'SIGTERM');

        expect(exit.code).toBe(0);
        expect(await toolCallTerminated(server)).toBe(true);
      },
      TEST_TIMEOUT_MS,
    );

    it(
      'exits on its own after stdin reaches EOF during a tool call',
      async () => {
        const server = await startServerWithRunningToolCall(cleanups);
        expect(isAlive(server.toolPid)).toBe(true);
        server.disconnectClient();

        const exit = await exitWithinBound(server, 'stdin EOF');

        expect(exit.code).toBe(0);
        expect(await toolCallTerminated(server)).toBe(true);
      },
      TEST_TIMEOUT_MS,
    );

    it.each([
      ['SIGTERM', 0],
      ['SIGINT', 130],
    ] as const)(
      'after %s while the client is still connected, exits with code %i once cleanup is done',
      async (signal, expectedCode) => {
        const server = await startServerWithRunningToolCall(cleanups);
        expect(isAlive(server.toolPid)).toBe(true);
        server.child.kill(signal);

        const exit = await exitWithinBound(server, signal);

        expect(exit.code).toBe(expectedCode);
        expect(await toolCallTerminated(server)).toBe(true);
      },
      TEST_TIMEOUT_MS,
    );
  });
});
