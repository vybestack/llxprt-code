/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavior tests for the Docker/Podman capability delivery (issue #3573).
 *
 * The host writes the token to a file in a host-only directory and
 * bind-mounts that directory into the container. The generated entrypoint
 * opens the file, unlinks it, and hands the token to the CLI on fd 3. These
 * tests run the REAL generated entrypoint script under real bash with the
 * mount path pointed at a temporary directory. Stand-ins replace only what
 * needs privileges or an image: `su`, `groupadd`, `chown`, `id`, the CLI, and
 * a prefix/bridge process that probes what it inherits.
 *
 * The token is a random value per run. Assertions compare booleans and
 * digests, so a failing assertion never prints the token.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { entrypoint } from './sandbox-entrypoint.js';
import { setupContainerUser } from './sandbox-containers.js';

const posixHost = process.platform !== 'win32';
// The behavior suite inspects /proc (environ, cmdline, fd links) to prove no
// process holds the token, and its stand-ins list /proc/$$/fd. macOS has no
// procfs, so that suite runs on Linux only.
const linuxHost = process.platform === 'linux';
const runningAsRoot = process.getuid?.() === 0;

const SCRIPT_WORKDIR = path.join(os.tmpdir(), 'cap-delivery-script-work');
const POLL_MS = 25;
const PHASE_TIMEOUT_MS = 20_000;

interface Workspace {
  readonly root: string;
  readonly mountDir: string;
  readonly tokenFile: string;
  readonly binDir: string;
  readonly reportDir: string;
  readonly tmpDir: string;
  readonly homeDir: string;
  readonly workdir: string;
}

interface RunResult {
  readonly exit: number;
  readonly stderr: string;
  readonly scans: Readonly<Record<string, readonly string[]>>;
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True once `file` exists; false when `hasExited` reports the child is gone. */
async function waitForFile(
  file: string,
  label: string,
  hasExited: () => boolean,
): Promise<boolean> {
  const deadline = Date.now() + PHASE_TIMEOUT_MS;
  while (!fs.existsSync(file)) {
    if (hasExited()) return false;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await sleep(POLL_MS);
  }
  return true;
}

function readableFileIncludes(file: string, token: Buffer): boolean {
  try {
    return fs.readFileSync(file).includes(token);
  } catch {
    // Not readable (other user, exited, mode 000 fixture): nothing to inspect.
    return false;
  }
}

function descriptorTargetsInclude(pid: string, token: Buffer): boolean {
  try {
    return fs
      .readdirSync(`/proc/${pid}/fd`)
      .some((fd) =>
        Buffer.from(fs.readlinkSync(`/proc/${pid}/fd/${fd}`)).includes(token),
      );
  } catch {
    return false;
  }
}

/**
 * Looks for the exact token bytes in the environment, command line and open
 * file descriptor targets of every process this user can read. Returns where
 * it found them ("pid:environ"), never the token.
 */
function scanProcesses(token: Buffer): string[] {
  const hits: string[] = [];
  for (const pid of fs.readdirSync('/proc').filter((e) => /^\d+$/.test(e))) {
    for (const file of ['environ', 'cmdline']) {
      if (readableFileIncludes(`/proc/${pid}/${file}`, token)) {
        hits.push(`${pid}:${file}`);
      }
    }
    if (descriptorTargetsInclude(pid, token)) hits.push(`${pid}:fd`);
  }
  return hits;
}

/** Exact token bytes in any regular file below `root`. */
function scanTree(root: string, token: Buffer): string[] {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && readableFileIncludes(full, token)) {
        hits.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  return hits;
}

function writeExecutable(file: string, lines: string[]): void {
  fs.writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o755 });
}

/**
 * The stand-in CLI: reports what it inherited, then waits for the test to
 * scan the process table. It records only a digest of fd 3.
 */
function installStandInCli(ws: Workspace): void {
  writeExecutable(path.join(ws.binDir, 'llxprt'), [
    '#!/usr/bin/env bash',
    `dir=${JSON.stringify(ws.reportDir)}`,
    'echo "ran" > "$dir/cli.ran"',
    'echo "${LLXPRT_CAPABILITY_FD-unset}" > "$dir/cli.marker"',
    'if [ -n "${LLXPRT_CAPABILITY_TOKEN+x}" ]; then echo present > "$dir/cli.envtoken"; fi',
    'ls -1 /proc/$$/fd > "$dir/cli.fds"',
    'if { true <&3; } 2>/dev/null; then sha256sum <&3 | cut -d" " -f1 > "$dir/cli.sha"; fi',
    'touch "$dir/cli.ready"',
    'for _ in $(seq 1 800); do [ -e "$dir/release-cli" ] && exit 0; sleep 0.025; done',
    'exit 3',
  ]);
}

/**
 * The stand-in prefix/bridge process. It lists its inherited descriptors,
 * tries a non-blocking read on each, and looks for the capability file.
 */
function installStandInPrefix(ws: Workspace): string {
  const script = path.join(ws.binDir, 'prefix-probe.sh');
  writeExecutable(script, [
    '#!/usr/bin/env bash',
    `dir=${JSON.stringify(ws.reportDir)}`,
    `mount=${JSON.stringify(ws.mountDir)}`,
    'ls -1 /proc/$$/fd > "$dir/prefix.fds"',
    'for n in $(seq 3 40); do',
    '  if { read -r -t 0.05 line <&$n; } 2>/dev/null; then echo "fd$n:${line}" >> "$dir/prefix.reads"; fi',
    'done',
    'ls -A "$mount" > "$dir/prefix.mountlist" 2>/dev/null',
    'if [ -e "$mount/token" ]; then echo present > "$dir/prefix.tokenfile"; fi',
    'touch "$dir/prefix.ready"',
    'for _ in $(seq 1 800); do [ -e "$dir/release-prefix" ] && exit 0; sleep 0.025; done',
    'exit 3',
  ]);
  return `bash ${JSON.stringify(script)}`;
}

/**
 * Stand-ins for the root-only tools the current-user branch calls. `su`
 * optionally restores the token file mode first, which models the uid drop
 * that lets the host uid read a file root could not (rootful Docker).
 */
function installPrivilegedToolStandIns(ws: Workspace): void {
  for (const tool of ['useradd', 'chown']) {
    writeExecutable(path.join(ws.binDir, tool), ['#!/bin/sh', 'exit 0']);
  }
  // groupadd runs in the root setup stanza after the capture. It records
  // whether the shell variable that holds the token reached its environment.
  writeExecutable(path.join(ws.binDir, 'groupadd'), [
    '#!/bin/sh',
    `if printenv __llxprt_cap >/dev/null 2>&1; then echo present > ${JSON.stringify(path.join(ws.reportDir, 'setup.capenv'))}; fi`,
    'exit 0',
  ]);
  writeExecutable(path.join(ws.binDir, 'id'), ['#!/bin/sh', 'exit 0']);
  writeExecutable(path.join(ws.binDir, 'su'), [
    '#!/usr/bin/env bash',
    '[ "$1" = "-p" ] && shift',
    'shift',
    '[ "$1" = "-c" ] || exit 64',
    `echo "ran" > ${JSON.stringify(path.join(ws.reportDir, 'su.ran'))}`,
    'if [ -n "${SU_STANDIN_RESTORE_MODE_OF-}" ]; then chmod 600 "$SU_STANDIN_RESTORE_MODE_OF"; fi',
    'exec bash --noprofile --norc -c "$2"',
  ]);
}

function makeWorkspace(): Workspace {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-delivery-'));
  const ws: Workspace = {
    root,
    mountDir: path.join(root, 'mount'),
    tokenFile: path.join(root, 'mount', 'token'),
    binDir: path.join(root, 'bin'),
    reportDir: path.join(root, 'report'),
    tmpDir: path.join(root, 'tmp'),
    homeDir: path.join(root, 'home'),
    workdir: path.join(root, 'work'),
  };
  for (const dir of [
    ws.mountDir,
    ws.binDir,
    ws.reportDir,
    ws.tmpDir,
    ws.homeDir,
    ws.workdir,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.chmodSync(ws.mountDir, 0o700);
  installStandInCli(ws);
  installPrivilegedToolStandIns(ws);
  return ws;
}

function readReport(ws: Workspace, name: string): string | undefined {
  const file = path.join(ws.reportDir, name);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
}

function descriptorNumbers(listing: string | undefined): number[] {
  return (
    (listing ?? '')
      .split('\n')
      .filter((line) => /^\d+$/.test(line))
      .map(Number)
      // bash keeps its script file open as fd 255 when it runs a script.
      .filter((fd) => fd !== 255)
  );
}

interface RunOptions {
  readonly mode: 'image-user' | 'current-user';
  readonly usePrefix: boolean;
  readonly extraEnv?: NodeJS.ProcessEnv;
  readonly suRestoreModeOf?: string;
}

async function buildScriptArgv(
  ws: Workspace,
  options: RunOptions,
): Promise<string[]> {
  const prefixes = options.usePrefix ? [installStandInPrefix(ws)] : undefined;
  const argv = entrypoint(
    ws.workdir,
    ['llxprt', 'run'],
    undefined,
    prefixes,
    undefined,
    { capabilityMountDir: ws.mountDir },
  );
  if (options.mode === 'current-user') {
    const previous = process.env.SANDBOX_SET_UID_GID;
    process.env.SANDBOX_SET_UID_GID = 'true';
    try {
      await setupContainerUser([], argv, { capabilityMountDir: ws.mountDir });
    } finally {
      if (previous === undefined) delete process.env.SANDBOX_SET_UID_GID;
      else process.env.SANDBOX_SET_UID_GID = previous;
    }
  }
  return argv;
}

/**
 * Runs the generated entrypoint and, while the prefix and the CLI stand-in
 * wait on a release file, scans the process table for the token.
 */
async function runEntrypoint(
  ws: Workspace,
  token: Buffer,
  options: RunOptions,
): Promise<RunResult> {
  const argv = await buildScriptArgv(ws, options);
  const env: NodeJS.ProcessEnv = {
    PATH: `${ws.binDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    HOME: ws.homeDir,
    TMPDIR: ws.tmpDir,
    ...options.extraEnv,
  };
  if (options.suRestoreModeOf !== undefined) {
    env.SU_STANDIN_RESTORE_MODE_OF = options.suRestoreModeOf;
  }
  const child = spawn(argv[0], argv.slice(1), {
    cwd: ws.workdir,
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  let hasExited = false;
  const exited = new Promise<number>((resolve) => {
    child.once('close', (code) => {
      hasExited = true;
      resolve(code ?? -1);
    });
  });
  const scans: Record<string, readonly string[]> = {};
  try {
    const phases = options.usePrefix ? ['prefix', 'cli'] : ['cli'];
    for (const phase of phases) {
      const ready = path.join(ws.reportDir, `${phase}.ready`);
      if (!(await waitForFile(ready, `${phase} stand-in`, () => hasExited))) {
        break;
      }
      scans[phase] = scanProcesses(token);
      fs.writeFileSync(path.join(ws.reportDir, `release-${phase}`), '');
    }
  } finally {
    for (const phase of ['prefix', 'cli']) {
      fs.writeFileSync(path.join(ws.reportDir, `release-${phase}`), '');
    }
  }
  const exit = await exited;
  return { exit, stderr, scans };
}

describe('capability delivery through the mount (#3573)', () => {
  // Reads only the generated script text, so it needs no procfs and still
  // runs on macOS.
  describe.skipIf(!posixHost)('generated scripts', () => {
    it('the generated scripts reopen fd 3 from a pipe and never read the token from a here-string or the environment', async () => {
      const entrypointScript = String(
        entrypoint(SCRIPT_WORKDIR, ['llxprt', 'chat']).at(-1),
      );
      const finalEntrypoint = entrypoint(SCRIPT_WORKDIR, ['llxprt', 'chat']);
      const containerArgs: string[] = [];
      const previous = process.env.SANDBOX_SET_UID_GID;
      process.env.SANDBOX_SET_UID_GID = 'true';
      try {
        await setupContainerUser(containerArgs, finalEntrypoint);
      } finally {
        if (previous === undefined) delete process.env.SANDBOX_SET_UID_GID;
        else process.env.SANDBOX_SET_UID_GID = previous;
      }
      const wrapperScript = String(finalEntrypoint.at(-1));

      for (const script of [entrypointScript, wrapperScript]) {
        expect(script).not.toContain('<<<');
        expect(script).not.toContain('${LLXPRT_CAPABILITY_TOKEN');
        expect(script).toContain('exec 3< <(');
        expect(script).toContain('/run/llxprt-capability');
      }
      expect(containerArgs.join(' ')).not.toContain('LLXPRT_CAPABILITY_TOKEN');
    });
  });

  describe.skipIf(!linuxHost)('Linux procfs behavior', () => {
    let ws: Workspace;
    let token: Buffer;
    let tokenText: string;

    beforeEach(() => {
      ws = makeWorkspace();
      tokenText = randomBytes(32).toString('hex');
      token = Buffer.from(tokenText);
      fs.writeFileSync(ws.tokenFile, `${tokenText}\n`, { mode: 0o600 });
    });

    afterEach(() => {
      if (fs.existsSync(ws.mountDir)) fs.chmodSync(ws.mountDir, 0o700);
      fs.rmSync(ws.root, { recursive: true, force: true });
    });

    function expectDeliveredOnlyOnFd3(result: RunResult): void {
      expect(result.exit).toBe(0);
      expect(readReport(ws, 'cli.marker')?.trim()).toBe('3');
      expect(readReport(ws, 'cli.sha')?.trim()).toBe(sha256(`${tokenText}\n`));
      expect(readReport(ws, 'cli.envtoken')).toBeUndefined();
      // Only stdio plus the capability descriptor reach the CLI.
      expect(
        descriptorNumbers(readReport(ws, 'cli.fds')).filter((fd) => fd > 2),
      ).toStrictEqual([3]);
    }

    function expectNoTokenAnywhere(result: RunResult): void {
      for (const [phase, hits] of Object.entries(result.scans)) {
        expect({ phase, hits }).toStrictEqual({ phase, hits: [] });
      }
      expect(scanTree(ws.root, token)).toStrictEqual([]);
      expect(fs.existsSync(ws.tokenFile)).toBe(false);
      expect(fs.readdirSync(ws.mountDir)).toStrictEqual([]);
    }

    function expectPrefixSawNothing(): void {
      expect(readReport(ws, 'prefix.fds')).toBeDefined();
      expect(
        descriptorNumbers(readReport(ws, 'prefix.fds')).filter((fd) => fd > 2),
      ).toStrictEqual([]);
      expect(readReport(ws, 'prefix.reads')).toBeUndefined();
      expect(readReport(ws, 'prefix.tokenfile')).toBeUndefined();
      expect(readReport(ws, 'prefix.mountlist')?.trim()).toBe('');
    }

    it('control: the scanners find a token left in a process environment and in a file', async () => {
      // Without this, "the scan found nothing" could mean the scan cannot see.
      const planted = spawn('sleep', ['30'], {
        env: { LEAKED: tokenText },
        stdio: 'ignore',
      });
      try {
        fs.writeFileSync(path.join(ws.reportDir, 'copy'), `${tokenText}\n`);
        const pid = String(planted.pid);
        // The child is in the process table once spawn returned a pid, but its
        // environment is only the planted one after exec completes.
        const deadline = Date.now() + PHASE_TIMEOUT_MS;
        let hits = scanProcesses(token);
        while (!hits.includes(`${pid}:environ`) && Date.now() < deadline) {
          await sleep(POLL_MS);
          hits = scanProcesses(token);
        }
        expect(hits).toContain(`${pid}:environ`);
        expect(scanTree(ws.root, token)).toContain(path.join('report', 'copy'));
      } finally {
        planted.kill();
      }
    });

    it('image-user mode: the CLI gets the exact token on fd 3 and nothing else sees it', async () => {
      const result = await runEntrypoint(ws, token, {
        mode: 'image-user',
        usePrefix: true,
      });

      expectDeliveredOnlyOnFd3(result);
      expectPrefixSawNothing();
      expect(Object.keys(result.scans)).toStrictEqual(['prefix', 'cli']);
      expectNoTokenAnywhere(result);
    });

    it('current-user mode, root can read the file: the outer stanza opens and unlinks it before su', async () => {
      const result = await runEntrypoint(ws, token, {
        mode: 'current-user',
        usePrefix: true,
      });

      expect(readReport(ws, 'su.ran')).toBeDefined();
      expectDeliveredOnlyOnFd3(result);
      expectPrefixSawNothing();
      expectNoTokenAnywhere(result);
    });

    it.skipIf(runningAsRoot)(
      'current-user mode, root cannot read the file: the dropped user opens and unlinks it',
      async () => {
        // Mode 000 stands in for rootful Docker, where root without
        // CAP_DAC_OVERRIDE cannot open a file owned by the host uid. The su
        // stand-in restores access the way the uid drop does.
        fs.chmodSync(ws.tokenFile, 0o000);

        const result = await runEntrypoint(ws, token, {
          mode: 'current-user',
          usePrefix: true,
          suRestoreModeOf: ws.tokenFile,
        });

        expect(readReport(ws, 'su.ran')).toBeDefined();
        expectDeliveredOnlyOnFd3(result);
        expectPrefixSawNothing();
        expectNoTokenAnywhere(result);
      },
    );

    it.skipIf(runningAsRoot)(
      'image-user mode fails closed, without starting the CLI, when the file cannot be read',
      async () => {
        fs.chmodSync(ws.tokenFile, 0o000);

        const result = await runEntrypoint(ws, token, {
          mode: 'image-user',
          usePrefix: false,
        });

        expect(result.exit).not.toBe(0);
        expect(result.stderr).toMatch(/capability/i);
        expect(readReport(ws, 'cli.ran')).toBeUndefined();
        expect(result.stderr).not.toContain(tokenText);
      },
    );

    it.skipIf(runningAsRoot)(
      'fails closed, without starting the CLI, when the file cannot be unlinked after it is opened',
      async () => {
        // A read-only directory models a mount whose owner cannot remove the
        // entry. Reading the token while a copy stays mounted would leave it
        // reachable by every later process.
        fs.chmodSync(ws.mountDir, 0o500);

        const result = await runEntrypoint(ws, token, {
          mode: 'image-user',
          usePrefix: false,
        });

        expect(result.exit).not.toBe(0);
        expect(result.stderr).toMatch(/capability/i);
        expect(readReport(ws, 'cli.ran')).toBeUndefined();
      },
    );

    it('starts the CLI without a capability descriptor when no capability mount exists', async () => {
      fs.rmSync(ws.mountDir, { recursive: true, force: true });

      const result = await runEntrypoint(ws, token, {
        mode: 'image-user',
        usePrefix: false,
      });

      expect(result.exit).toBe(0);
      expect(readReport(ws, 'cli.marker')?.trim()).toBe('unset');
      expect(readReport(ws, 'cli.sha')).toBeUndefined();
      expect(
        descriptorNumbers(readReport(ws, 'cli.fds')).filter((fd) => fd > 2),
      ).toStrictEqual([]);
    });

    it('ignores a token supplied in the environment and scrubs it from the CLI', async () => {
      fs.rmSync(ws.mountDir, { recursive: true, force: true });
      const envOnlyToken = randomBytes(32).toString('hex');

      const result = await runEntrypoint(ws, Buffer.from(envOnlyToken), {
        mode: 'image-user',
        usePrefix: false,
        extraEnv: { LLXPRT_CAPABILITY_TOKEN: envOnlyToken },
      });

      expect(result.exit).toBe(0);
      expect(readReport(ws, 'cli.marker')?.trim()).toBe('unset');
      expect(readReport(ws, 'cli.sha')).toBeUndefined();
      expect(readReport(ws, 'cli.envtoken')).toBeUndefined();
    });

    it('does not let a pre-set shell variable stand in for the token file', async () => {
      const result = await runEntrypoint(ws, token, {
        mode: 'image-user',
        usePrefix: false,
        extraEnv: { __llxprt_cap: 'f'.repeat(64) },
      });

      expectDeliveredOnlyOnFd3(result);
      expect(fs.existsSync(ws.tokenFile)).toBe(false);
    });

    describe('an inherited exported __llxprt_cap', () => {
      // Bash keeps the export attribute of a variable that arrives in the
      // environment, so assigning the token to it would hand the token to
      // every process started before the final exec.
      const inherited = { __llxprt_cap: 'f'.repeat(64) };

      it('image-user mode: the token reaches no prefix environment', async () => {
        const result = await runEntrypoint(ws, token, {
          mode: 'image-user',
          usePrefix: true,
          extraEnv: inherited,
        });

        expectDeliveredOnlyOnFd3(result);
        expectPrefixSawNothing();
        expectNoTokenAnywhere(result);
      });

      it('current-user mode: the token reaches neither the setup tools nor the prefix', async () => {
        const result = await runEntrypoint(ws, token, {
          mode: 'current-user',
          usePrefix: true,
          extraEnv: inherited,
        });

        expect(readReport(ws, 'su.ran')).toBeDefined();
        expect(readReport(ws, 'setup.capenv')).toBeUndefined();
        expectDeliveredOnlyOnFd3(result);
        expectPrefixSawNothing();
        expectNoTokenAnywhere(result);
      });

      it('allexport inherited through SHELLOPTS does not export the token either', async () => {
        const result = await runEntrypoint(ws, token, {
          mode: 'current-user',
          usePrefix: true,
          extraEnv: { SHELLOPTS: 'allexport' },
        });

        expect(readReport(ws, 'setup.capenv')).toBeUndefined();
        expectDeliveredOnlyOnFd3(result);
        expectPrefixSawNothing();
        expectNoTokenAnywhere(result);
      });
    });
  });
});
