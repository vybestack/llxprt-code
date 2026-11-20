/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn, spawnSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import { acquireHostCredentialProxy } from './sandbox-credential-proxy.js';
import { runBwrapSandbox } from './sandbox-bwrap.js';

const bwrapProbe = spawnSync(
  'bwrap',
  [
    '--unshare-user',
    '--unshare-pid',
    '--disable-userns',
    '--ro-bind',
    '/',
    '/',
    '--',
    '/bin/true',
  ],
  { stdio: 'ignore', timeout: 1500 },
);
const skipBwrap =
  process.platform !== 'linux' ||
  (bwrapProbe.status !== 0 &&
    process.env.LLXPRT_REQUIRE_BWRAP_TESTS !== 'true');

function runOptionsFd(capability: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const wrapper = [
      'set -eu',
      '__llxprt_cap="${LLXPRT_CAPABILITY_TOKEN:?missing token}"',
      'unset LLXPRT_CAPABILITY_TOKEN',
      'exec 3<<<"${__llxprt_cap}"',
      'unset __llxprt_cap',
      'export LLXPRT_CAPABILITY_FD=3',
      'read -r received <&3',
      'printf "%s\\n%s\\n%s\\n" "$received" "$LLXPRT_CAPABILITY_FD" "${LLXPRT_CAPABILITY_TOKEN-}"',
      'exec /bin/true',
    ].join('\n');
    const child = spawn(
      'bwrap',
      [
        '--args',
        '3',
        '--',
        '/bin/bash',
        '--noprofile',
        '--norc',
        '-c',
        wrapper,
        'test-wrapper',
      ],
      {
        env: { PATH: '/usr/bin:/bin' },
        stdio: ['ignore', 'pipe', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    if (child.stdout === null || child.stderr === null) {
      child.kill('SIGKILL');
      reject(new Error('bwrap output pipes are unavailable'));
      return;
    }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`bwrap failed with ${String(code)}: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
    const options = [
      '--unshare-user',
      '--unshare-pid',
      '--disable-userns',
      '--ro-bind',
      '/',
      '/',
      '--clearenv',
      '--setenv',
      'PATH',
      '/usr/bin:/bin',
      '--setenv',
      'LLXPRT_CAPABILITY_TOKEN',
      capability,
    ];
    const fd = child.stdio[3];
    if (!(fd instanceof Writable)) {
      child.kill('SIGKILL');
      reject(new Error('bwrap options pipe is unavailable'));
      return;
    }
    fd.end(`${options.join('\0')}\0`);
  });
}

const TOKEN_VALUE = /[0-9a-f]{64}/;
// Bun reserves its string and object heaps in mappings of 1 GiB.
const MAX_SCANNED_MAPPING_BYTES = 2 * 1024 * 1024 * 1024;
const SCAN_CHUNK_BYTES = 1024 * 1024;
const logger = new DebugLogger('llxprt:test:bwrap-credentials');

interface MemoryRange {
  readonly start: number;
  readonly end: number;
}

function parseReadableRange(line: string): MemoryRange | undefined {
  const fields = line.split(/\s+/);
  if (fields.length < 2 || !fields[1].includes('r')) return undefined;
  const bounds = fields[0].split('-');
  if (bounds.length !== 2) return undefined;
  const start = Number.parseInt(bounds[0], 16);
  const end = Number.parseInt(bounds[1], 16);
  return end - start <= MAX_SCANNED_MAPPING_BYTES ? { start, end } : undefined;
}

function readableRanges(pid: number): MemoryRange[] {
  return fsSync
    .readFileSync(`/proc/${pid}/maps`, 'utf8')
    .split('\n')
    .map(parseReadableRange)
    .filter((range): range is MemoryRange => range !== undefined);
}

/** Returns undefined when the mapping disappeared or cannot be read. */
function readAt(
  memory: number,
  chunk: Buffer,
  position: number,
  end: number,
): number | undefined {
  try {
    return fsSync.readSync(
      memory,
      chunk,
      0,
      Math.min(chunk.length, end - position),
      position,
    );
  } catch {
    // Individual mappings can disappear while the process is running.
    return undefined;
  }
}

function scanRange(
  memory: number,
  range: MemoryRange,
  needle: Buffer,
): boolean {
  const chunk = Buffer.alloc(SCAN_CHUNK_BYTES);
  let position = range.start;
  let carry = Buffer.alloc(0);
  while (position < range.end) {
    const read = readAt(memory, chunk, position, range.end);
    if (read === undefined) {
      // An unreadable stretch inside a mapping does not end the search.
      position += Math.min(chunk.length, range.end - position);
      carry = Buffer.alloc(0);
      continue;
    }
    if (read === 0) return false;
    const current = Buffer.concat([carry, chunk.subarray(0, read)]);
    if (current.includes(needle)) return true;
    carry = current.subarray(Math.max(0, current.length - needle.length + 1));
    position += read;
  }
  return false;
}

function innermostNamespacePid(status: string): string | undefined {
  const line = status
    .split('\n')
    .find((candidate) => candidate.startsWith('NSpid:'));
  return line?.split(/\s+/).filter(Boolean).at(-1);
}

function processChildren(pid: number): number[] {
  try {
    return fsSync
      .readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}

function descendants(root: number): number[] {
  const result: number[] = [];
  const pending = [...processChildren(root)];
  while (pending.length > 0) {
    const pid = pending.pop();
    if (pid === undefined) continue;
    result.push(pid);
    pending.push(...processChildren(pid));
  }
  return result;
}

/**
 * Searches the readable memory of a process for the exact token bytes, as
 * 8-bit text and as UTF-16, without printing them. Returns undefined when the
 * process memory cannot be opened by this test process.
 */
function scanReadableMemory(pid: number, token: string): boolean | undefined {
  const needles = [Buffer.from(token, 'latin1'), Buffer.from(token, 'utf16le')];
  try {
    const memory = fsSync.openSync(`/proc/${pid}/mem`, 'r');
    try {
      return readableRanges(pid).some((range) =>
        needles.some((needle) => scanRange(memory, range, needle)),
      );
    } finally {
      fsSync.closeSync(memory);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EACCES') return undefined;
    throw error;
  }
}

async function waitForFile(file: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!fsSync.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('bwrap credential proxy lease', () => {
  it('returns the directly bindable socket file', async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'phase1b-proxy-'),
    );
    const proxy = await acquireHostCredentialProxy(directory);
    try {
      expect((await fs.stat(proxy.socketPath)).isSocket()).toBe(true);
    } finally {
      await proxy.stop();
    }
  });
});

describe('bwrap options-fd capability transport', () => {
  it.skipIf(skipBwrap)(
    'delivers capability without placing it in process arguments or child environment',
    async () => {
      const capability = 'synthetic-secret-never-in-argv';
      const output = await runOptionsFd(capability);

      expect(output.split('\n')[0]).toBe(capability);
      expect(output.split('\n')[1]).toBe('3');
      expect(output.split('\n')[2]).toBe('');
    },
  );

  it.skipIf(skipBwrap)(
    'authenticates through the production launcher without exposing the token to bwrap memory or sandbox environments',
    async () => {
      const taskScratch = path.resolve(
        process.cwd(),
        '..',
        '..',
        '.work',
        'token',
      );
      await fs.mkdir(taskScratch, { recursive: true });
      const workspace = await fs.mkdtemp(
        path.join(taskScratch, 'credential-launch-'),
      );
      const payloadPath = path.join(workspace, 'payload.ts');
      const authResult = path.join(workspace, 'auth-result');
      const release = path.join(workspace, 'release');
      const tokenFile = path.join(workspace, 'token-for-scan');
      await fs.writeFile(
        payloadPath,
        [
          'import fs from "node:fs";',
          'import net from "node:net";',
          'const token = fs.readFileSync(3, "utf8").trim();',
          'fs.closeSync(3);',
          `fs.writeFileSync(${JSON.stringify(tokenFile)}, token);`,
          'const body = Buffer.from(JSON.stringify({v:2,id:"production-launch-test",op:"handshake",payload:{minVersion:1,maxVersion:2,capabilityToken:token}}));',
          'const header = Buffer.alloc(4); header.writeUInt32BE(body.length);',
          'const socket = net.createConnection(process.env.LLXPRT_CREDENTIAL_SOCKET);',
          'let received = Buffer.alloc(0);',
          'socket.on("connect", () => socket.write(Buffer.concat([header, body])));',
          'socket.on("data", chunk => {',
          '  received = Buffer.concat([received, chunk]);',
          '  if (received.length < 4) return;',
          '  const size = received.readUInt32BE(0);',
          '  if (received.length < size + 4) return;',
          `  const result = JSON.parse(received.subarray(4, size + 4).toString("utf8")); fs.writeFileSync(${JSON.stringify(authResult)}, result.ok ? "AUTHORIZED" : "UNAUTHORIZED");`,
          '  socket.end();',
          '  const wait = setInterval(() => { if (fs.existsSync(' +
            JSON.stringify(release) +
            ')) { clearInterval(wait); process.exit(0); } }, 10);',
          '});',
        ].join('\n'),
      );

      const priorEntry = process.argv.at(1);
      const priorCwd = process.cwd();
      process.argv[1] = payloadPath;
      process.chdir(workspace);
      let launchResult:
        | { readonly code?: number; readonly error?: unknown }
        | undefined;
      const launching = runBwrapSandbox({ command: 'bwrap' }, [], undefined, [
        'llxprt',
        '--payload',
      ]).then(
        (code) => (launchResult = { code }),
        (error: unknown) => (launchResult = { error }),
      );
      try {
        await waitForFile(authResult);
        expect(fsSync.readFileSync(authResult, 'utf8')).toBe('AUTHORIZED');

        const processes = descendants(process.pid);
        const outer = processes.find((pid) => {
          try {
            return (
              fsSync.readFileSync(`/proc/${pid}/comm`, 'utf8').trim() ===
              'bwrap'
            );
          } catch {
            return false;
          }
        });
        expect(outer).toBeDefined();
        if (outer === undefined)
          throw new Error('Could not find the production bwrap process');
        const namespaceMembers = processes.filter((pid) => {
          try {
            return (
              fsSync.readlinkSync(`/proc/${pid}/ns/pid`) !==
              fsSync.readlinkSync(`/proc/self/ns/pid`)
            );
          } catch {
            return false;
          }
        });
        const init = namespaceMembers.find((pid) => {
          try {
            const status = fsSync.readFileSync(`/proc/${pid}/status`, 'utf8');
            return innermostNamespacePid(status) === '1';
          } catch {
            return false;
          }
        });
        expect(init).toBeDefined();
        // The payload received this exact token over its descriptor. The host
        // side learns it from the payload so that every search below looks for
        // the real bytes.
        const token = fsSync.readFileSync(tokenFile, 'latin1');
        expect(token).toMatch(TOKEN_VALUE);
        const hasToken = (file: string): boolean =>
          fsSync.readFileSync(file, 'latin1').includes(token);
        expect(hasToken(`/proc/${outer}/cmdline`)).toBe(false);
        expect(hasToken(`/proc/${outer}/environ`)).toBe(false);
        for (const pid of namespaceMembers) {
          const environment = fsSync.readFileSync(
            `/proc/${pid}/environ`,
            'latin1',
          );
          expect(environment).not.toContain('LLXPRT_CAPABILITY_TOKEN=');
          expect(environment).not.toContain(token);
        }
        // Positive control: the payload process read the token, so a scan that
        // can see its memory must find the token there. Without this, a scan
        // that finds nothing in bwrap could simply be unable to find anything.
        const payloadPid = processes.find((pid) => {
          try {
            const argv = fsSync
              .readFileSync(`/proc/${pid}/cmdline`, 'latin1')
              .split('\0');
            return argv[0] === process.execPath && argv.includes(payloadPath);
          } catch {
            return false;
          }
        });
        expect(payloadPid).toBeDefined();
        const control =
          payloadPid === undefined
            ? undefined
            : scanReadableMemory(payloadPid, token);
        if (control === undefined) {
          logger.warn(
            () =>
              'Skipping the memory scan: the payload process memory is unreadable to the host test process.',
          );
        } else {
          expect(control).toBe(true);
        }
        for (const pid of [outer, init].filter(
          (value): value is number => value !== undefined,
        )) {
          const found = scanReadableMemory(pid, token);
          if (found === undefined) {
            logger.warn(
              () =>
                `Skipping bwrap PID ${pid} memory sub-assertion: /proc/${pid}/mem is unreadable to the host test process.`,
            );
          } else {
            expect(found).toBe(false);
          }
        }
      } finally {
        await fs.writeFile(release, 'done');
        await launching;
        if (priorEntry === undefined) delete process.argv[1];
        else process.argv[1] = priorEntry;
        process.chdir(priorCwd);
        await fs.rm(workspace, { recursive: true, force: true });
      }
      expect(launchResult?.error).toBeUndefined();
      expect(launchResult?.code).toBe(0);
    },
    60_000,
  );
});
