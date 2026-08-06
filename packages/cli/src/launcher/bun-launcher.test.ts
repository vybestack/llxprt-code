/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { waitFor } from '@vybestack/llxprt-code-test-utils';
import { describe, expect, it, vi, beforeEach, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import { FatalError } from '@vybestack/llxprt-code-core';
import {
  relaunchUnderBunIfNeeded,
  runBunLauncherIfNeeded,
} from './bun-launcher.js';

describe('relaunchUnderBunIfNeeded', () => {
  let originalArgv: string[];
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalArgv = process.argv;
    originalEnv = process.env;
    process.env = { ...process.env };
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = originalEnv;
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('does nothing when already running under Bun', async () => {
    const spawnFn = vi.fn();
    const result = await relaunchUnderBunIfNeeded({
      isRunningUnderBun: () => true,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn,
    });

    expect(result.relaunched).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('does nothing when LLXPRT_BUN_RELAUNCHED guard is set', async () => {
    const spawnFn = vi.fn();
    const result = await relaunchUnderBunIfNeeded({
      isRunningUnderBun: () => false,
      envGuardSet: () => true,
      resolveBun: vi.fn(async () => '/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn,
    });

    expect(result.relaunched).toBe(false);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('throws FatalError with actionable message when bun cannot be resolved', async () => {
    let thrown: unknown;
    try {
      await relaunchUnderBunIfNeeded({
        isRunningUnderBun: () => false,
        envGuardSet: () => false,
        resolveBun: vi.fn(async () => null),
        resolveEntry: vi.fn(async () => '/entry.ts'),
        spawn: vi.fn(),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(FatalError);
    const fatal = thrown as FatalError;
    expect(fatal.exitCode).toBe(43);
    expect(fatal.message).toMatch(/npm install/);
    expect(fatal.message).toMatch(/bun/);
    expect(fatal.message).toMatch(/PATH|bun\.sh/);
  });

  it('throws FatalError with actionable message when entry cannot be resolved', async () => {
    await expect(
      relaunchUnderBunIfNeeded({
        isRunningUnderBun: () => false,
        envGuardSet: () => false,
        resolveBun: vi.fn(async () => '/path/to/bun'),
        resolveEntry: vi.fn(async () => null),
        spawn: vi.fn(),
      }),
    ).rejects.toThrowError(/entry/);
  });

  it('entry-not-found FatalError mentions dist/index.js alongside legacy entry locations', async () => {
    let thrown: unknown;
    try {
      await relaunchUnderBunIfNeeded({
        isRunningUnderBun: () => false,
        envGuardSet: () => false,
        resolveBun: vi.fn(async () => '/path/to/bun'),
        resolveEntry: vi.fn(async () => null),
        spawn: vi.fn(),
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(FatalError);
    const fatal = thrown as FatalError;
    expect(fatal.exitCode).toBe(43);
    expect(fatal.message).toMatch(/dist\/index\.js/);
    expect(fatal.message).toMatch(/reinstall/i);
  });

  /**
   * Shared spawn-close harness: launches relaunchUnderBunIfNeeded with a mock
   * spawn that returns an EventEmitter child, then emits the given close args.
   */
  async function relaunchAndClose(
    emit: (child: EventEmitter) => void,
    overrides: Partial<Parameters<typeof relaunchUnderBunIfNeeded>[0]> = {},
  ): Promise<{
    result: Awaited<ReturnType<typeof relaunchUnderBunIfNeeded>>;
    spawnFn: ReturnType<typeof vi.fn>;
  }> {
    let capturedChild: EventEmitter | null = null;
    const spawnFn = vi.fn(() => {
      capturedChild = new EventEmitter();
      return capturedChild;
    });
    const promise = relaunchUnderBunIfNeeded({
      isRunningUnderBun: () => false,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
      ...overrides,
    });
    await waitFor(() => expect(capturedChild).not.toBeNull());
    emit(capturedChild!);
    const result = await promise;
    return { result, spawnFn };
  }

  it('spawns resolved bun with entry and forwarded args, stdio inherit', async () => {
    process.argv = ['/node', '/script.js', '--foo', 'bar'];
    const { result, spawnFn } = await relaunchAndClose((c) =>
      c.emit('close', 0),
    );
    expect(result.relaunched).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(spawnFn).toHaveBeenCalledWith(
      '/path/to/bun',
      ['/entry.ts', '--foo', 'bar'],
      expect.objectContaining({
        stdio: ['inherit', 'inherit', 'inherit'],
        env: expect.objectContaining({ LLXPRT_BUN_RELAUNCHED: 'true' }),
      }),
    );
  });

  it('propagates child close code as exitCode', async () => {
    process.argv = ['/node', '/script.js'];
    const { result } = await relaunchAndClose((c) => c.emit('close', 7));
    expect(result.relaunched).toBe(true);
    expect(result.exitCode).toBe(7);
  });

  it('treats child signal termination as a failure exitCode', async () => {
    process.argv = ['/node', '/script.js'];
    const { result } = await relaunchAndClose((c) =>
      c.emit('close', null, 'SIGTERM'),
    );
    expect(result.relaunched).toBe(true);
    expect(result.exitCode).toBe(143);
  });

  it('treats unmapped child signal termination as a failure exitCode', async () => {
    process.argv = ['/node', '/script.js'];
    const { result } = await relaunchAndClose((c) =>
      c.emit('close', null, 'SIGRTMIN'),
    );
    expect(result.relaunched).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it('treats null code without signal as a failure exitCode', async () => {
    process.argv = ['/node', '/script.js'];
    const { result } = await relaunchAndClose((c) =>
      c.emit('close', null, null),
    );
    expect(result.relaunched).toBe(true);
    expect(result.exitCode).toBe(1);
  });

  it('preserves existing environment variables in spawned process', async () => {
    process.env['CUSTOM_LAUNCHER_VAR'] = 'hello';
    const { spawnFn } = await relaunchAndClose((c) => c.emit('close', 0));
    const spawnEnv = spawnFn.mock.calls[0][2].env as Record<string, string>;
    expect(spawnEnv.CUSTOM_LAUNCHER_VAR).toBe('hello');
  });

  it('does not set a credential socket when none is present in the parent env', async () => {
    delete process.env.LLXPRT_CREDENTIAL_SOCKET;
    process.argv = ['/node', '/script.js'];
    const { spawnFn } = await relaunchAndClose((c) => c.emit('close', 0));
    const spawnEnv = spawnFn.mock.calls[0][2].env as Record<string, string>;
    expect(spawnEnv.LLXPRT_BUN_RELAUNCHED).toBe('true');
    expect(spawnEnv.LLXPRT_CREDENTIAL_SOCKET).toBeUndefined();
  });

  it('passes through an existing credential socket without starting a proxy', async () => {
    process.env.LLXPRT_CREDENTIAL_SOCKET = '/already-running.sock';
    const { spawnFn } = await relaunchAndClose((c) => c.emit('close', 0));
    const spawnEnv = spawnFn.mock.calls[0][2].env as Record<string, string>;
    expect(spawnEnv.LLXPRT_CREDENTIAL_SOCKET).toBe('/already-running.sock');
  });

  it('spawns a Windows .cmd shim with shell:true so child_process can execute it safely', async () => {
    process.argv = ['/node', '/script.js'];
    const { spawnFn } = await relaunchAndClose((c) => c.emit('close', 0), {
      resolveBun: vi.fn(async () => 'C:/repo/node_modules/.bin/bun.cmd'),
      platform: 'win32',
    });
    expect(spawnFn).toHaveBeenCalledWith(
      'C:/repo/node_modules/.bin/bun.cmd',
      expect.any(Array),
      expect.objectContaining({ shell: true }),
    );
  });

  it('rejects unsafe Windows .cmd shim arguments before spawning', async () => {
    process.argv = ['/node', '/script.js', '--prompt', 'hello & whoami'];
    const spawnFn = vi.fn();
    await expect(
      relaunchUnderBunIfNeeded({
        isRunningUnderBun: () => false,
        envGuardSet: () => false,
        resolveBun: vi.fn(async () => 'C:/repo/node_modules/.bin/bun.cmd'),
        resolveEntry: vi.fn(async () => '/entry.ts'),
        spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
        platform: 'win32',
      }),
    ).rejects.toThrow(/command-shell metacharacters/i);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('does not set shell:true when spawning a direct non-cmd executable', async () => {
    process.argv = ['/node', '/script.js'];
    const { spawnFn } = await relaunchAndClose((c) => c.emit('close', 0), {
      resolveBun: vi.fn(async () => '/usr/local/bin/bun'),
    });
    const opts = spawnFn.mock.calls[0][2] as {
      env: NodeJS.ProcessEnv;
      shell?: boolean;
    };
    expect(opts.shell).toBeFalsy();
  });

  it('converts a synchronous spawn throw into FatalError naming the Bun path and suggesting reinstall/PATH', async () => {
    const spawnFn = vi.fn(() => {
      throw new Error('spawn EACCES');
    });

    let thrown: unknown;
    try {
      await relaunchUnderBunIfNeeded({
        isRunningUnderBun: () => false,
        envGuardSet: () => false,
        resolveBun: vi.fn(async () => '/resolved/path/to/bun'),
        resolveEntry: vi.fn(async () => '/entry.ts'),
        spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
      });
    } catch (error) {
      thrown = error;
    }

    expect(spawnFn).toHaveBeenCalled();
    expect(thrown).toBeInstanceOf(FatalError);
    const fatal = thrown as FatalError;
    expect(fatal.exitCode).toBe(43);
    expect(fatal.message).toContain('/resolved/path/to/bun');
    expect(fatal.message).toMatch(/reinstall|npm install/i);
    expect(fatal.message).toMatch(/PATH|executable/i);
  });

  it('converts an asynchronous child error event into FatalError without hanging', async () => {
    let thrown: unknown;
    try {
      await relaunchAndClose(
        (c) => c.emit('error', new Error('spawn ENOENT')),
        { resolveBun: vi.fn(async () => '/resolved/path/to/bun') },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FatalError);
    const fatal = thrown as FatalError;
    expect(fatal.exitCode).toBe(43);
    expect(fatal.message).toContain('/resolved/path/to/bun');
    expect(fatal.message).toMatch(/reinstall|npm install/i);
    expect(fatal.message).toMatch(/PATH|executable/i);
  });

  it('settles on error then ignores a later close event (no double-resolve, no crash)', async () => {
    let thrown: unknown;
    try {
      await relaunchAndClose((c) => {
        c.emit('error', new Error('spawn ENOENT'));
        c.emit('close', 1);
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(FatalError);
    expect((thrown as FatalError).message).toMatch(/ENOENT/);
  });

  it('settles on close then ignores a later error event (no double-resolve, no crash)', async () => {
    const { result } = await relaunchAndClose((c) => {
      c.emit('close', 0);
      c.emit('error', new Error('late EPIPE'));
    });
    expect(result.relaunched).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('removes settling listeners after close so the child does not leak handlers', async () => {
    let capturedChild: EventEmitter | null = null;
    const spawnFn = vi.fn(() => {
      capturedChild = new EventEmitter();
      return capturedChild;
    });
    const promise = relaunchUnderBunIfNeeded({
      isRunningUnderBun: () => false,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/resolved/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
    });
    await waitFor(() => expect(capturedChild).not.toBeNull());
    const child = capturedChild!;
    expect(child.listenerCount('close')).toBe(1);
    expect(child.listenerCount('error')).toBe(1);
    child.emit('close', 0);
    await promise;
    expect(child.listenerCount('close')).toBe(0);
    expect(child.listenerCount('error')).toBe(1);
    expect(() => child.emit('error', new Error('late error'))).not.toThrow();
  });

  /** @plan project-plans/issue-1954-sandbox-hardening.md (AC3, F2, O5, O9-O12) */
  describe('relaunchUnderBunIfNeeded: capability fd pass-and-close (AC3, F2)', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
      originalEnv = process.env;
      process.env = { ...process.env };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    async function mkLauncherTmpDir(prefix: string): Promise<string> {
      const pathMod = await import('node:path');
      const osMod = await import('node:os');
      return (await import('node:fs/promises')).mkdtemp(
        pathMod.join(osMod.tmpdir(), prefix),
      );
    }

    async function rmLauncherTmpDir(dir: string): Promise<void> {
      (await import('node:fs')).rmSync(dir, { recursive: true, force: true });
    }

    /** @plan project-plans/issue-1954-sandbox-hardening.md (O9-O12) — real spawn with guaranteed fd 3. */
    it.skipIf(process.platform === 'win32')(
      'O9/O10: direct platform fd-forwarding — explicit stdio array maps parent fd 3 to child fd 3',
      async () => {
        const pathMod = await import('node:path');
        const fsMod = await import('node:fs');
        const dir = await mkLauncherTmpDir('launcher-o9-');
        try {
          const sentinel = pathMod.join(dir, 'child.json');
          const recorder = pathMod.join(dir, 'rec.js');
          const tokenFile = pathMod.join(dir, 'token.txt');
          const token = 'b'.repeat(64) + '\n';
          fsMod.writeFileSync(tokenFile, token);
          fsMod.writeFileSync(
            recorder,
            '#!/usr/bin/env node\nconst fs=require("fs");let r=Buffer.alloc(0),c=Buffer.alloc(128),n;try{while((n=fs.readSync(3,c,0,128,null))>0)r=Buffer.concat([r,c.subarray(0,n)]);}catch{}try{fs.closeSync(3);}catch{}fs.writeFileSync(' +
              JSON.stringify(sentinel) +
              ',JSON.stringify({len:r.length,text:r.toString("utf8")}));',
          );
          fsMod.chmodSync(recorder, 0o755);
          const harness = pathMod.join(dir, 'h.js');
          fsMod.writeFileSync(
            harness,
            'const{spawn}=require("child_process");const c=spawn(' +
              JSON.stringify(recorder) +
              ',[],{stdio:[0,1,2,0],env:{...process.env,LLXPRT_BUN_RELAUNCHED:"true"}});c.on("close",e=>process.exit(e));',
          );
          // Explicitly `node`, not process.execPath: this case exercises
          // Node's platform fd-forwarding, and under the Bun test runner
          // process.execPath is the bun binary. The recorder script already
          // requires node through its shebang.
          const result = (await import('node:child_process')).spawnSync(
            'node',
            [harness],
            { encoding: 'utf8', timeout: 10000, input: token },
          );
          expect(result.status).toBe(0);
          const rec = JSON.parse(fsMod.readFileSync(sentinel, 'utf8')) as {
            len: number;
            text: string;
          };
          expect(rec.len).toBe(65);
          expect(rec.text).toBe(token);
        } finally {
          await rmLauncherTmpDir(dir);
        }
      },
      10000,
    );

    /** O11/O12: Verify real relaunchUnderBunIfNeeded closes parent fd 3 after spawn, with guaranteed fd 3. */
    it('O11/O12: real relaunchUnderBunIfNeeded closes the parent fd 3 after successful spawn', async () => {
      const pathMod = await import('node:path');
      const fsMod = await import('node:fs');
      const { fileURLToPath } = await import('node:url');
      const dir = await mkLauncherTmpDir('launcher-o11-');
      try {
        const tokenFile = pathMod.join(dir, 'token.txt');
        fsMod.writeFileSync(tokenFile, 'c'.repeat(64) + '\n');
        // Resolve the launcher source relative to this test file (not
        // process.cwd(), which differs between repo root and packages/cli).
        const launcherSrc = pathMod.resolve(
          pathMod.dirname(fileURLToPath(import.meta.url)),
          'bun-launcher.ts',
        );
        const harness = pathMod.join(dir, 'h.ts');
        fsMod.writeFileSync(
          harness,
          [
            `import { relaunchUnderBunIfNeeded } from ${JSON.stringify(launcherSrc)};`,
            'import fs from "node:fs";import {EventEmitter} from "node:events";',
            'async function main(){let c:EventEmitter|null=null;',
            'const fn=()=>{c=new EventEmitter();return c;};',
            'const p=relaunchUnderBunIfNeeded({isRunningUnderBun:()=>false,envGuardSet:()=>false,',
            'resolveBun:()=>Promise.resolve("/fake/bun"),resolveEntry:()=>Promise.resolve("/entry.ts"),',
            'spawn:fn as unknown as typeof import("node:child_process").spawn});',
            'await new Promise(r=>setImmediate(r));if(!c)process.exit(1);',
            'let cl=false;try{fs.readSync(3,Buffer.alloc(4),0,4,null);}catch{cl=true;}',
            'const mg=process.env.LLXPRT_CAPABILITY_FD===undefined;',
            'c.emit("close",0);await p;process.stdout.write(JSON.stringify({fd3closed:cl,markerGone:mg}));}',
            'main().catch(e=>{process.stderr.write(e.message);process.exit(1);});',
          ].join('\n'),
        );
        const bash = `exec 3<${JSON.stringify(tokenFile)}\nLLXPRT_CAPABILITY_FD=3 exec bun ${JSON.stringify(harness)}`;
        const result = (await import('node:child_process')).spawnSync(
          'bash',
          ['-c', bash],
          { encoding: 'utf8', timeout: 30000 },
        );
        expect(result.status).toBe(0);
        expect(result.stderr).toBe('');
        expect(
          (JSON.parse(result.stdout.trim()) as { fd3closed: boolean })
            .fd3closed,
        ).toBe(true);
        expect(
          (JSON.parse(result.stdout.trim()) as { markerGone: boolean })
            .markerGone,
        ).toBe(true);
      } finally {
        await rmLauncherTmpDir(dir);
      }
    }, 15000);

    /** @plan project-plans/issue-1954-sandbox-hardening.md (AC3, O5) */
    type O5Case = {
      readonly fdMarker: 'real' | string;
      readonly spawnFn: ReturnType<typeof vi.fn>;
      readonly expectFdClosed: boolean;
    };

    async function runO5Case(
      c: O5Case,
    ): Promise<{ spawnCallCount: number; fdClosed: boolean }> {
      const fsMod = await import('node:fs');
      const pathMod = await import('node:path');
      const dir = await (
        await import('node:fs/promises')
      ).mkdtemp(pathMod.join((await import('node:os')).tmpdir(), 'l-o5-'));
      const fd = fsMod.openSync(pathMod.join(dir, 'cap.txt'), 'w+');
      let fdClosed = false;
      try {
        process.env.LLXPRT_CAPABILITY_FD =
          c.fdMarker === 'real' ? String(fd) : c.fdMarker;
        await expect(
          relaunchUnderBunIfNeeded({
            isRunningUnderBun: () => false,
            envGuardSet: () => false,
            resolveBun: vi.fn(async () => '/bun'),
            resolveEntry: vi.fn(async () => '/entry.ts'),
            spawn:
              c.spawnFn as unknown as typeof import('node:child_process').spawn,
          }),
        ).rejects.toBeInstanceOf(FatalError);
        if (c.expectFdClosed) {
          expect(() => fsMod.readSync(fd, Buffer.alloc(4), 0, 4, 0)).toThrow(
            /EBADF/,
          );
          fdClosed = true;
        } else {
          expect(() =>
            fsMod.readSync(fd, Buffer.alloc(4), 0, 4, 0),
          ).not.toThrow();
          fsMod.closeSync(fd);
        }
      } finally {
        fsMod.rmSync(dir, { recursive: true, force: true });
      }
      return { spawnCallCount: c.spawnFn.mock.calls.length, fdClosed };
    }

    it('O5: closes the inherited capability fd on synchronous spawn failure', async () => {
      const result = await runO5Case({
        fdMarker: 'real',
        spawnFn: vi.fn(() => {
          throw new Error('spawn EACCES');
        }),
        expectFdClosed: true,
      });
      expect(result.spawnCallCount).toBe(1);
      expect(result.fdClosed).toBe(true);
    });

    it('O5: surfaces spawn failure when capability fd is set but close returns EBADF (swallowed)', async () => {
      const fsMod = await import('node:fs');
      const pathMod = await import('node:path');
      const dir = await mkLauncherTmpDir('l-ebadf-');
      fsMod.closeSync(fsMod.openSync(pathMod.join(dir, 'cap.txt'), 'w+'));
      try {
        process.env.LLXPRT_CAPABILITY_FD = '99999';
        const spawnFn = vi.fn(() => {
          throw new Error('spawn EACCES');
        });
        let thrown: unknown;
        try {
          await relaunchUnderBunIfNeeded({
            isRunningUnderBun: () => false,
            envGuardSet: () => false,
            resolveBun: vi.fn(async () => '/bun'),
            resolveEntry: vi.fn(async () => '/e.ts'),
            spawn:
              spawnFn as unknown as typeof import('node:child_process').spawn,
          });
        } catch (e) {
          thrown = e;
        }
        expect(thrown).toBeInstanceOf(FatalError);
        expect((thrown as FatalError).message).toContain('spawn EACCES');
      } finally {
        await rmLauncherTmpDir(dir);
      }
    });

    it('O5: fails fast on an invalid LLXPRT_CAPABILITY_FD marker without attempting to close a descriptor', async () => {
      const result = await runO5Case({
        fdMarker: 'abc',
        spawnFn: vi.fn(),
        expectFdClosed: false,
      });
      expect(result.spawnCallCount).toBe(0);
    });

    /** Open a temp fd to use as the capability descriptor. */
    async function openCapabilityFd(prefix: string): Promise<{
      fd: number;
      cleanup: () => void;
    }> {
      const fsMod = await import('node:fs');
      const pathMod = await import('node:path');
      const osMod = await import('node:os');
      const tokenFile = pathMod.join(
        osMod.tmpdir(),
        `${prefix}-${process.pid}-${Date.now()}.txt`,
      );
      const fd = fsMod.openSync(tokenFile, 'w+');
      return {
        fd,
        cleanup: () => {
          try {
            fsMod.closeSync(fd);
          } catch {
            // may already be closed
          }
          try {
            fsMod.unlinkSync(tokenFile);
          } catch {
            // best-effort
          }
        },
      };
    }

    it('deletes LLXPRT_CAPABILITY_FD from the parent env after a successful spawn', async () => {
      const { fd, cleanup } = await openCapabilityFd('l-envdel-');
      process.env.LLXPRT_CAPABILITY_FD = String(fd);
      try {
        const result = await relaunchAndClose((c) => c.emit('close', 0));
        expect(result.result.relaunched).toBe(true);
        expect(process.env.LLXPRT_CAPABILITY_FD).toBeUndefined();
      } finally {
        cleanup();
      }
    });

    it('deletes LLXPRT_CAPABILITY_FD from the parent env on synchronous spawn failure', async () => {
      const { fd, cleanup } = await openCapabilityFd('l-envdel-fail-');
      process.env.LLXPRT_CAPABILITY_FD = String(fd);
      try {
        await expect(
          relaunchUnderBunIfNeeded({
            isRunningUnderBun: () => false,
            envGuardSet: () => false,
            resolveBun: vi.fn(async () => '/bun'),
            resolveEntry: vi.fn(async () => '/entry.ts'),
            spawn: vi.fn().mockImplementation(() => {
              throw new Error('spawn EACCES');
            }) as unknown as typeof import('node:child_process').spawn,
          }),
        ).rejects.toBeInstanceOf(FatalError);
        expect(process.env.LLXPRT_CAPABILITY_FD).toBeUndefined();
      } finally {
        cleanup();
      }
    });

    it('terminates the spawned child and surfaces the error when parent fd close fails after a successful spawn', async () => {
      const fsMod = await import('node:fs');
      const pathMod = await import('node:path');
      const osMod = await import('node:os');
      // Force a non-EBADF close failure by spying on the fs default namespace's
      // closeSync to throw EIO for the capability fd.
      const fsDefault = (await import('node:fs')).default;
      const tmpFile = pathMod.join(
        osMod.tmpdir(),
        `l-kill-${process.pid}-${Date.now()}.txt`,
      );
      const fd = fsMod.openSync(tmpFile, 'w+');
      process.env.LLXPRT_CAPABILITY_FD = String(fd);
      let killed = false;
      let capturedChild: EventEmitter | null = null;
      const spawnFn = vi.fn(() => {
        capturedChild = new EventEmitter();
        Object.defineProperty(capturedChild, 'kill', {
          value: (sig: string) => {
            if (sig === 'SIGTERM') killed = true;
            return true;
          },
        });
        return capturedChild;
      });
      const closeSpy = vi
        .spyOn(fsDefault, 'closeSync')
        .mockImplementation((fdArg: number) => {
          if (fdArg === fd) throw new Error('close EIO');
          return undefined;
        });
      try {
        const promise = relaunchUnderBunIfNeeded({
          isRunningUnderBun: () => false,
          envGuardSet: () => false,
          resolveBun: vi.fn(async () => '/bun'),
          resolveEntry: vi.fn(async () => '/entry.ts'),
          spawn:
            spawnFn as unknown as typeof import('node:child_process').spawn,
        });
        // Attach the rejection handler immediately so the promise's
        // synchronous rejection does not surface as unhandled.
        const caught = promise.catch((e: unknown) => e);
        await waitFor(() => expect(capturedChild).not.toBeNull());
        closeSpy.mockRestore();
        const thrown = await caught;
        expect(thrown).toBeInstanceOf(AggregateError);
        expect(
          (thrown as AggregateError).errors.some((e) =>
            /close EIO|capability fd/i.test(
              e instanceof Error ? e.message : String(e),
            ),
          ),
        ).toBe(true);
        expect(killed).toBe(true);
        expect(process.env.LLXPRT_CAPABILITY_FD).toBeUndefined();
      } finally {
        closeSpy.mockRestore();
        try {
          fsMod.closeSync(fd);
        } catch {
          // may already be closed
        }
        try {
          fsMod.unlinkSync(tmpFile);
        } catch {
          // best-effort cleanup
        }
      }
    });
  });
});

describe('runBunLauncherIfNeeded', () => {
  let originalArgv: string[];
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalArgv = process.argv;
    originalEnv = process.env;
    process.env = { ...process.env };
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.env = originalEnv;
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('propagates FatalError without calling exit when bun cannot be resolved', async () => {
    const exitCalls: number[] = [];

    await expect(
      runBunLauncherIfNeeded({
        isRunningUnderBun: () => false,
        envGuardSet: () => false,
        resolveBun: vi.fn(async () => null),
        resolveEntry: vi.fn(async () => '/entry.ts'),
        spawn: vi.fn(),
        exit: (code?: number) => {
          exitCalls.push(code ?? 0);
          return undefined as never;
        },
      }),
    ).rejects.toBeInstanceOf(FatalError);

    expect(exitCalls).toHaveLength(0);
  });

  it('exits with the child close code', async () => {
    const exitCalls: number[] = [];
    let capturedChild: EventEmitter | null = null;
    const spawnFn = vi.fn(() => {
      capturedChild = new EventEmitter();
      return capturedChild;
    });

    const promise = runBunLauncherIfNeeded({
      isRunningUnderBun: () => false,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
      exit: (code?: number) => {
        exitCalls.push(code ?? 0);
        return undefined as never;
      },
    });

    await waitFor(() => expect(capturedChild).not.toBeNull());
    capturedChild!.emit('close', 9);
    await promise;

    expect(exitCalls).toStrictEqual([9]);
  });

  it('does not call exit when no relaunch is needed (already under bun)', async () => {
    const exitCalls: number[] = [];
    const spawnFn = vi.fn();

    await runBunLauncherIfNeeded({
      isRunningUnderBun: () => true,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
      exit: (code?: number) => {
        exitCalls.push(code ?? 0);
        return undefined as never;
      },
    });

    expect(exitCalls).toHaveLength(0);
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('propagates async child error without calling exit', async () => {
    const exitCalls: number[] = [];
    let capturedChild: EventEmitter | null = null;
    const spawnFn = vi.fn(() => {
      capturedChild = new EventEmitter();
      return capturedChild;
    });

    const promise = runBunLauncherIfNeeded({
      isRunningUnderBun: () => false,
      envGuardSet: () => false,
      resolveBun: vi.fn(async () => '/path/to/bun'),
      resolveEntry: vi.fn(async () => '/entry.ts'),
      spawn: spawnFn as unknown as typeof import('node:child_process').spawn,
      exit: (code?: number) => {
        exitCalls.push(code ?? 0);
        return undefined as never;
      },
    });

    await waitFor(() => expect(capturedChild).not.toBeNull());
    capturedChild!.emit('error', new Error('spawn ENOENT'));

    await expect(promise).rejects.toBeInstanceOf(FatalError);
    expect(exitCalls).toHaveLength(0);
  });
});
