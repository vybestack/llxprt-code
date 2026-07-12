/**
 * Behavioral tests for cross-process lock contention using real child processes.
 * Uses real temp directories and the production ProfileManager writer.
 */

import { channel } from 'node:diagnostics_channel';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as childProcess from 'node:child_process';
import { ProfileManager } from '../ProfileManager.js';
import {
  acquireProfilesLock,
  LOCK_CONTENTION_CHANNEL,
  lockPathForProfilesDir,
} from '../profileStore.js';

async function makeTempDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'llxprt-profilestore-xproc-'));
}

describe('profileStore — real cross-process lock contention', () => {
  let tempDir: string;
  const children = new Set<childProcess.ChildProcess>();

  beforeEach(async () => {
    tempDir = await makeTempDir();
  });

  afterEach(async () => {
    const cleanupResults = await Promise.allSettled(
      [...children].map((child) => stopChild(child)),
    );
    children.clear();
    await fsp.rm(tempDir, { recursive: true, force: true });
    const failedCleanup = cleanupResults.find(
      (result) => result.status === 'rejected',
    );
    if (failedCleanup?.status === 'rejected') {
      throw failedCleanup.reason;
    }
  });

  it('child process cannot acquire the lock while parent holds it', async () => {
    const lock = await acquireProfilesLock(tempDir);
    try {
      const childResult = await runChildLockAttempt(tempDir);
      expect(childResult.exitCode).not.toBe(0);
      expect(childResult.stderr).toContain('EEXIST');
    } finally {
      await lock.release();
    }
  });

  it('child process acquires the lock after parent releases it', async () => {
    const lock = await acquireProfilesLock(tempDir);
    await lock.release();

    const childResult = await runChildLockAttempt(tempDir);
    expect(childResult.exitCode).toBe(0);
  });

  it('ProfileManager save blocks while another process holds the lock', async () => {
    expect(
      await verifyBlockedProfileManagerSave({
        profileName: 'concurrent-test',
        provider: 'openai',
        model: 'gpt-4',
      }),
    ).toBe(true);
  });

  it('ProfileManager saves remain serialized for different profile data', async () => {
    expect(
      await verifyBlockedProfileManagerSave({
        profileName: 'repair-test',
        provider: 'anthropic',
        model: 'glm-5.2',
      }),
    ).toBe(true);
  });

  async function verifyBlockedProfileManagerSave(args: {
    profileName: string;
    provider: string;
    model: string;
  }): Promise<boolean> {
    const profilePath = path.join(tempDir, `${args.profileName}.json`);
    const lockPath = lockPathForProfilesDir(tempDir);
    const holder = childProcess.spawn(
      process.execPath,
      ['-e', buildHolderChildScript(tempDir)],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    children.add(holder);

    let contention: ContentionObservation | undefined;
    let save: Promise<PromiseOutcome<void>> | undefined;
    try {
      await waitForStdout(holder, 'READY');
      expect(fs.existsSync(lockPath)).toBe(true);

      contention = observeContention(lockPath);
      const manager = new ProfileManager(tempDir);
      save = handlePromise(
        manager.saveProfile(args.profileName, {
          version: 1,
          provider: args.provider,
          model: args.model,
          modelParams: {},
          ephemeralSettings: {},
        }),
      );

      unwrapOutcome(await contention.observed);
      expect(fs.existsSync(profilePath)).toBe(false);
      expect(fs.existsSync(lockPath)).toBe(true);

      releaseHolder(holder);
      expect(await waitForExit(holder)).toBe(0);
      unwrapOutcome(await save);

      const content: unknown = JSON.parse(
        fs.readFileSync(profilePath, 'utf-8'),
      );
      expect(content).toMatchObject({
        provider: args.provider,
        model: args.model,
      });
      expect(fs.existsSync(lockPath)).toBe(false);
      return true;
    } finally {
      contention?.dispose();
      try {
        await stopChild(holder);
        children.delete(holder);
      } catch {
        // Keep a potentially live child tracked so afterEach retries cleanup.
      }
      if (save !== undefined) {
        await save;
      }
    }
  }
});

interface ChildResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

type PromiseOutcome<T> =
  | { readonly kind: 'fulfilled'; readonly value: T }
  | { readonly kind: 'rejected'; readonly reason: unknown };

function handlePromise<T>(promise: Promise<T>): Promise<PromiseOutcome<T>> {
  return promise.then(
    (value) => ({ kind: 'fulfilled', value }),
    (reason: unknown) => ({ kind: 'rejected', reason }),
  );
}

function unwrapOutcome<T>(outcome: PromiseOutcome<T>): T {
  if (outcome.kind === 'rejected') {
    throw outcome.reason;
  }
  return outcome.value;
}

interface ContentionObservation {
  readonly observed: Promise<PromiseOutcome<void>>;
  dispose(): void;
}

function observeContention(expectedLockPath: string): ContentionObservation {
  const contentionChannel = channel(LOCK_CONTENTION_CHANNEL);
  let subscribed = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settle: (error?: Error) => void = () => {};
  const handler = (message: unknown): void => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'lockPath' in message &&
      message.lockPath === expectedLockPath
    ) {
      settle();
    }
  };
  const cleanup = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (subscribed) {
      contentionChannel.unsubscribe(handler);
      subscribed = false;
    }
  };
  const observed = handlePromise(
    new Promise<void>((resolve, reject) => {
      settle = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        error === undefined ? resolve() : reject(error);
      };
      contentionChannel.subscribe(handler);
      subscribed = true;
      timer = setTimeout(
        () =>
          settle(
            new Error(
              `Timeout waiting for lock contention on ${expectedLockPath}`,
            ),
          ),
        10_000,
      );
    }),
  );

  return {
    observed,
    dispose(): void {
      settle();
    },
  };
}

async function runChildLockAttempt(tempDir: string): Promise<ChildResult> {
  const lockPath = lockPathForProfilesDir(tempDir);
  const script = `
    const fs = require('node:fs');
    const lockPath = ${JSON.stringify(lockPath)};
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.closeSync(fd);
      fs.unlinkSync(lockPath);
      process.exit(0);
    } catch (error) {
      process.stderr.write(error.message + ' ' + (error.code || ''));
      process.exit(1);
    }
  `;
  return runChildScript(script);
}

function buildHolderChildScript(profilesDir: string): string {
  const lockPath = lockPathForProfilesDir(profilesDir);
  return `
    const fs = require('node:fs');
    const readline = require('node:readline');
    const lockPath = ${JSON.stringify(lockPath)};
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      const metadata = JSON.stringify({ pid: process.pid, token: 'child-' + process.pid, created: new Date().toISOString() });
      fs.writeSync(fd, metadata);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
    } catch (error) {
      process.stderr.write('LockBusyError: ' + error.message + '\\n');
      process.exit(1);
    }
    process.stdout.write('READY\\n');
    const lines = readline.createInterface({ input: process.stdin });
    lines.on('line', (line) => {
      if (line.trim() === 'RELEASE') {
        try { fs.unlinkSync(lockPath); } catch {}
        process.exit(0);
      }
    });
  `;
}

function releaseHolder(child: childProcess.ChildProcess): void {
  if (child.exitCode === null && child.stdin?.writable === true) {
    child.stdin.write('RELEASE\n');
  }
}

async function stopChild(child: childProcess.ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  releaseHolder(child);
  try {
    await waitForExit(child);
  } catch {
    child.kill('SIGKILL');
    await waitForExit(child).catch(() => undefined);
  }
}

function waitForStdout(
  child: childProcess.ChildProcess,
  expected: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = child.stdout;
    if (stream === null) {
      reject(new Error('Child has no stdout stream'));
      return;
    }

    let buffer = '';
    const done = (error?: Error): void => {
      clearTimeout(timer);
      stream.removeListener('data', onData);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      error === undefined ? resolve() : reject(error);
    };
    const onData = (data: Buffer): void => {
      buffer += data.toString();
      if (buffer.includes(expected)) {
        done();
      }
    };
    const onError = (error: Error): void => done(error);
    const onExit = (code: number | null): void => {
      if (!buffer.includes(expected)) {
        done(new Error(`Child exited with code ${code} before "${expected}"`));
      }
    };
    const timer = setTimeout(
      () => done(new Error(`Timeout waiting for stdout "${expected}"`)),
      10_000,
    );

    stream.on('data', onData);
    child.on('error', onError);
    child.on('exit', onExit);
  });
}

function waitForExit(child: childProcess.ChildProcess): Promise<number | null> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(child.exitCode);
  }
  return new Promise((resolve, reject) => {
    const done = (error?: Error, code?: number | null): void => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
      error === undefined ? resolve(code ?? null) : reject(error);
    };
    const onExit = (code: number | null): void => done(undefined, code);
    const onError = (error: Error): void => done(error);
    const timer = setTimeout(
      () => done(new Error('Timeout waiting for child exit')),
      10_000,
    );
    child.on('exit', onExit);
    child.on('error', onError);
  });
}

async function runChildScript(script: string): Promise<ChildResult> {
  return new Promise((resolve) => {
    childProcess.execFile(
      process.execPath,
      ['-e', script],
      { cwd: process.cwd(), timeout: 10_000 },
      (error, stdout, stderr) => {
        let exitCode = 0;
        if (error !== null) {
          exitCode = typeof error.code === 'number' ? error.code : 1;
        }
        resolve({ exitCode, stdout, stderr });
      },
    );
  });
}
